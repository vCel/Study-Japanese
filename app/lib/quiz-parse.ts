/**
 * Validates raw model output into `QuizQuestion[]`.
 *
 * A model asked for strict JSON will still, occasionally, drop a field or
 * mislabel a type. Rather than failing the whole generation, malformed
 * questions are dropped and the rest are kept — the user gets a shorter quiz
 * instead of an error page. Options are re-shuffled here too, because "in a
 * random order" is an instruction the model may quietly ignore.
 *
 * One failure is neither malformed nor re-shufflable: a question that spells
 * out its own answer. The prompt asks the model not to, and it does anyway —
 * see {@link leaksAnswer}.
 */

import type { QuizQuestion, QuizQuestionType } from "./quiz-types";
import { QUIZ_QUESTION_TYPES } from "./quiz-types";
import { extractJson } from "./quiz-prompt";
import { stripEmphasis, stripFurigana } from "./furigana";

/** Fisher-Yates, so an option pool can be relied on to be unordered. */
function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asString(item))
    .filter((item): item is string => item !== null);
}

/**
 * Drop repeated options, comparing on a trimmed, case-folded form.
 *
 * A pool that lists the same string twice — most damagingly, the answer twice —
 * cannot be rendered as a single-choice question: the user would see two
 * identical buttons and only one of them would be marked right.
 *
 * Deliberately *not* applied to fill-blanks: there the pool is a bank, and a
 * two-gap answer legitimately needs the same filler twice (「は, は」).
 */
