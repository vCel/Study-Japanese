/**
 * Quiz shapes shared by the builder, the generation API and the runner.
 *
 * Kept separate from `quiz-prefs` (which owns localStorage) and from
 * `db.server` (which owns D1) so the runner component can import the question
 * types without pulling either of those into the client bundle.
 */

/** The question formats the generator can be asked for. */
export type QuizQuestionType =
  /** Pick the right answer from a list of options. */
  | "multiple-choice"
  /** Type the answer out. */
  | "input"
  /** A sentence with missing particles/words, filled from an unordered bank. */
  | "fill-blanks"
  /** Judge whether a generated sentence is grammatical. */
  | "true-false";

export const QUIZ_QUESTION_TYPES: QuizQuestionType[] = [
  "multiple-choice",
  "input",
  "fill-blanks",
  "true-false",
];

export const QUIZ_TYPE_LABELS: Record<QuizQuestionType, string> = {
  "multiple-choice": "Multiple choice",
  input: "Type the answer",
  "fill-blanks": "Fill in the blanks",
  "true-false": "True or false",
};

export const QUIZ_TYPE_HINTS: Record<QuizQuestionType, string> = {
  "multiple-choice": "Pick the correct option from a list of four.",
  input:
    "One bounded answer you type yourself, kana or romaji both counting: fill a gap, rewrite a sentence with the rule, or give the reading of a word written in kanji.",
  "fill-blanks":
    "A sentence with one or two gaps, filled from a shuffled bank of buttons.",
  "true-false": "Decide whether a generated sentence is correct.",
};

/**
 * How hard the generated questions should be. Drives sentence length, how many
 * gaps a fill-in question has, and how close the distractors sit to the answer.
 */
export type QuizDifficulty = "easy" | "normal" | "hard";

export const QUIZ_DIFFICULTIES: QuizDifficulty[] = ["easy", "normal", "hard"];

export const QUIZ_DIFFICULTY_LABELS: Record<QuizDifficulty, string> = {
  easy: "Easy",
  normal: "Normal",
  hard: "Hard",
};

export const QUIZ_DIFFICULTY_HINTS: Record<QuizDifficulty, string> = {
  easy: "Short sentences, common vocabulary, clearly wrong distractors.",
  normal: "Everything a textbook would ask, with plausible distractors.",
  hard: "Longer sentences, two gaps where the rule allows it, and near-miss distractors that differ only by one particle.",
};

/**
 * Which slice of the library a quiz draws its topic from.
 *
 * Unlike the flashcards builder — where a session is one kind of card — a quiz
 * may draw on any combination of these at once, so the builder collects a set
 * rather than a single choice.
 */
export type QuizSourceKind = "words" | "phrases" | "rules";

/** The kinds a quiz can be built from, in the order they are offered. */
export const QUIZ_SOURCE_KINDS: QuizSourceKind[] = ["words", "phrases", "rules"];

export const QUIZ_SOURCE_KIND_LABELS: Record<QuizSourceKind, string> = {
  words: "Words",
  phrases: "Phrases",
  rules: "Rules",
};

export const QUIZ_SOURCE_KIND_HINTS: Record<QuizSourceKind, string> = {
  words: "Vocabulary from your word lists — meanings, readings and usage.",
  phrases: "Whole phrases from your phrase lists.",
  rules: "Grammar rules and forms, tested through their examples.",
};

/**
 * What the AI is asked to test about each word. "all" lets it choose per
 * question, which keeps a mixed quiz from feeling repetitive.
 */
export type WordQuizFocus = "all" | "meaning" | "reading" | "kanji" | "usage";

export const WORD_FOCUS_OPTIONS: { value: WordQuizFocus; label: string; hint: string }[] = [
  {
    value: "all",
    label: "All",
    hint: "Mix word meaning, reading and usage questions freely.",
  },
  { value: "meaning", label: "Meaning", hint: "“What does 食べる mean?”" },
  {
    value: "reading",
    label: "Reading",
    hint: "“How is 食べる read?” — the kana for the kanji.",
  },
  {
    value: "kanji",
    label: "Kanji",
    hint: "“Which word is written with this kanji?” — the reverse direction.",
  },
  {
    value: "usage",
    label: "Usage",
    hint: "Pick the sentence that uses the word correctly.",
  },
];

/**
 * How the generator spreads the questions. Two axes: across the selected
 * question types, and between the individual words and the phrases drawn from
 * the lists. The second only exists when both kinds are in scope — the
 * generator drops whichever axis has nothing to spread over.
 */
export type QuizDistribution =
  /** Give every selected type a roughly equal share, and draw on words and phrases alike. */
  | "even"
  /** Let the AI choose both mixes freely. */
  | "random";

export const QUIZ_DISTRIBUTIONS: QuizDistribution[] = ["even", "random"];

