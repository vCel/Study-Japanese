/**
 * Vocabulary JSON parsing & validation (shared between client & server).
 * Accepts a single object or an array, with tolerant key aliases.
 */

import { kanaFormName } from "./form-names";

export interface VocabExample {
  japanese: string;
  translation: string | null;
}

/** One conjugation form pair, e.g. { name: "ます", value: "食べます" }. */
export interface VocabForm {
  name: string;
  value: string;
}

export interface VocabEntry {
  word: string;
  kana: string;
  pos: string | null;
  /** Refines `pos` — e.g. verb → "group1"/"group2"/"group3", adjective → "i-adjective"/"na-adjective". */
  subtype: string | null;
  meanings: string[];
  examples: VocabExample[];
  /** Free-text notes about this entry (null = none). */
  notes: string | null;
  /** Conjugation forms, in display order (empty = none). */
  forms: VocabForm[];
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

/**
 * The subtypes offered per part of speech. The value stored is the key
 * ("group1", "i-adjective", …); the label is what the UI shows.
 */
export const POS_SUBTYPES: Record<string, { value: string; label: string }[]> = {
  verb: [
    { value: "group1", label: "Group 1 (Godan 五段)" },
    { value: "group2", label: "Group 2 (Ichidan 一段)" },
    { value: "group3", label: "Group 3 (Irregular)" },
  ],
  adjective: [
    { value: "i-adjective", label: "i-adjective (い形容詞)" },
    { value: "na-adjective", label: "na-adjective (な形容詞)" },
  ],
  noun: [
    { value: "common", label: "Common noun" },
    { value: "proper", label: "Proper noun" },
    { value: "suffix", label: "Suffix (接尾辞)" },
  ],
  // Adverb classes (日本語の副詞の分類): time, frequency, manner, degree and
  // statement/illocutionary adverbs.
  adverb: [
    { value: "temporal", label: "Temporal (時間)" },
    { value: "frequency", label: "Frequency (頻度)" },
    { value: "manner", label: "Manner (様態)" },
    { value: "degree", label: "Degree (程度)" },
    { value: "statement", label: "Statement (陳述)" },
  ],
};

/** The subtype options for a canonical pos (empty when it has none). */
export function subtypeOptionsFor(pos: string | null): { value: string; label: string }[] {
  return pos ? POS_SUBTYPES[pos] ?? [] : [];
}

/** Human label for a stored subtype value (falls back to the value itself). */
export function subtypeLabel(value: string | null): string | null {
  if (!value) return null;
  for (const options of Object.values(POS_SUBTYPES)) {
    const option = options.find((o) => o.value === value);
    if (option) return option.label;
  }
  return value;
}

/** Aliases accepted on import, mapped to the canonical stored value. */
const SUBTYPE_ALIASES: Record<string, string> = {
  // Verb groups — Godan (Group 1 / u-verbs), Ichidan (Group 2 / ru-verbs),
  // Irregular (Group 3 / する・来る).
  group1: "group1",
  "group 1": "group1",
  "group-1": "group1",
  "group i": "group1",
  "group-i": "group1",
  "group one": "group1",
  "group 1 verb": "group1",
  "group 1 verbs": "group1",
  g1: "group1",
  "type 1": "group1",
  type1: "group1",
  "class 1": "group1",
  class1: "group1",
  godan: "group1",
  "godan verb": "group1",
  "godan verbs": "group1",
  "godan-verb": "group1",
  "五段": "group1",
  "五段動詞": "group1",
  "5段": "group1",
  "5-dan": "group1",
  "第1グループ": "group1",
  "グループ1": "group1",
  "1類": "group1",
  "一類": "group1",
  "一类": "group1",
  "一类动词": "group1",
  "u-verb": "group1",
  "u-verbs": "group1",
  "u verb": "group1",
  "u verbs": "group1",
  "う-verb": "group1",
  "う-verbs": "group1",
  "godan u-verb": "group1",
  "godan u verb": "group1",
  "u-verb (godan)": "group1",
  "u verb (godan)": "group1",
  group2: "group2",
  "group 2": "group2",
  "group-2": "group2",
  "group ii": "group2",
  "group-ii": "group2",
  "group two": "group2",
  "group 2 verb": "group2",
  "group 2 verbs": "group2",
  g2: "group2",
  "type 2": "group2",
  type2: "group2",
  "class 2": "group2",
  class2: "group2",
  ichidan: "group2",
  "ichidan verb": "group2",
  "ichidan verbs": "group2",
  "ichidan-verb": "group2",
  "一段": "group2",
  "一段動詞": "group2",
  "1段": "group2",
  "1-dan": "group2",
  "ru-verb": "group2",
  "ru-verbs": "group2",
  "ru verb": "group2",
  "ru verbs": "group2",
  "る-verb": "group2",
  "る-verbs": "group2",
  "第2グループ": "group2",
  "グループ2": "group2",
  "2類": "group2",
  "二類": "group2",
  "二类": "group2",
  "二类动词": "group2",
  "ichidan ru-verb": "group2",
  "ichidan ru verb": "group2",
  "ru-verb (ichidan)": "group2",
  "ru verb (ichidan)": "group2",
  group3: "group3",
  "group 3": "group3",
  "group-3": "group3",
  "group iii": "group3",
  "group-iii": "group3",
  "group three": "group3",
  "group 3 verb": "group3",
  "group 3 verbs": "group3",
  g3: "group3",
  "type 3": "group3",
  type3: "group3",
  "class 3": "group3",
  class3: "group3",
  irregular: "group3",
  "irregular verb": "group3",
  "irregular verbs": "group3",
  "irregular-verb": "group3",
  "変格": "group3",
  "変格動詞": "group3",
  "第3グループ": "group3",
  "グループ3": "group3",
  "3類": "group3",
  "三類": "group3",
  "三类": "group3",
  "三类动词": "group3",
  "suru/kuru": "group3",
  "kuru/suru": "group3",
  "suru and kuru": "group3",
  "suru and kuru verbs": "group3",
  "する/来る": "group3",
  suru: "group3",
  kuru: "group3",
  "suru verb": "group3",
  "suru verbs": "group3",
  "suru-verb": "group3",
  "kuru verb": "group3",
  "kuru verbs": "group3",
  "kuru-verb": "group3",
  "サ変": "group3",
  "カ変": "group3",
  "サ変動詞": "group3",
  "カ変動詞": "group3",
  "sa-hen": "group3",
  "ka-hen": "group3",
  sahen: "group3",
  kahen: "group3",
  // Adjectives — note: only with the i-/na- prefix, so bare "adjective"
  // never maps to one of these.
  "i-adjective": "i-adjective",
  "i adjective": "i-adjective",
  "i-adjectives": "i-adjective",
  "i-adj": "i-adjective",
  "i-adj(s)": "i-adjective",
  "i adj": "i-adjective",
  "i-adjs": "i-adjective",
  "い-adjective": "i-adjective",
  "い adjective": "i-adjective",
  "い形容詞": "i-adjective",
  "形容詞(い)": "i-adjective",
  "形容詞 (い)": "i-adjective",
  "adjective (i)": "i-adjective",
  "い型": "i-adjective",
  "i型": "i-adjective",
  "いadj": "i-adjective",
  "い adj": "i-adjective",
  "い-adjs": "i-adjective",
  "i-type": "i-adjective",
  "adj-i": "i-adjective",
  "adj i": "i-adjective",
  "na-adjective": "na-adjective",
  "na adjective": "na-adjective",
  "na-adjectives": "na-adjective",
  "na-adj": "na-adjective",
  "na-adj(s)": "na-adjective",
  "na adj": "na-adjective",
  "na-adjs": "na-adjective",
  "な-adjective": "na-adjective",
  "な adjective": "na-adjective",
  "な形容詞": "na-adjective",
  "形容詞(な)": "na-adjective",
  "形容詞 (な)": "na-adjective",
  "adjective (na)": "na-adjective",
  "な型": "na-adjective",
  "na型": "na-adjective",
  "い-type": "i-adjective",
  "な-type": "na-adjective",
  "なadj": "na-adjective",
  "な adj": "na-adjective",
  "な-adjs": "na-adjective",
  "na-type": "na-adjective",
  "adj-na": "na-adjective",
  "adj na": "na-adjective",
  // Nouns
  common: "common",
  "common noun": "common",
  "common nouns": "common",
  "common-noun": "common",
  "common name": "common",
  "普通名詞": "common",
  "普通": "common",
  proper: "proper",
  "proper noun": "proper",
  "proper nouns": "proper",
  "proper-noun": "proper",
  "proper name": "proper",
  "固有名詞": "proper",
  "固有名": "proper",
  // Suffixes (接尾辞): ～さん, ～人. A noun subtype, so these words stay in the
  // Nouns filter while keeping the suffix distinction.
  suffix: "suffix",
  suffixes: "suffix",
  "suffix noun": "suffix",
  "noun suffix": "suffix",
  "接尾辞": "suffix",
  "接尾語": "suffix",
  "せつびじ": "suffix",
  // Adverbs: temporal / frequency / manner / degree / statement classes
  temporal: "temporal",
  "time adverb": "temporal",
  "time adverbs": "temporal",
  "time": "temporal",
  "時間": "temporal",
  "時間副詞": "temporal",
  "時の副詞": "temporal",
  frequency: "frequency",
  "frequency adverb": "frequency",
  "頻度": "frequency",
  "頻度副詞": "frequency",
  manner: "manner",
  "manner adverb": "manner",
  "様態": "manner",
  "様態副詞": "manner",
  "方式": "manner",
  degree: "degree",
  "degree adverb": "degree",
  "intensity": "degree",
  "程度": "degree",
  "程度副詞": "degree",
  statement: "statement",
  "statement adverb": "statement",
  "sentential": "statement",
  "illocutionary": "statement",
  "assertive": "statement",
  "陳述": "statement",
  "陳述副詞": "statement",
};

const SUBTYPE_KEYS = [
  "subtype",
  "subType",
  "sub_type",
  "wordSubtype",
  "word_subtype",
  "subtypeName",
  "subTypeName",
  "subclass",
  "type2",
  "class2",
] as const;

/**
 * Match alias keys ignoring spaces, hyphens, slashes, parentheses and other
 * punctuation, so near-miss spellings ("Group-I", "i adj.", "godan (u-verb)")
 * resolve without an explicit entry.
 */
const ALIAS_COLLAPSE = /[^\p{L}\p{N}]/gu;
const SUBTYPE_ALIASES_COLLAPSED: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const [key, target] of Object.entries(SUBTYPE_ALIASES)) {
    map[key.replace(ALIAS_COLLAPSE, "")] = target;
  }
  return map;
})();

