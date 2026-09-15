/** Client-side quiz preferences and saved sessions. */

import type { QuizConfig } from "~/lib/quiz-types";
import { DEFAULT_QUIZ_CONFIG, QUIZ_SOURCE_KINDS, QUIZ_TIME_LIMITS } from "~/lib/quiz-types";

const CONFIG_KEY = "jv:quiz:config";
const SESSIONS_KEY = "jv:quiz:sessions";

// ---------------------------------------------------------------------------
// Last-used configuration
// ---------------------------------------------------------------------------

/**
 * Read the stored config, merged over the defaults so a config saved before a
 * field existed still loads (and so a hand-edited value can't produce a config
 * the builder has no control for).
 */
export function loadQuizConfig(): QuizConfig {
  if (typeof window === "undefined") return { ...DEFAULT_QUIZ_CONFIG };
  try {
    const raw = window.localStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...DEFAULT_QUIZ_CONFIG };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_QUIZ_CONFIG };
    return normalizeConfig(parsed as Partial<QuizConfig>);
  } catch {
    return { ...DEFAULT_QUIZ_CONFIG };
  }
}

export function saveQuizConfig(config: QuizConfig) {
  try {
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch {
    // Storage unavailable — the in-session config still applies.
  }
}

/**
 * Merge a partial config over the defaults, dropping anything malformed.
 * Neither `sources` nor `types` is ever allowed to end up empty: the builder
 * requires at least one of each.
 */
export function normalizeConfig(raw: Partial<QuizConfig>): QuizConfig {
  const types = Array.isArray(raw.types)
    ? raw.types.filter((type) =>
        ["multiple-choice", "input", "fill-blanks", "true-false"].includes(type as string)
      )
    : [];

  // `sources` replaced the old single `source` field; a config saved before the
  // change (or a hand-edited one) still resolves to something usable.
  const sources = Array.isArray(raw.sources)
    ? raw.sources.filter((kind) =>
        (QUIZ_SOURCE_KINDS as string[]).includes(kind as string)
      )
    : [];

  const difficulty =
    raw.difficulty === "easy" || raw.difficulty === "normal" || raw.difficulty === "hard"
      ? raw.difficulty
      : DEFAULT_QUIZ_CONFIG.difficulty;

  return {
    sources: sources.length > 0 ? sources : [...DEFAULT_QUIZ_CONFIG.sources],
    focus: ["all", "meaning", "reading", "kanji", "usage"].includes(raw.focus as string)
      ? (raw.focus as QuizConfig["focus"])
      : DEFAULT_QUIZ_CONFIG.focus,
    lists: Array.isArray(raw.lists)
      ? raw.lists.filter((id): id is number => typeof id === "number")
      : [],
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
    pos: typeof raw.pos === "string" ? raw.pos : "",
    ruleKind: raw.ruleKind === "word" || raw.ruleKind === "sentence" ? raw.ruleKind : "",
    ruleIds: Array.isArray(raw.ruleIds)
      ? raw.ruleIds.filter((id): id is number => typeof id === "number")
      : null,
    questionCount:
      typeof raw.questionCount === "number" && raw.questionCount > 0
        ? Math.min(Math.max(Math.round(raw.questionCount), 1), 50)
        : DEFAULT_QUIZ_CONFIG.questionCount,
    timeLimitEnabled: raw.timeLimitEnabled !== false,
    // Snapped to the ladder the builder's slider offers, so a hand-edited or
    // long-stale value can never leave the slider without a position.
    timeLimitSeconds: QUIZ_TIME_LIMITS.includes(raw.timeLimitSeconds as number)
      ? (raw.timeLimitSeconds as number)
      : DEFAULT_QUIZ_CONFIG.timeLimitSeconds,
    retryMissed: raw.retryMissed === true,
    starredOnly: raw.starredOnly === true,
    types: types.length > 0 ? types : [...DEFAULT_QUIZ_CONFIG.types],
    distribution: raw.distribution === "random" ? "random" : "even",
    difficulty,
  };
}

// ---------------------------------------------------------------------------
// Saved sessions
// ---------------------------------------------------------------------------

export interface SavedQuizSession extends QuizConfig {
  id: string;
  name: string;
  createdAt: number;
}

/** Saved sessions are capped so the drawer never grows without bound. */
export const MAX_QUIZ_SESSIONS = 30;

function normalizeSession(item: unknown): SavedQuizSession | null {
  if (!item || typeof item !== "object") return null;
  const raw = item as Partial<SavedQuizSession>;
  if (typeof raw.id !== "string" || typeof raw.name !== "string") return null;
  return {
    ...normalizeConfig(raw),
    id: raw.id,
    name: raw.name,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
  };
}

export function loadQuizSessions(): SavedQuizSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SESSIONS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeSession)
      .filter((session): session is SavedQuizSession => session !== null);
  } catch {
    return [];
  }
}

