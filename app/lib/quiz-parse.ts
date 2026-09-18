/**
 * Validates raw model output into `QuizQuestion[]`.
 *
 * A model asked for strict JSON will still, occasionally, drop a field or
 * mislabel a type. Rather than failing the whole generation, malformed
 * questions are dropped and the rest are kept — the user gets a shorter quiz
 * instead of an error page. Options are re-shuffled here too, because "in a
 * random order" is an instruction the model may quietly ignore.
 *
 * Two more things the model is asked for and does anyway are settled here
 * rather than asked for again: a question returned twice is dropped (see
 * {@link factKey}), and the order is re-dealt so the quiz does not arrive in
 * blocks (see {@link interleaveByType}).
 *
 * One failure is neither malformed nor re-shufflable: a question that spells
 * out its own answer. The prompt asks the model not to, and it does anyway —
 * see {@link leaksAnswer}.
 */

import type { QuizInputForm, QuizQuestion, QuizQuestionType } from "./quiz-types";
import { QUIZ_QUESTION_TYPES } from "./quiz-types";
import { extractJson } from "./quiz-prompt";
import { KANA_ONLY, stripEmphasis, stripFurigana } from "./furigana";

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
 * Drop repeated options, comparing on {@link comparable}.
 *
 * A pool that lists the same string twice — most damagingly, the answer twice —
 * cannot be rendered as a single-choice question: the user would see two
 * identical buttons and only one of them would be marked right.
 *
 * The comparison is the same one every other option comparison in the app uses,
 * so an option the model annotated in one entry and left bare in another
 * (`乾《かわ》いて` and `乾いて`) is one option rather than two buttons the
 * learner cannot tell apart.
 *
 * Deliberately *not* applied to fill-blanks: there the pool is a bank, and a
 * two-gap answer legitimately needs the same filler twice (「は, は」).
 */