export const QUIZ_DISTRIBUTION_LABELS: Record<QuizDistribution, string> = {
  even: "Even split",
  random: "Mix freely",
};

export const QUIZ_DISTRIBUTION_HINTS: Record<QuizDistribution, string> = {
  even: "Every question type you picked gets roughly the same number of questions, and the quiz draws on individual words and phrases in roughly equal numbers.",
  random: "The AI decides the mix as it goes — some types may dominate, and words or phrases may carry more of the quiz than the other.",
};

/**
 * The question-count ladder the builder's slider steps through.
 *
 * A ladder rather than a free 1–50 range, for the same reason the seconds and
 * difficulty controls are ladders: every stop is a sensible size for one quiz,
 * and the slider can never land between two of them. The count is snapped back
 * onto this list on load (see `normalizeConfig`), so a stale or hand-edited
 * value can't leave the slider without a position.
 */
export const QUIZ_SIZES = [5, 10, 15, 20, 25, 30];

/**
 * How a run presents itself, and the only thing the two modes disagree about is
 * what they *reveal*.
 *
 * A union rather than an `examMode` flag because it is one setting with two
 * settings' worth of behaviour hanging off it — the control is a mode select,
 * and a third mode would otherwise mean a second boolean and a rule about which
 * combination wins.
 */
export type QuizMode = "quiz" | "exam";

/** The modes, in the order the builder offers them. */
export const QUIZ_MODES: QuizMode[] = ["quiz", "exam"];

export const QUIZ_MODE_LABELS: Record<QuizMode, string> = {
  quiz: "Quiz",
  exam: "Exam",
};

/** Time limits per question, in seconds. 0 = the toggle is off. */
export const QUIZ_TIME_LIMITS = [15, 30, 45, 60, 75, 90];

/**
 * The exam ladder, in minutes.
 *
 * One budget for the whole run rather than a limit per question, which is why
 * the steps are two orders of magnitude coarser than `QUIZ_TIME_LIMITS`: two
 * minutes at a time, up to half an hour. Below two minutes nothing but a
 * two-question quiz is answerable; past thirty it stops being an exam.
 */
export const QUIZ_EXAM_MINUTES = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30];

/** Everything the builder collects, and everything the API needs to generate. */
export interface QuizConfig {
  /**
   * Which kinds the quiz draws from, in the order the builder offers them.
   * Always non-empty: the builder refuses to untick the last one.
   */
  sources: QuizSourceKind[];
  /** Which of the source's facets to test — words/phrases only. */
  focus: WordQuizFocus;
  /** Source scope, mirroring `StudyConfig`. */
  lists: number[];
  /**
   * Tag names to *include*: an item must carry at least one of them to be in
   * scope. Empty means no include filter — which is why the default is `[]`
   * rather than "every tag".
   */
  tags: string[];
  /**
   * Tag names to *exclude*: an item carrying any of them is out of scope, even
   * if it matched an include tag.
   *
   * A second array rather than one `{name, mode}[]`, because the wire formats
   * this has to survive — the session URL, a saved session in localStorage —
   * already carry `tags` as a plain list of names. Keeping that meaning intact
   * is what lets every existing saved quiz and bookmark load unchanged.
   */
  excludedTags: string[];
  /** Part of speech filter — words only ("" = all types). */
  pos: string;
  /** Rule kind filter — rules only ("" = every rule). */
  ruleKind: string;
  /**
   * Explicit rule ids to draw from. `null` means every rule of the selected
   * kind — the default, and the only representation that stays correct when a
   * rule is added later. An empty list means none, which is what "clear all"
   * in the builder produces.
   *
   * Rule ids and word ids are separate sequences, so rules get their own list
   * rather than sharing `lists` (which is word/phrase lists only).
   */
  ruleIds: number[] | null;

  questionCount: number;
  /** When false, questions are untimed and `timeLimitSeconds` is ignored. */
  timeLimitEnabled: boolean;
  timeLimitSeconds: number;

  /**
   * What the run reveals, and how it is timed.
   *
   * `exam` withholds every verdict until the run is over, and gets one budget
   * for the whole of it (`examTimeLimitMinutes`) instead of a limit per
   * question — answering a question neither pauses nor restarts that clock.
   */
  mode: QuizMode;
  /**
   * The whole run's budget in exam mode, in minutes — an entry of
   * `QUIZ_EXAM_MINUTES`. Ignored while the mode is `quiz`, so switching away and
   * back comes round to the same budget.
   */
  examTimeLimitMinutes: number;

  /**
   * Draw the quiz from the items in the answer log with at least one wrong
   * answer, worst accuracy first. Implies `starredOnly`-style id scoping: the
   * ids are sent to the server and intersected with the rest of the selection.
   */
  retryMissed: boolean;

