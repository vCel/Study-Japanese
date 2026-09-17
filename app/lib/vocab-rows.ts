import { normalizePos, normalizeSubtype, parseVocabJson, type VocabEntry } from "~/lib/vocab";

/**
 * The row model behind the word-list and phrase create forms. Shared by the
 * client (rows editor + "Fill form from JSON") and the route actions, so both
 * sides agree on what a valid row is.
 */

export interface VocabRowExample {
  japanese: string;
  translation: string;
}

/** One conjugation form pair (辞書形 / ます / て / た / …). */
export interface VocabRowForm {
  name: string;
  value: string;
}

export interface VocabRow {
  /** The word or phrase itself. */
  word: string;
  kana: string;
  /** "" = unset (always "phrase" for the phrases page). */
  pos: string;
  /** Refines pos (verb → "group1", adjective → "i-adjective", …). "" = unset. */
  subtype: string;
  meanings: string[];
  examples: VocabRowExample[];
  /** Free-text notes ("" = none). */
  notes: string;
  /** Conjugation forms, in display order. */
  forms: VocabRowForm[];
}

export const MAX_ROWS = 200;
export const MAX_MEANINGS = 20;
export const MAX_EXAMPLES = 50;
/** A word can carry at most this many conjugation forms (in step with db.server). */
export const MAX_FORMS = 12;

export const POS_OPTIONS = [
  { value: "", label: "—" },
  { value: "noun", label: "Noun" },
  { value: "verb", label: "Verb" },
  { value: "adjective", label: "Adjective" },
  { value: "adverb", label: "Adverb" },
  { value: "other", label: "Other" },
];

export function emptyRow(overrides: Partial<VocabRow> = {}): VocabRow {
  return {
    word: "",
    kana: "",
    pos: "",
    subtype: "",
    meanings: [""],
    examples: [],
    notes: "",
    forms: [],
    ...overrides,
  };
}

/** A row can be saved once it has the word, its reading and a meaning. */
export function isRowComplete(row: VocabRow): boolean {
  return (
    row.word.trim().length > 0 &&
    row.kana.trim().length > 0 &&
    row.meanings.some((meaning) => meaning.trim().length > 0)
  );
}

/**
 * Parse pasted JSON into rows — used by *Fill form from JSON*, so importing
 * populates the form instead of writing to the database. Meanings and examples
 * are kept, so nothing is lost on the way in.
 */
export function parseVocabRows(
  text: string,
  { forcePos }: { forcePos?: string } = {}
): { ok: true; rows: VocabRow[] } | { ok: false; error: string } {
  const parsed = parseVocabJson(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const rows = parsed.entries.slice(0, MAX_ROWS).map<VocabRow>((entry) => ({
    word: entry.word,
    kana: entry.kana,
    pos: forcePos ?? entry.pos ?? "",
    subtype: forcePos ? "" : entry.subtype ?? "",
    meanings: entry.meanings.length > 0 ? entry.meanings : [""],
    examples: entry.examples.map((example) => ({
      japanese: example.japanese,
      translation: example.translation ?? "",
    })),
    notes: entry.notes ?? "",
    forms: entry.forms.map((form) => ({ name: form.name, value: form.value })),
  }));

  if (rows.length === 0) {
    return { ok: false, error: "The JSON is empty — there is nothing to fill in." };
  }
  return { ok: true, rows };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Read the rows a form posted back (tolerating anything unexpected). */
export function readVocabRows(
  raw: string,
  { forcePos }: { forcePos?: string } = {}
): { ok: true; rows: VocabRow[] } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, rows: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: "The rows could not be read. Please try again." };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: "The rows could not be read. Please try again." };
  }

  const rows: VocabRow[] = [];
  for (const item of parsed.slice(0, MAX_ROWS)) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;

    const word = asString(obj.word).trim();
    const kana = asString(obj.kana).trim();
    const meanings = (Array.isArray(obj.meanings) ? obj.meanings : [])
      .map((meaning) => asString(meaning).trim())
      .filter((meaning) => meaning.length > 0);
    const examples = (Array.isArray(obj.examples) ? obj.examples : [])
      .map((example) => {
        const row = (example ?? {}) as Record<string, unknown>;
        return {
          japanese: asString(row.japanese).trim(),
          translation: asString(row.translation).trim(),
        };
      })
      .filter((example) => example.japanese.length > 0);
    const notes = asString(obj.notes).trim();
    const forms = (Array.isArray(obj.forms) ? obj.forms : [])
      .map((form) => {
        const row = (form ?? {}) as Record<string, unknown>;
        return {
          name: asString(row.name).trim(),
          value: asString(row.value).trim(),
        };
      })
      .filter((form) => form.name.length > 0 || form.value.length > 0)
      .slice(0, MAX_FORMS);

    // Ignore rows the user never filled in.
    if (!word && !kana && meanings.length === 0) continue;
    rows.push({
      word,
      kana,
      pos: forcePos ?? asString(obj.pos).trim(),
      subtype: forcePos ? "" : asString(obj.subtype).trim(),
      meanings,
      examples,
      notes,
      forms,
    });
  }

  return { ok: true, rows };
}

/** Normalized database entries for every complete row. */
export function toEntries(rows: VocabRow[], { forcePos }: { forcePos?: string } = {}): VocabEntry[] {
  return rows.filter(isRowComplete).map((row) => {
    // Through the same normalizers as the JSON import. This is the write path
    // for the bulk editor, the uploads and the phrase form, and a pos or subtype
    // the edit form has no option for is blanked the next time the row is saved.
    const pos = forcePos ?? normalizePos(row.pos);
    return {
      word: row.word.trim().slice(0, 64),
      kana: row.kana.trim().slice(0, 64),
      pos,
      subtype: forcePos ? null : normalizeSubtype(row.subtype, pos),
      meanings: row.meanings
        .map((meaning) => meaning.trim())
        .filter((meaning) => meaning.length > 0)
        .slice(0, MAX_MEANINGS)
        .map((meaning) => meaning.slice(0, 200)),
      examples: row.examples
        .filter((example) => example.japanese.trim().length > 0)
        .slice(0, MAX_EXAMPLES)
        .map((example) => ({
          japanese: example.japanese.trim().slice(0, 500),
          translation: example.translation.trim() ? example.translation.trim().slice(0, 500) : null,
        })),
      notes: row.notes.trim() ? row.notes.trim().slice(0, 2000) : null,
      forms: row.forms
        .filter((form) => form.name.trim().length > 0 || form.value.trim().length > 0)
        .slice(0, MAX_FORMS)
        .map((form) => ({
          name: form.name.trim().slice(0, 64),
          value: form.value.trim().slice(0, 128),
        })),
    };
  });
}
