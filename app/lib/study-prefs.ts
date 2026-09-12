/** Client-side study preferences & saved sessions (localStorage). */

import type { RuleKind } from "~/lib/db.server";

export const REPETITION_KEY = "jv:study:repetition";

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
  limit: number;
}

export const DEFAULT_STUDY_CONFIG: StudyConfig = {
  lists: [],
  tags: [],
  pos: "",
  ruleKind: "",
  important: false,
  limit: 40,
};

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

function normalizeSession(item: unknown): SavedSession | null {
  if (!item || typeof item !== "object") return null;
  const raw = item as Partial<SavedSession>;
  if (typeof raw.id !== "string" || typeof raw.name !== "string") return null;
  if (!Array.isArray(raw.lists) || !Array.isArray(raw.tags)) return null;
  if (typeof raw.limit !== "number") return null;

  const kind: StudyKind =
    raw.kind === "phrases" || raw.kind === "forms" ? raw.kind : "words";

  return {
    id: raw.id,
    name: raw.name,
    kind,
    lists: raw.lists.filter((id): id is number => typeof id === "number"),
    tags: raw.tags.filter((tag): tag is string => typeof tag === "string"),
    pos: typeof raw.pos === "string" ? raw.pos : "",
    ruleKind: raw.ruleKind === "word" || raw.ruleKind === "sentence" ? raw.ruleKind : "",
    important: raw.important === true,
    limit: raw.limit,
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