/**
 * Parts of speech that are really a noun subtype. "suffix" has no place in
 * `POS_VALUES`, so an import saying `"pos": "suffix"` is stored as pos "noun"
 * plus subtype "suffix" — the shape the UI's selects produce, so the two entry
 * paths cannot disagree about where a suffix lives.
 */
const POS_AS_SUBTYPE: Record<string, { pos: string; subtype: string }> = {
  suffix: { pos: "noun", subtype: "suffix" },
  suffixes: { pos: "noun", subtype: "suffix" },
  "suffix noun": { pos: "noun", subtype: "suffix" },
  "noun suffix": { pos: "noun", subtype: "suffix" },
  "接尾辞": { pos: "noun", subtype: "suffix" },
  "接尾語": { pos: "noun", subtype: "suffix" },
};

const POS_AS_SUBTYPE_COLLAPSED: Record<string, { pos: string; subtype: string }> = (() => {
  const map: Record<string, { pos: string; subtype: string }> = {};
  for (const [key, target] of Object.entries(POS_AS_SUBTYPE)) {
    map[key.replace(ALIAS_COLLAPSE, "")] = target;
  }
  return map;
})();

/** The pos/subtype pair a bare pos value stands for, or null if it is a pos. */
function posAsSubtype(value: unknown): { pos: string; subtype: string } | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  return (
    POS_AS_SUBTYPE[trimmed] ??
    POS_AS_SUBTYPE_COLLAPSED[trimmed.replace(ALIAS_COLLAPSE, "")] ??
    null
  );
}