  /**
   * Scope the quiz to starred items only.
   *
   * **Off by default, and always sent explicitly.** The server used to infer
   * "starred only" from *the user having any stars at all*, so starring a single
   * word silently narrowed every quiz to the starred set with no way to opt out
   * — the "No starred words available" dead end.
   */
  starredOnly: boolean;

  types: QuizQuestionType[];
  distribution: QuizDistribution;
  difficulty: QuizDifficulty;
}

export const DEFAULT_QUIZ_CONFIG: QuizConfig = {
  sources: ["rules"],
  focus: "all",
  lists: [],
  tags: [],
  excludedTags: [],
  pos: "",
  ruleKind: "",
  ruleIds: null,
  questionCount: 10,
  timeLimitEnabled: true,
  timeLimitSeconds: 30,
  mode: "quiz",
  examTimeLimitMinutes: 20,
  retryMissed: false,
  starredOnly: false,
  types: ["multiple-choice", "fill-blanks"],
  distribution: "even",
  difficulty: "normal",
};

// ---------------------------------------------------------------------------
// Generated questions
// ---------------------------------------------------------------------------

/**
 * Which of the three shapes a typing question takes.
 *
 * `input` used to be open-ended: the model was free to ask the learner to
 * compose a sentence of their own, which cannot be graded fairly — any
 * defensible sentence is marked wrong — and cannot be typed at all by someone
 * who does not write kanji. The prompt asks for these three shapes and no
 * others, and each is bounded by material the learner has already been given:
 *
 * - `blank` — a sentence with a gap; the answer is the missing piece alone.
 * - `transform` — a sentence to rewrite with the rule under test.
 * - `reading` — a word written in kanji; the answer is its reading in kana.
 *
 * **Derived from the question's own fields by `quiz-parse.ts`, never taken from
 * the model.** A question carrying a gapped sentence *is* a fill-the-gap
 * question whatever it calls itself, and a mislabelled one must not cost the
 * learner a question.
 */
export type QuizInputForm = "blank" | "transform" | "reading";

/**
 * One generated question. Every field the runner needs is present for every
 * type, so the component branches on `type` only for the input control.
 */
export interface QuizQuestion {
  /** Local id, assigned after generation so React keys stay stable. */
  id: string;
  type: QuizQuestionType;
  /** The question text, e.g. "What does 食べる mean?". */
  prompt: string;
  /**
   * The sentence under test, in reading order: the gapped sentence of a
   * `fill-blanks` question or a `blank` typing question, or the sentence to
   * rewrite in a `transform` one. Absent elsewhere.
   */
  sentence?: string;
  /** `fill-blanks` only: how many gaps `sentence` carries. */
  blanks?: number;
  /**
   * Typing questions only, and only when the shape is one of the three above
   * (see `QuizInputForm`). Absent on a typing question means a plain
   * prompt-and-type question — an English gloss, say — which carries no
   * sentence to fill and no reading to hide.
   */
  form?: QuizInputForm;
  /**
   * The unordered pool the user picks from — the multiple-choice options, or
   * the fill-in bank. Shuffled by the server so the first entry is never
   * reliably the answer.
   */
  options?: string[];
  /** The correct answer, as displayed. */
  answer: string;
  /** Additional strings accepted for `input` questions. */
  acceptableAnswers?: string[];
  /** Why the answer is what it is, shown after the user answers. */
  explanation?: string;
  /** Which library item this came from, for the "open the page" link. */
  sourceId?: number;
  /**
   * What `sourceId` points at. Rule ids and word ids are separate sequences,
   * so a mixed quiz cannot tell them apart from the number alone — this is what
   * makes the source link (and the answer log's `kind`) correct there.
   * Single-source quizzes may omit it; the runner then infers it from `source`.
   */
  sourceKind?: "word" | "rule";
}

/**
 * Every provider the fallback chain can route to.
 *
 * Lives here rather than in `ai.server.ts` so the client-side
 * `GenerationAttempt` below can share the one definition. A duplicated union
 * drifts silently and did: it rejected `comet` and `groq` the moment they were
 * added to the chain.
 *
 * The direction matters — `ai.server.ts` imports this, not the other way round,
 * because that module reaches for `cloudflare:workers` and must never be pulled
 * into the client bundle.
 */
export type Provider =
  | "meta"
  | "opencode"
  | "gemini"
  | "glm"
  | "aihubmix"
  | "openrouter"
  | "comet"
  | "groq"
  | "nvidia";

/** One step of the model-fallback walk, reported back so the UI can narrate it. */
export interface GenerationAttempt {
  model: string;
  provider: Provider;
  outcome: "ok" | "timeout" | "ratelimit" | "overloaded" | "error";
  /** Human-readable detail, surfaced in the loading panel. */
  detail?: string;
  ms: number;
}

/** What `/api/quiz/generate` returns on success. */
export interface GenerationResult {
  questions: QuizQuestion[];
  /** The model that actually produced them. */
  model: string;
  attempts: GenerationAttempt[];
}
