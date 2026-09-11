import type { RuleKind } from "~/lib/db.server";
import { parseTags } from "~/lib/tags";

/**
 * The editable shape of a rule, shared by the client (multi-rule create form)
 * and the server action so both validate JSON the same way. Only *types* are
 * pulled from `db.server`, so this module is safe to import in the browser.
 */

export interface RuleDraftExample {
  japanese: string;
  english: string;
}

export interface RuleDraft {
  kind: RuleKind;
  title: string;
  /** Up to four ポイント (point!) lines, e.g. "Verb stem + ます". */
  points: string[];
  explanation: string;
  /** Comma-separated in the UI, split with `parseTags` before saving. */
  tags: string;
  examples: RuleDraftExample[];
  /** Ids of rules an admin linked by hand — never inferred from the content. */
  relatedIds: number[];
}

/** Validated rule, ready for `createRule`/`updateRule`. */
export interface RulePayload {
  kind: RuleKind;
  title: string;
  explanation: string;
  points: string[];
  tags: string[];
  examples: RuleDraftExample[];
  relatedIds: number[];
}

export const MAX_RULES = 100;
export const MAX_EXAMPLES = 20;
/** A rule can show at most this many ポイント callouts. */
export const MAX_POINTS = 4;

export const EMPTY_RULE_DRAFT: RuleDraft = {
  kind: "word",
  title: "",
  points: [],
  explanation: "",
  tags: "",
  examples: [],
  relatedIds: [],
};

/** Rules arrive as a single object or an array — treat both the same. */
function toObjectList(parsed: unknown): Record<string, unknown>[] {
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list.filter(
    (item): item is Record<string, unknown> => !!item && typeof item === "object"
  );
}

function readExamples(raw: unknown): RuleDraftExample[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_EXAMPLES)
    .map((entry) => {
      const obj = (entry ?? {}) as Record<string, unknown>;
      return {
        japanese: typeof obj.japanese === "string" ? obj.japanese.trim() : "",
        english: typeof obj.english === "string" ? obj.english.trim() : "",
      };
    })
    .filter((example) => example.japanese.length > 0);
}

/**
 * Points arrive as `points: [...]`, but a single legacy `pattern` string (or
 * `point`) is still accepted and treated as the first point.
 */
function readPoints(obj: Record<string, unknown>): string[] {
  const raw = obj.points ?? obj.pattern ?? obj.point;
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .filter((point): point is string => typeof point === "string")
    .map((point) => point.trim())
    .filter((point) => point.length > 0)
    .slice(0, MAX_POINTS);
}

/** Related-rule ids: positive integers, deduped. */
function readRelatedIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const ids = raw
    .map((value) => (typeof value === "number" ? value : Number.parseInt(String(value), 10)))
    .filter((id) => Number.isInteger(id) && id > 0);
  return [...new Set(ids)];
}

function objectToDraft(obj: Record<string, unknown>): RuleDraft {
  const kind = obj.kind === "sentence" ? "sentence" : "word";
  const rawTags = obj.tags;
  const tags = Array.isArray(rawTags)
    ? rawTags.filter((tag): tag is string => typeof tag === "string").join(", ")
    : typeof rawTags === "string"
      ? rawTags
      : "";

  return {
    kind,
    title: typeof obj.title === "string" ? obj.title.trim() : "",
    points: readPoints(obj),
    explanation: typeof obj.explanation === "string" ? obj.explanation.trim() : "",
    tags,
    examples: readExamples(obj.examples ?? obj.example),
    relatedIds: readRelatedIds(obj.relatedIds ?? obj.related),
  };
}

/**
 * Parse pasted JSON into rule drafts — used by the "Fill form from JSON"
 * button, so an import *populates the form* instead of writing to the database.
 */
export function parseRuleJson(
  text: string
): { ok: true; drafts: RuleDraft[] } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "Please paste or choose some JSON first." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: "Could not parse JSON — please check the format." };
  }

  const list = toObjectList(parsed);
  if (list.length === 0) {
    return { ok: false, error: "The JSON is empty — nothing to fill in." };
  }
  if (list.length > MAX_RULES) {
    return { ok: false, error: `Too many rules: fill in at most ${MAX_RULES} at a time.` };
  }

  return { ok: true, drafts: list.map(objectToDraft) };
}

/** Validate one draft and normalize it for the database. */
export function draftToRulePayload(
  draft: RuleDraft
): { ok: true; payload: RulePayload } | { ok: false; error: string } {
  const title = draft.title.trim();
  const explanation = draft.explanation.trim();
  if (!title) return { ok: false, error: "a title is required." };
  if (!explanation) return { ok: false, error: "an explanation is required." };

  return {
    ok: true,
    payload: {
      kind: draft.kind === "sentence" ? "sentence" : "word",
      title: title.slice(0, 120),
      explanation: explanation.slice(0, 2000),
      points: draft.points
        .map((point) => point.trim())
        .filter((point) => point.length > 0)
        .slice(0, MAX_POINTS)
        .map((point) => point.slice(0, 200)),
      tags: parseTags(draft.tags),
      examples: draft.examples
        .filter((example) => example.japanese.trim().length > 0)
        .slice(0, MAX_EXAMPLES)
        .map((example) => ({
          japanese: example.japanese.trim().slice(0, 500),
          english: example.english.trim().slice(0, 500),
        })),
      relatedIds: readRelatedIds(draft.relatedIds),
    },
  };
}

/** Parse the drafts a form posted back, tolerating anything unexpected. */
export function readRuleDrafts(text: string): { ok: true; drafts: RuleDraft[] } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "Add at least one rule." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: "The rules could not be read. Please try again." };
  }

  const list = toObjectList(parsed);
  if (list.length === 0) return { ok: false, error: "Add at least one rule." };
  if (list.length > MAX_RULES) {
    return { ok: false, error: `Too many rules: create at most ${MAX_RULES} at a time.` };
  }
  return { ok: true, drafts: list.map(objectToDraft) };
}