function dedupeOptions(options: string[]): string[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    const key = comparable(option);
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
 * Which of the three typing shapes a question is, read off its own fields.
 *
 * **Derived rather than declared, and deliberately so.** A question whose
 * sentence carries a gap *is* a fill-the-gap question whatever it calls itself,
 * and a mislabelled one must not cost the learner a question — so nothing here
 * can fail, and nothing here drops anything.
 *
 * The sentence decides it. With a gap it is a `blank`: the gap is the question
 * and the answer is what goes in it. Without one it is a `transform`, where the
 * sentence is the material to rewrite. Only a question with no sentence at all
 * can be a `reading`, and then only when its answer is kana — a reading is what
 * a kana answer to a bare prompt has to be. Anything else stays `undefined`,
 * meaning a plain prompt-and-type question, which is what an English gloss is.
 */
function inputForm(answer: string, sentence: string | null): QuizInputForm | undefined {
  if (sentence !== null) return countBlanks(sentence) > 0 ? "blank" : "transform";
  return KANA_ONLY.test(comparable(answer)) ? "reading" : undefined;
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
 *  * `input` has its shape read off its sentence rather than trusted (see
 *    `inputForm`)
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

  // Read once, here: the giveaway check needs it, and so does the shape of an
  // `input` question (see `inputForm`).
  const sentence = asString(entry.sentence);

  // `true-false` is exempt: its answer is the word "true" or "false", which a
  // prompt reading "True or false: …" contains by construction. Everything else
  // is checked against both strings the learner sees, prompt and sentence.
  if (type !== "true-false") {
    if (leaksAnswer(prompt, answer) || (sentence !== null && leaksAnswer(sentence, answer))) {
      return null;
    }
  }

  if (type === "true-false") {
    const normalized = answer.toLowerCase();
    const truthy = ["true", "yes", "correct", "正しい", "○", "o"].includes(normalized);
    const falsy = ["false", "no", "incorrect", "incorrect.", "誤り", "×", "x"].includes(normalized);
    if (!truthy && !falsy) return null;
    const shown = sentence ?? undefined;
    return {
      ...base,
      answer: truthy ? "true" : "false",
      sentence: shown,
      // Show the sentence as the prompt when the model only filled "sentence".
      prompt: shown && prompt.length < shown.length ? `${prompt}\n${shown}` : prompt,
    };
  }

  if (type === "fill-blanks") {
    const gapped = sentence ?? prompt;
    const blanks = countBlanks(gapped);
    if (blanks === 0) return null;
    const options = asStringArray(entry.options);
    return {
      ...base,
      sentence: gapped,
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
    // `form` is read off the question rather than taken from the model (see
    // `inputForm`); `sentence` is what the UI shows above the box.
    sentence: sentence ?? undefined,
    form: inputForm(answer, sentence),
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
 * A question's identity as a *fact*, for dropping an exact repeat.
 *
 * The prompt already forbids asking the same fact twice, and this is the part
 * of that which can be compared rather than judged: same type, same wording,
 * same answer. Deliberately that narrow — two questions about one word are
 * allowed to be different questions, so anything looser starts costing real
 * ones, and a dropped question is invisible.
 *
 * Compared through `comparable` because a model returning a question twice may
 * annotate one copy and not the other.
 */
function factKey(question: QuizQuestion): string {
  return [
    question.type,
    comparable(question.prompt),
    comparable(question.sentence ?? ""),
    comparable(question.answer),
  ].join("|");
}

/**
 * Which library item a question is about, as a comparable key.
 *
 * `sourceKind` and `sourceId` are the model's own citation of the item it wrote
 * the question from, and rule ids and word ids are separate sequences — so the
 * kind has to be part of the key, or word 7 and rule 7 would share a bucket.
 * Questions that cite nothing share one bucket, because nothing tells them
 * apart.
 */
function sourceKey(question: QuizQuestion): string {
  return `${question.sourceKind ?? "?"}:${question.sourceId ?? "?"}`;
}

/**
 * Deal one question per library item in turn.
 *
 * The second axis of the same complaint `interleaveByType` answers, and the one
 * the type interleave cannot see: a model that fixates on a single word writes
 * its six questions about that word together, and all six are the same type.
 * Within a type the item is therefore what gets spread — which is also the only
 * axis that helps in the tail, where a surplus type has no other type left to
 * put between two neighbours.
 *
 * The items keep their first-appearance order and the order within an item is
 * left alone, so the caller's shuffle still decides the sequence.
 */
function spreadBySource(questions: QuizQuestion[]): QuizQuestion[] {
  const buckets = new Map<string, QuizQuestion[]>();
  for (const question of questions) {
    const key = sourceKey(question);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(question);
    else buckets.set(key, [question]);
  }

  const groups = [...buckets.values()];
  const dealt: QuizQuestion[] = [];
  for (let round = 0; dealt.length < questions.length; round++) {
    for (const group of groups) {
      const next = group[round];
      if (next) dealt.push(next);
    }
  }
  return dealt;
}

/**
 * Deal the questions out so the types do not arrive in blocks.
 *
 * Models write one type at a time — every multiple-choice question, then every
 * typing question, then every fill-in-the-blank — however evenly the prompt
 * asks them to spread the questions. That is the same failure `shuffle` above
 * already handles for the option pool ("in a random order" is an instruction
 * the model may quietly ignore), so the order is settled here rather than asked
 * for a second time in the prompt.
 *
 * **Round-robin rather than a plain shuffle**, because a shuffle does not
 * actually guarantee what was asked for: four multiple-choice and four typing
 * questions come back from a shuffle as two blocks often enough to be noticed,
 * and two blocks is the complaint. Dealing one from each type in turn cannot
 * produce them. Which type leads, and the order within each type, are still
 * random — so a retake does not replay the same sequence.
 *
 * A type with more questions than the others keeps its surplus at the end. That
 * tail is a block, but it is the block no arrangement can avoid.
 *
 * Each type is dealt by item before the type deal runs — see `spreadBySource` —
 * because the item is the axis a model's fixation shows up on and the tail is
 * exactly where the type deal has nothing left to separate two neighbours with.
 */
function interleaveByType(questions: QuizQuestion[]): QuizQuestion[] {
  const buckets = new Map<string, QuizQuestion[]>();
  for (const question of questions) {
    const bucket = buckets.get(question.type);
    if (bucket) bucket.push(question);
    else buckets.set(question.type, [question]);
  }

  const groups = shuffle([...buckets.values()].map((bucket) => spreadBySource(shuffle(bucket))));

  const dealt: QuizQuestion[] = [];
  for (let round = 0; dealt.length < questions.length; round++) {
    for (const group of groups) {
      const next = group[round];
      if (next) dealt.push(next);
    }
  }
  return dealt;
}

/**
 * Parse a model response into questions, keeping at most `limit` of them.
 *
 * Malformed entries and exact repeats are dropped, so fewer than `limit` can
 * come back — the caller asked for a count, not a guarantee. Throws only when
 * nothing usable came back at all: at that point the caller should treat the
 * attempt as failed and move to the next model.
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
  const seen = new Set<string>();
  let dropped = 0;
  for (let index = 0; index < rawList.length && questions.length < limit; index++) {
    const parsed = parseQuestion(rawList[index], questions.length);
    if (!parsed) {
      dropped += 1;
      continue;
    }
    // A repeat is dropped rather than kept, and the loop reads on — so a
    // question the model wrote twice costs the quiz nothing as long as it wrote
    // extras to spare.
    const key = factKey(parsed);
    if (seen.has(key)) {
      dropped += 1;
      continue;
    }
    seen.add(key);
    questions.push(parsed);
  }

  if (questions.length === 0) {
    throw new Error("Every generated question was malformed.");
  }

  // The order the model chose is the one thing about it worth overruling: it
  // writes by type, so a grouped run is what reaches the learner otherwise.
  return { questions: interleaveByType(questions), dropped };
}
