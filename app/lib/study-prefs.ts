/** Client-side study preferences & saved sessions (localStorage). */

import type { RuleKind } from "~/lib/db.server";

export const REPETITION_KEY = "jv:study:repetition";

/** Show the kana reading on the question side of a card that has one. */
export const FRONT_READING_KEY = "jv:study:front-reading";

/** The three independent study sections. */
export type StudyKind = "words" | "phrases" | "forms";

export const STUDY_KINDS: StudyKind[] = ["words", "phrases", "forms"];

export const STUDY_KIND_LABELS: Record<StudyKind, string> = {
  words: "Words",
  phrases: "Phrases",
  forms: "Rules",
};

/** Which tab a study session was started from. */
export type StudyRuleKind = RuleKind | "";

/** The per-tab configuration (each tab keeps its own). */
export interface StudyConfig {
  /** Explicitly chosen list ids (empty = every list matching the tags). */
  lists: number[];
  tags: string[];
  /** Part of speech filter — words tab only ("" = all types). */
  pos: string;
  /** Rule kind filter — forms tab only ("" = every rule). */
  ruleKind: StudyRuleKind;
  /** Drill only the cards starred as important — all three tabs. */
  important: boolean;
  /** Cards to draw — ignored when {@link fixedSize} is set. */
  limit: number;
  /** Draw every card in the selection instead of `limit` of them. */
  fixedSize: boolean;
  /** Deal the deck in random order; off keeps the order the source list shows. */
  shuffle: boolean;
}

export const DEFAULT_STUDY_CONFIG: StudyConfig = {
  lists: [],
  tags: [],
  pos: "",
  ruleKind: "",
  important: false,
  limit: 40,
  // On, so a first visit deals the whole selection: the size pills are a choice
  // about a sample, and there is no sample until this is turned off.
  fixedSize: true,
  shuffle: true,
};

/** Each tab keeps its own remembered config, keyed by kind. */
export type StudyConfigs = Record<StudyKind, StudyConfig>;

const CONFIG_KEY = "jv:study:config";

/** Each tab at its defaults — the shape both a cold start and a bad record fall back to. */
function defaultConfigs(): StudyConfigs {
  return {
    words: { ...DEFAULT_STUDY_CONFIG },
    phrases: { ...DEFAULT_STUDY_CONFIG },
    forms: { ...DEFAULT_STUDY_CONFIG },
  };
}

/**
 * The config the builder was last left in, per tab.
 *
 * Read it *after* the first render (see `StudySetup`): the server cannot reach
 * localStorage, so a remembered config read during render makes the client paint
 * a different tree than the one it adopted.
 */
export function loadStudyConfigs(): StudyConfigs {
  if (typeof window === "undefined") return defaultConfigs();
  try {
    const raw = window.localStorage.getItem(CONFIG_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    const stored = (parsed && typeof parsed === "object" ? parsed : {}) as Partial<StudyConfigs>;
    return {
      // A record with no `fixedSize` has simply never been set, so it takes
      // today's default — unlike a saved session, which is dated (see below).
      words: normalizeConfig(stored.words, DEFAULT_STUDY_CONFIG.fixedSize),
      phrases: normalizeConfig(stored.phrases, DEFAULT_STUDY_CONFIG.fixedSize),
      forms: normalizeConfig(stored.forms, DEFAULT_STUDY_CONFIG.fixedSize),
    };
  } catch {
    return defaultConfigs();
  }
}

export function saveStudyConfigs(configs: StudyConfigs) {
  try {
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify(configs));
  } catch {
    // Storage unavailable — the in-session config still applies.
  }
}

export function loadPreference<T extends string>(key: string, fallback: T, allowed: T[]): T {
  if (typeof window === "undefined") return fallback;
  const value = window.localStorage.getItem(key);
  return value && (allowed as string[]).includes(value) ? (value as T) : fallback;
}