export function saveQuizSessions(sessions: SavedQuizSession[]) {
  try {
    window.localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  } catch {
    // ignore
  }
}

let idCounter = 0;

/** Ids only need to be unique within this browser. */
export function newQuizSessionId(): string {
  idCounter += 1;
  return `${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

// ---------------------------------------------------------------------------
// Right/wrong log
// ---------------------------------------------------------------------------

/**
 * Cumulative per-item accuracy. Lives in Convex (see `convex/quizStats.ts`)
 * rather than localStorage, so it follows the account across devices — these
 * types are shared with that query's result shape.
 *
 * The key is the library item a question came from (`rule:3`, `word:12`), which
 * is what persists between sessions: the questions themselves are regenerated
 * every time.
 */
export interface QuizItemStat {
  correct: number;
  wrong: number;
  /** Epoch ms of the last attempt, for "recently missed" ordering. */
  lastAt: number;
}

export type QuizStatsMap = Record<string, QuizItemStat>;

/** The log key for a question's source item. */
export function quizStatKey(kind: "word" | "rule", itemId: number): string {
  return `${kind}:${itemId}`;
}

/** Split a log key back into its kind and id. */
export function parseQuizStatKey(key: string): { kind: "word" | "rule"; itemId: number } | null {
  const match = /^(word|rule):(\d+)$/.exec(key);
  if (!match) return null;
  return { kind: match[1] as "word" | "rule", itemId: Number(match[2]) };
}

export function totalQuizAnswers(stats: QuizStatsMap): { correct: number; wrong: number } {
  let correct = 0;
  let wrong = 0;
  for (const stat of Object.values(stats)) {
    correct += stat.correct;
    wrong += stat.wrong;
  }
  return { correct, wrong };
}

/** The items answered wrong at least once, worst accuracy first. */
export function weakestItems(
  stats: QuizStatsMap,
  limit = 5
): { key: string; stat: QuizItemStat }[] {
  return Object.entries(stats)
    .filter(([, stat]) => stat.wrong > 0)
    .sort((a, b) => {
      const aTotal = a[1].correct + a[1].wrong;
      const bTotal = b[1].correct + b[1].wrong;
      const ratio = b[1].wrong / bTotal - a[1].wrong / aTotal;
      if (ratio !== 0) return ratio;
      return b[1].lastAt - a[1].lastAt;
    })
    .slice(0, limit)
    .map(([key, stat]) => ({ key, stat }));
}

/**
 * The ids the user keeps getting wrong, split by what they point at, worst
 * first. Only items with at least one wrong answer qualify — a "retry my
 * misses" quiz over items you have never missed would be empty.
 *
 * `kind` is the word/rule split, so the two can be fed straight into the
 * source-scoping queries (which take a single `CardIdFilter` of ids).
 */
export function weakestIds(
  stats: QuizStatsMap,
  kind: "word" | "rule"
): number[] {
  return weakestItems(stats, Number.MAX_SAFE_INTEGER)
    .map(({ key }) => parseQuizStatKey(key))
    .filter((parsed): parsed is { kind: "word" | "rule"; itemId: number } => parsed !== null)
    .filter((parsed) => parsed.kind === kind)
    .map((parsed) => parsed.itemId);
}
