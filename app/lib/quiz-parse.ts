/**
 * Validates raw model output into `QuizQuestion[]`.
 *
 * A model asked for strict JSON will still, occasionally, drop a field or
 * mislabel a type. Rather than failing the whole generation, malformed
 * questions are dropped and the rest are kept — the user gets a shorter quiz
 * instead of an error page. Options are re-shuffled here too, because "in a
 * random order" is an instruction the model may quietly ignore.
 */

import type { QuizQuestion, QuizQuestionType } from "./quiz-types";
import { QUIZ_QUESTION_TYPES } from "./quiz-types";
import { extractJson } from "./quiz-prompt";

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

function isQuestionType(value: unknown): value is QuizQuestionType {
  return typeof value === "string" && (QUIZ_QUESTION_TYPES as string[]).includes(value);
}

/** Count the `___` gaps in a sentence. */
function countBlanks(sentence: string): number {
  return (sentence.match(/_{2,}/g) ?? []).length;
}

/**
 * Coerce one raw entry into a question, or null when it is too malformed to
 * render. The per-type requirements enforced here mirror the prompt:
 *  * every type needs a prompt and a non-empty answer
 *  * `multiple-choice` needs 2+ options, with the answer among them
 *  * `fill-blanks` needs a sentence containing at least one gap
 *  * `true-false` normalises its answer to "true"/"false"
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
    const options = asStringArray(entry.options);
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