export function savePreference(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

export interface SavedSession extends StudyConfig {
  id: string;
  name: string;
  kind: StudyKind;
  createdAt: number;
}

const SESSIONS_KEY = "jv:study:sessions";

/**
 * Merge a stored config over the defaults, dropping anything malformed so a
 * record written before a field existed still loads and a hand-edited value
 * cannot produce a config the builder has no control for.
 *
 * `fixedSizeWhenAbsent` is the one field that cannot have a single answer. A
 * remembered *preference* with no `fixedSize` has simply never been set, so it
 * takes today's default; a saved *session* with no `fixedSize` was written
 * before the option existed and meant a sized draw, and inheriting the default
 * would silently turn every old "20 cards" session into the whole selection.
 */
function normalizeConfig(raw: unknown, fixedSizeWhenAbsent: boolean): StudyConfig {
  const value = (raw && typeof raw === "object" ? raw : {}) as Partial<StudyConfig>;
  return {
    lists: Array.isArray(value.lists)
      ? value.lists.filter((id): id is number => typeof id === "number")
      : [],
    tags: Array.isArray(value.tags)
      ? value.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
    pos: typeof value.pos === "string" ? value.pos : "",
    ruleKind: value.ruleKind === "word" || value.ruleKind === "sentence" ? value.ruleKind : "",
    important: value.important === true,
    limit: typeof value.limit === "number" ? value.limit : DEFAULT_STUDY_CONFIG.limit,
    // Absent means the behaviour from before the option existed, for both
    // fields. For `shuffle` that is also today's default, which is why the
    // literal is right here and `fixedSize` alone needs the caller's answer —
    // and why neither should be "tidied" into the other's shape.
    fixedSize: typeof value.fixedSize === "boolean" ? value.fixedSize : fixedSizeWhenAbsent,
    shuffle: typeof value.shuffle === "boolean" ? value.shuffle : true,
  };
}

function normalizeSession(item: unknown): SavedSession | null {
  if (!item || typeof item !== "object") return null;
  const raw = item as Partial<SavedSession>;
  if (typeof raw.id !== "string" || typeof raw.name !== "string") return null;
  if (!Array.isArray(raw.lists) || !Array.isArray(raw.tags)) return null;
  if (typeof raw.limit !== "number") return null;

  const kind: StudyKind =
    raw.kind === "phrases" || raw.kind === "forms" ? raw.kind : "words";

  return {
    // A session written before `fixedSize` existed was a sized draw, so it is
    // read as one rather than as today's default of "everything".
    ...normalizeConfig(raw, false),
    id: raw.id,
    name: raw.name,
    kind,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
  };
}

/** Sessions saved before tabs existed are treated as *words* sessions. */
export function loadSessions(): SavedSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SESSIONS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeSession)
      .filter((session): session is SavedSession => session !== null);
  } catch {
    return [];
  }
}

export function saveSessions(sessions: SavedSession[]) {
  try {
    window.localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  } catch {
    // ignore
  }
}

/** Keep the same array order, but scoped to one tab (order is user-defined). */
export function sessionsOfKind(sessions: SavedSession[], kind: StudyKind): SavedSession[] {
  return sessions.filter((session) => session.kind === kind);
}

/**
 * Replace one tab's sessions *in place*, so reordering on one tab never
 * reshuffles the others.
 */
export function replaceSessionsOfKind(
  sessions: SavedSession[],
  kind: StudyKind,
  next: SavedSession[]
): SavedSession[] {
  const out: SavedSession[] = [];
  let inserted = false;
  for (const session of sessions) {
    if (session.kind === kind) {
      if (!inserted) {
        out.push(...next);
        inserted = true;
      }
      continue;
    }
    out.push(session);
  }
  if (!inserted) out.push(...next);
  return out;
}

let idCounter = 0;

/** Ids only need to be unique within this browser. */
export function newSessionId(): string {
  idCounter += 1;
  return `${Date.now().toString(36)}-${idCounter.toString(36)}`;
}