/**
 * Normalize a subtype value against the pos's catalog. Values outside the
 * catalog are dropped for pos with a catalog (keeps the data clean); other pos
 * accept short free text.
 */
function normalizeSubtype(value: unknown, pos: string | null): string | null {
  if (typeof value !== "string" || !pos) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;

  const aliased =
    SUBTYPE_ALIASES[trimmed] ?? SUBTYPE_ALIASES_COLLAPSED[trimmed.replace(ALIAS_COLLAPSE, "")];
  const options = subtypeOptionsFor(pos);
  if (options.length > 0) {
    const canonical = aliased ?? trimmed;
    return options.some((option) => option.value === canonical) ? canonical : null;
  }
  return trimmed.slice(0, 24);
}

const NOTE_KEYS = ["notes", "note", "comment", "comments"] as const;
const FORM_KEYS = ["forms", "conjugations", "form"] as const;
/** At most this many forms per entry (kept in step with db.server). */
const MAX_FORMS = 12;

function normalizeNotes(value: unknown): string | null {
  return asTrimmedString(value)?.slice(0, 2000) ?? null;
}

/**
 * Forms arrive as [{name, value}], a {name: value} map, or a bare string. Names
 * are converted to kana here, so an import cannot put `te` in the library.
 */
function normalizeForms(value: unknown): VocabForm[] {
  if (Array.isArray(value)) {
    const out: VocabForm[] = [];
    for (const item of value.slice(0, MAX_FORMS)) {
      if (typeof item === "string") {
        const text = item.trim();
        if (text) out.push({ name: "", value: text });
        continue;
      }
      if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        const name = kanaFormName(asTrimmedString(pick(obj, ["name", "form", "type", "label"])) ?? "");
        const formValue =
          asTrimmedString(pick(obj, ["value", "word", "japanese", "conjugation", "text"])) ?? "";
        if (name || formValue) out.push({ name, value: formValue });
      }
    }
    return out;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    // { "ます": "食べます", "te-form": "食べて" } — keys are the names.
    const out: VocabForm[] = [];
    for (const [name, raw] of Object.entries(value as Record<string, unknown>).slice(0, MAX_FORMS)) {
      const formValue = asTrimmedString(raw) ?? "";
      if (name.trim() || formValue) out.push({ name: kanaFormName(name), value: formValue });
    }
    return out;
  }
  const single = asTrimmedString(value);
  return single ? [{ name: "", value: single }] : [];
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
  const posField = pick(obj, POS_KEYS);
  const asSubtype = posAsSubtype(posField);
  const pos = asSubtype?.pos ?? normalizePos(posField);
  const subtype = asSubtype?.subtype ?? normalizeSubtype(pick(obj, SUBTYPE_KEYS), pos);
  const notes = normalizeNotes(pick(obj, NOTE_KEYS));
  const forms = normalizeForms(pick(obj, FORM_KEYS));

  return { word, kana, pos, subtype, meanings, examples, notes, forms };
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
    "subtype": "common",
    "meanings": ["library"],
    "examples": [
      { "japanese": "図書館で本を借りました。", "translation": "I borrowed a book at the library." }
    ],
    "notes": "図書館 = としょかん. Closed on Mondays in many towns.",
    "forms": [
      { "name": "ます-form", "value": "図書館に行きます" }
    ]
  },
  {
    "word": "食べる",
    "kana": "たべる",
    "pos": "verb",
    "subtype": "group2",
    "meanings": ["to eat"],
    "notes": "Ichidan (る-verb).",
    "forms": [
      { "name": "Dictionary", "value": "食べる" },
      { "name": "ます", "value": "食べます" },
      { "name": "て", "value": "食べて" },
      { "name": "た", "value": "食べた" },
      { "name": "ない", "value": "食べない" }
    ],
    "examples": [
      { "japanese": "朝ごはんを食べました。", "translation": "I ate breakfast." }
    ]
  }
]`;