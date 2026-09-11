/**
 * Vocabulary JSON parsing & validation (shared between client & server).
 * Accepts a single object or an array, with tolerant key aliases.
 */

export interface VocabExample {
  japanese: string;
  translation: string | null;
}

export interface VocabEntry {
  word: string;
  kana: string;
  pos: string | null;
  meanings: string[];
  examples: VocabExample[];
}

export interface ParseSuccess {
  ok: true;
  entries: VocabEntry[];
}

export interface ParseFailure {
  ok: false;
  error: string;
}

const WORD_KEYS = ["word", "kanji", "term", "expression", "japanese"] as const;
const KANA_KEYS = ["kana", "reading", "furigana", "kana_reading", "yomikata"] as const;
const POS_KEYS = ["pos", "partOfSpeech", "part_of_speech", "speechPart", "type", "class"] as const;
const MEANING_KEYS = ["meanings", "meaning", "definitions", "definition", "senses", "translations", "gloss", "glossary"] as const;
const EXAMPLE_KEYS = ["examples", "example", "sentences", "sentence", "exampleSentences"] as const;

function pick(obj: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return undefined;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function normalizeMeanings(value: unknown): string[] {
  if (typeof value === "string") {
    // Allow "a; b" or "a, b" separated strings
    const parts = value
      .split(/[;,、]/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    return parts;
  }
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const item of value) {
      if (typeof item === "string") {
        const s = item.trim();
        if (s) out.push(s);
      } else if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        const meaning = asTrimmedString(pick(obj, ["meaning", "english", "translation", "gloss", "definition", "text"]));
        if (meaning) out.push(meaning);
      }
    }
    return out;
  }
  return [];
}

function normalizeExamples(value: unknown): VocabExample[] {
  if (typeof value === "string") {
    const japanese = value.trim();
    if (!japanese) return [];
    return [{ japanese, translation: null }];
  }
  if (!Array.isArray(value)) return [];
  const out: VocabExample[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      const japanese = item.trim();
      if (japanese) out.push({ japanese, translation: null });
      continue;
    }
    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const japanese = asTrimmedString(
        pick(obj, ["japanese", "jp", "sentence", "text", "ja", "japanese_sentence"])
      );
      if (!japanese) continue;
      const translation = asTrimmedString(
        pick(obj, ["translation", "english", "meaning", "en", "translations", "gloss"])
      );
      out.push({ japanese, translation });
    }
  }
  return out;
}

const POS_SYNONYMS: Record<string, string> = {
  n: "noun",
  noun: "noun",
  nouns: "noun",
  v: "verb",
  verb: "verb",
  verbs: "verb",
  adj: "adjective",
  adjective: "adjective",
  adjectives: "adjective",
  "i-adj": "adjective",
  "na-adj": "adjective",
  adv: "adverb",
  adverb: "adverb",
  phrase: "phrase",
  phrases: "phrase",
  p: "phrase",
  expr: "expression",
  expression: "expression",
  greeting: "phrase",
  greetings: "phrase",
};

/** Normalize a part-of-speech value ("v", "Verbs", "adjective"…) to a canonical tag. */
function normalizePos(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  return POS_SYNONYMS[trimmed] ?? trimmed.slice(0, 24);
}

function normalizeEntry(raw: unknown, index: number): VocabEntry | { error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: `Entry ${index + 1} must be a JSON object.` };
  }
  const obj = raw as Record<string, unknown>;

  const word = asTrimmedString(pick(obj, WORD_KEYS));
  if (!word) return { error: `Entry ${index + 1} is missing a required "word" (or "kanji") field.` };

  const kana = asTrimmedString(pick(obj, KANA_KEYS));
  if (!kana) return { error: `Entry ${index + 1} ("${word}") is missing a required "kana" (or "reading") field.` };

  const meanings = normalizeMeanings(pick(obj, MEANING_KEYS));
  if (meanings.length === 0) {
    return { error: `Entry ${index + 1} ("${word}") needs at least one meaning ("meanings" may be a string or a list).` };
  }

  const examples = normalizeExamples(pick(obj, EXAMPLE_KEYS));
  const pos = normalizePos(pick(obj, POS_KEYS));

  return { word, kana, pos, meanings, examples };
}

export function parseVocabJson(text: string): ParseSuccess | ParseFailure {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "Please provide some JSON first." };

  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    return { ok: false, error: `Could not parse JSON: ${message}` };
  }

  const list: unknown[] = Array.isArray(data) ? data : [data];
  if (list.length === 0) return { ok: false, error: "The JSON array is empty — there is nothing to import." };
  if (list.length > 500) return { ok: false, error: "Too many entries: please import at most 500 words at a time." };

  const entries: VocabEntry[] = [];
  for (let i = 0; i < list.length; i++) {
    const result = normalizeEntry(list[i], i);
    if ("error" in result) return { ok: false, error: result.error };
    entries.push(result);
  }

  return { ok: true, entries };
}

export const SAMPLE_JSON = `[
  {
    "word": "図書館",
    "kana": "としょかん",
    "pos": "noun",
    "meanings": ["library"],
    "examples": [
      { "japanese": "図書館で本を借りました。", "translation": "I borrowed a book at the library." }
    ]
  }
]`;