function dedupeOptions(options: string[]): string[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    const key = option.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isQuestionType(value: unknown): value is QuizQuestionType {
  return typeof value === "string" && (QUIZ_QUESTION_TYPES as string[]).includes(value);
}

/** Count the `___` gaps in a sentence. */
function countBlanks(sentence: string): number {
  return (sentence.match(/_{2,}/g) ?? []).length;
}

/**
 * Anything the model writes in kana or kanji.
 *
 * Includes the iteration marks `々` / `〆`, which sit outside the kana blocks
 * and would otherwise make `日々` look like a Latin string.
 */
const JAPANESE = /[\u3005\u3006\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/** The comparison form of a string: annotations and emphasis markers gone. */
function comparable(text: string): string {
  return stripEmphasis(stripFurigana(text)).trim().toLowerCase();
}

/**
 * Whether the answer is spelled out somewhere the learner can read it.
 *
 * This is the mechanical half of the giveaway rule in `quiz-prompt.ts`. The
 * prompt asks the model not to reveal the answer, and models keep doing it
 * anyway — a meaning question whose options are English and whose prompt
 * already states the meaning, or a sentence quoted with the tested word still
 * in it. Both are decidable here by comparison, so they are not left to
 * compliance. What stays the prompt's job is the *semantic* half: whether a
 * distractor happens to be defensible too.
 *
 * Three deliberate imprecisions, all erring towards keeping a question, since a
 * false drop costs the learner a question they never see:
 *
 * - Readings count as text. The model annotates everything, so an annotation
 *   left over the tested word (`学生《がくせい》` for a question asking how to
 *   read 学生) is a leak even though the base text is bare.
 * - A one-character answer is never a leak. Particle questions answer 「は」 or
 *   「に」, which turn up in almost any Japanese sentence; matching on something
 *   that short would cost real questions to coincidences.
 * - Latin answers match on word boundaries, so "eat" is not found inside
 *   "great". Japanese has no such boundaries and is matched by containment.
 */
function leaksAnswer(text: string, answer: string): boolean {
  const needle = comparable(answer);
  if (needle.length < 2) return false;

  const haystacks = [text, stripFurigana(text)].map((value) => value.toLowerCase());

  if (JAPANESE.test(needle)) {
    const stem = uninflected(needle);
    return haystacks.some(
      (haystack) => haystack.includes(needle) || (stem !== null && haystack.includes(stem))
    );
  }

  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const word = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`);
  return haystacks.some((haystack) => word.test(haystack));
}

/**
 * The part of a Japanese word that survives conjugation, or null when there is
 * nothing safe left to compare.
 *
 * Only the trailing *hiragana* comes off, because that is where a Japanese
 * ending lives: a sentence quoting 「召し上がりましたか」 contains 召し上がる for
 * every practical purpose and yet not as a substring, which is the exact shape
 * of a question that quotes the verb it is testing. Katakana is left alone —
 * loanwords do not inflect, and trimming ー would turn コーヒー into a stem of
 * its own.
 *
 * A stem under two characters is not a test: 食べる reduces to 食, and single
 * kanji turn up in too much of the language to mean anything.
 */
function uninflected(needle: string): string | null {
  const stem = needle.replace(/[\u3040-\u309f]+$/, "");
  return stem.length >= 2 && stem !== needle ? stem : null;
}

/**
 * Coerce one raw entry into a question, or null when it is too malformed to
 * render. The per-type requirements enforced here mirror the prompt:
 *  * every type needs a prompt and a non-empty answer
 *  * `multiple-choice` needs 2+ *distinct* options, with the answer among them
 *  * `fill-blanks` needs a sentence containing at least one gap
 *  * `true-false` normalises its answer to "true"/"false"
 *  * no type but `true-false` may contain its own answer (see `leaksAnswer`)
 *
 * What this cannot check is whether a distractor is *semantically* also valid —
 * that is the prompt's job (see `## Distractor quality` in `quiz-prompt.ts`).
 */
function parseQuestion(raw: unknown, index: number): QuizQuestion | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;

  if (!isQuestionType(entry.type)) return null;
  const type = entry.type;

  const prompt = asString(entry.prompt);
  const answer = asString(entry.answer);
  if (!prompt || !answer) return null;

  const explanation = asString(entry.explanation) ?? undefined;
  const sourceId = typeof entry.sourceId === "number" ? entry.sourceId : undefined;
  // Rule ids and word ids are separate sequences, so a quiz spanning both needs
  // this to link (and log) the answer against the right item. Dropped rather
  // than guessed when unrecognised — a wrong guess would misattribute a miss.
  const sourceKind: "word" | "rule" | undefined =
    entry.sourceKind === "rule" || entry.sourceKind === "word" ? entry.sourceKind : undefined;

  const base = {
    id: `q${index}`,
    type,
    prompt,
    explanation,
    sourceId,
    sourceKind,
  };

  // `true-false` is exempt: its answer is the word "true" or "false", which a
  // prompt reading "True or false: …" contains by construction. Everything else
  // is checked against both strings the learner sees, prompt and sentence.
  if (type !== "true-false") {
    const sentence = asString(entry.sentence);
    if (leaksAnswer(prompt, answer) || (sentence !== null && leaksAnswer(sentence, answer))) {
      return null;
    }
  }

  if (type === "true-false") {
    const normalized = answer.toLowerCase();
    const truthy = ["true", "yes", "correct", "正しい", "○", "o"].includes(normalized);
    const falsy = ["false", "no", "incorrect", "incorrect.", "誤り", "×", "x"].includes(normalized);
    if (!truthy && !falsy) return null;
    const sentence = asString(entry.sentence) ?? undefined;
    return {
      ...base,
      answer: truthy ? "true" : "false",
      sentence,
      // Show the sentence as the prompt when the model only filled "sentence".
      prompt: sentence && prompt.length < sentence.length ? `${prompt}\n${sentence}` : prompt,
    };
  }

  if (type === "fill-blanks") {
    const sentence = asString(entry.sentence) ?? prompt;
    const blanks = countBlanks(sentence);
    if (blanks === 0) return null;
    const options = asStringArray(entry.options);
    return {
      ...base,
      sentence,
      blanks: typeof entry.blanks === "number" ? entry.blanks : blanks,
      // Re-shuffle so the bank order is never a hint.
      options: options.length > 0 ? shuffle(options) : undefined,
      answer,
      acceptableAnswers: asStringArray(entry.acceptableAnswers),
    };
  }

  if (type === "multiple-choice") {
    const options = dedupeOptions(asStringArray(entry.options));
    if (options.length < 2) return null;
    // The answer has to be one of the options, or the question is unanswerable.
    if (!options.includes(answer)) return null;
    return {
      ...base,
      options: shuffle(options),
      answer,
      acceptableAnswers: asStringArray(entry.acceptableAnswers),
    };
  }

  // input
  return {
    ...base,
    answer,
    acceptableAnswers: asStringArray(entry.acceptableAnswers),
  };
}

export interface ParseResult {
  questions: QuizQuestion[];
  /** How many raw entries were rejected, for logging/diagnostics. */
  dropped: number;
}

/**
 * Parse a model response into questions, keeping at most `limit` of them.
 * Throws only when nothing usable came back at all — at that point the caller
 * should treat the attempt as failed and move to the next model.
 */
export function parseQuizQuestions(text: string, limit: number): ParseResult {
  let payload: unknown;
  try {
    payload = extractJson(text);
  } catch {
    throw new Error("The model's response was not JSON.");
  }

  const rawList = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { questions?: unknown }).questions)
      ? ((payload as { questions: unknown[] }).questions)
      : null;

  if (!rawList) throw new Error("The model's JSON had no questions array.");

  const questions: QuizQuestion[] = [];
  let dropped = 0;
  for (let index = 0; index < rawList.length && questions.length < limit; index++) {
    const parsed = parseQuestion(rawList[index], questions.length);
    if (parsed) questions.push(parsed);
    else dropped += 1;
  }

  if (questions.length === 0) {
    throw new Error("Every generated question was malformed.");
  }

  return { questions, dropped };
}
