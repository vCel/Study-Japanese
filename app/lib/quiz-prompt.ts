/**
 * Builds the generation prompt from the library items a quiz is drawn from.
 *
 * Kept pure (no D1, no env) so it can be reasoned about — and unit-tested — on
 * its own. The caller passes in already-hydrated `RuleDetail` / `WordDetail`
 * rows fetched with the owner scope applied.
 */

import type { RuleDetail, WordDetail } from "./db.server";
import type { ChatMessage } from "./ai.server";
import type { QuizConfig, QuizQuestionType } from "./quiz-types";
import {
  QUIZ_DIFFICULTY_HINTS,
  QUIZ_TYPE_HINTS,
  QUIZ_TYPE_LABELS,
  WORD_FOCUS_OPTIONS,
} from "./quiz-types";

/** How many items to describe in the prompt before it gets unwieldy. */
const MAX_RULES = 12;
const MAX_WORDS = 30;

export interface QuizSourceItems {
  rules: RuleDetail[];
  words: WordDetail[];
}

/** One line per library item — compact enough to fit many in a prompt. */
function describeRule(rule: RuleDetail): string {
  const lines: string[] = [];
  lines.push(`### Rule #${rule.id}: ${rule.title}`);
  lines.push(`kind: ${rule.kind}`);
  if (rule.points.length > 0) lines.push(`pattern: ${rule.points.join(" | ")}`);
  lines.push(`explanation: ${rule.explanation}`);
  if (rule.tags.length > 0) lines.push(`tags: ${rule.tags.map((tag) => `#${tag}`).join(" ")}`);
  if (rule.notes) lines.push(`notes: ${rule.notes}`);

  if (rule.examples.length > 0) {
    lines.push("examples:");
    for (const example of rule.examples.slice(0, 6)) {
      // `english` is what the sentence means; `englishEquivalent` is how the
      // grammar itself is said in English. Both help the model keep the rule's
      // nuance instead of inventing a meaning.
      const equivalent = example.englishEquivalent ? ` [equivalent: ${example.englishEquivalent}]` : "";
      lines.push(`  - ${example.japanese} — ${example.english}${equivalent}`);
    }
  }
  return lines.join("\n");
}

function describeWord(word: WordDetail): string {
  const lines: string[] = [];
  const head = [`### Word #${word.id}: ${word.word}`];
  if (word.kana && word.kana !== word.word) head.push(`(${word.kana})`);
  lines.push(head.join(" "));
  if (word.pos) lines.push(`type: ${word.pos}${word.subtype ? ` / ${word.subtype}` : ""}`);
  if (word.meanings.length > 0) lines.push(`meanings: ${word.meanings.join("; ")}`);
  if (word.forms.length > 0) {
    lines.push(`forms: ${word.forms.map((form) => `${form.name}=${form.value}`).join(", ")}`);
  }
  if (word.notes) lines.push(`notes: ${word.notes}`);
  if (word.examples.length > 0) {
    lines.push("examples:");
    for (const example of word.examples.slice(0, 4)) {
      lines.push(`  - ${example.japanese}${example.translation ? ` — ${example.translation}` : ""}`);
    }
  }
  return lines.join("\n");
}

/** The rules that look like particle/grammar rules, worth calling out. */
function looksLikeParticle(rule: RuleDetail): boolean {
  const haystack = [
    rule.title,
    ...rule.points,
    ...rule.tags,
  ]
    .join(" ")
    .toLowerCase();
  return /particle|助詞|は|が|を|に|で|と|も|へ|から|まで/.test(haystack);
}

/** Which of the selected types present the user with a set of options to pick from. */
function usesOptions(type: QuizQuestionType): boolean {
  return type === "multiple-choice" || type === "fill-blanks";
}

/** One requirement paragraph per selected question type. */
function typeInstruction(type: QuizQuestionType, particleRules: boolean): string {
  switch (type) {
    case "multiple-choice":
      return `- "multiple-choice": ${QUIZ_TYPE_HINTS["multiple-choice"]} Provide exactly 4 options in "options", only one of which is correct. Put the correct option in "answer". Every distractor must be clearly WRONG here — not merely unlikely, and never a near-synonym of the answer.`;
    case "input":
      return `- "input": ${QUIZ_TYPE_HINTS.input} Put the canonical answer in "answer" and any alternative accepted spellings (kana and romaji, where reasonable) in "acceptableAnswers".`;
    case "fill-blanks":
      return [
        `- "fill-blanks": ${QUIZ_TYPE_HINTS["fill-blanks"]}`,
        `  Write a natural Japanese sentence in "sentence" and replace each missing word with "___" (three underscores).`,
        `  Set "blanks" to the number of gaps.`,
        `  Put the correct fillers in "answer", joined by ", " in gap order.`,
        particleRules
          ? `  For a question about one of the particle rules below, the gaps MUST be the particles themselves — e.g. 「私___学生です」 with the answer 「は」 — and "options" must add plausible distractor particles (が, を, に, で, と, も) so the bank is not trivially solvable. For any other item, "options" must contain the correct fillers plus plausible distractors of the same word class, in a shuffled order.`
          : `  "options" must contain the correct fillers plus plausible distractors of the same word class, in a shuffled order.`,
        `  Every distractor must be wrong in the sentence you wrote — test each one against it before returning.`,
      ].join("\n");
    case "true-false":
      return `- "true-false": ${QUIZ_TYPE_HINTS["true-false"]} Write a Japanese sentence in "sentence" (you may show it in "prompt" instead) that is either correct or contains exactly one deliberate error, and set "answer" to "true" if the sentence is correct or "false" if it is not.`;
  }
}

/**
 * The single most common way a generated question is broken: two options that
 * are both grammatical and both plausible, so the user is marked wrong for an
 * answer that was also correct.
 *
 * Naming the trap explicitly — with the contrastive pairs that cause it, and a
 * worked counter-example — is what stops the model producing them; a generic
 * "make the distractors wrong" does not.
 */
const DISTRACTOR_QUALITY = [
  "## Distractor quality — the most common way these questions break",
  "A question with two defensible answers is a broken question: the user can be marked wrong for an answer that was also correct. Before you return your JSON, go back over every question that has \"options\" and substitute each option into the sentence or context.",
  "",
  "- If a distractor makes a sentence that is grammatical AND whose meaning is plausible, it is invalid. Either change the sentence so the surrounding context settles which one fits, or replace the distractor.",
  "- Contrastive and paired forms are the usual trap: にくい / やすい, ない / ある, まで / までに, は / が, に / で, へ / から, 〜た / 〜なかった, 大きい / 小さい, 上手 / 下手, 行く / 来る, 〜ている / 〜てある.",
  "  「このペンは使い___です」 is NOT a valid question — both にくい and やすい fit. Fix it by letting the context choose one (「このペンは軽くて持ちやすく、とても使い___です」 → やすい) or by using a different pair.",
  "- A distractor must be wrong, not merely unlikely. \"Probably not what they meant\" is not wrong enough.",
  "- Never use a synonym, a paraphrase, or another conjugation of the answer as a distractor.",
  "- With several gaps, every option must be wrong in every gap it could plausibly fill — except where it is the answer.",
].join("\n");

function distributionInstruction(config: QuizConfig): string {
  if (config.types.length <= 1) return "";
  if (config.distribution === "even") {
    const per = Math.max(1, Math.round(config.questionCount / config.types.length));
    return `Spread the questions as evenly as you reasonably can across the ${config.types.length} selected types — about ${per} of each. It does not have to be exact.`;
  }
  return `Choose the mix of question types yourself, freely — some types may end up more common than others.`;
}

const RESPONSE_SCHEMA = `{
  "questions": [
    {
      "type": "multiple-choice" | "input" | "fill-blanks" | "true-false",
      "prompt": "the question text shown to the user",
      "sentence": "optional — the Japanese sentence, required for fill-blanks",
      "blanks": 0,
      "options": ["optional", "unordered", "pool"],
      "answer": "the correct answer",
      "acceptableAnswers": ["optional", "alternatives"],
      "explanation": "one or two sentences on why, naming the rule",
      "sourceId": 12,
      "sourceKind": "rule" | "word"
    }
  ]
}`;

export interface BuiltPrompt {
  messages: ChatMessage[];
  /** Human-readable summary of the topic, for the loading panel. */
  topicSummary: string;
}

/** "12 rules and 20 words" — for the loading panel. */
function describeCounts(rules: number, words: number, phrases: number): string {
  const parts: string[] = [];
  if (rules > 0) parts.push(`${rules} rule${rules === 1 ? "" : "s"}`);
  if (words > 0) parts.push(`${words} word${words === 1 ? "" : "s"}`);
  if (phrases > 0) parts.push(`${phrases} phrase${phrases === 1 ? "" : "s"}`);
  if (parts.length <= 1) return parts[0] ?? "no material";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * Turn the configured quiz plus its source items into a chat request.
 *
 * Only the items in `items` are ever referenced, and every question must cite
 * both the `sourceId` it came from and whether that id is a rule or a word —
 * the two id sequences are independent, so a quiz spanning both kinds needs
 * `sourceKind` to link (and log) each answer correctly.
 */
export function buildQuizPrompt(config: QuizConfig, items: QuizSourceItems): BuiltPrompt {
  const { rules, words } = items;
  const wantsRules = config.sources.includes("rules");
  const wantsWords = config.sources.includes("words");
  const wantsPhrases = config.sources.includes("phrases");
  const wantsLists = wantsWords || wantsPhrases;
  const spansKinds = config.sources.length > 1;

  // The particle hint only makes sense where there are rules to attach it to.
  const particleRules = wantsRules && rules.some(looksLikeParticle);
  // Only worth saying when a question will actually offer a set of options.
  const offersOptions = config.types.some(usesOptions);

  const focusOption = WORD_FOCUS_OPTIONS.find((option) => option.value === config.focus);
  const focusInstruction = !wantsLists
    ? ""
    : config.focus !== "all" && focusOption
      ? `Focus every vocabulary question on this aspect: ${focusOption.label} — ${focusOption.hint}`
      : "Mix the vocabulary question angles freely: word meaning, reading of the kanji, the kanji for a given reading, and correct usage in a sentence.";

  const system = [
    "You are a Japanese-language teacher writing a quiz.",
    "You are given a fixed set of library items. Write questions about THOSE items only — never invent rules, words or readings that are not supported by the material.",
    "All Japanese must be natural, correctly spelled and grammatical (except where a true/false question deliberately contains one error).",
    "Every question that offers a set of options must have exactly ONE defensible answer — no distractor may also be grammatical and plausible in the given context.",
    "Reply with raw JSON only. No markdown, no code fences, no commentary before or after.",
  ].join(" ");

  const sections: string[] = [];
  if (wantsRules && rules.length > 0) {
    sections.push(
      [
        "### Grammar rules",
        rules
          .slice(0, MAX_RULES)
          .map(describeRule)
          .join("\n\n"),
      ].join("\n\n")
    );
  }
  if (wantsLists && words.length > 0) {
    sections.push(
      [
        "### Vocabulary",
        words
          .slice(0, MAX_WORDS)
          .map(describeWord)
          .join("\n\n"),
      ].join("\n\n")
    );
  }

  // Keep the two kinds in proportion to what was actually loaded, so a quiz
  // spanning both does not collapse into an all-vocabulary one.
  const spreadInstruction = spansKinds
    ? `This quiz draws on ${describeCounts(
        wantsRules ? rules.length : 0,
        wantsWords ? words.length : 0,
        wantsPhrases ? words.length : 0
      )}. Spread the questions across BOTH the grammar rules and the vocabulary — do not fill the quiz from one section alone.`
    : "";

  const user = [
    `Write ${config.questionCount} quiz questions about the following material.`,
    "",
    "## Difficulty",
    `${config.difficulty} — ${QUIZ_DIFFICULTY_HINTS[config.difficulty]}`,
    "",
    "## Question types to use",
    config.types.map((type) => typeInstruction(type, particleRules)).join("\n"),
    distributionInstruction(config),
    spreadInstruction,
    focusInstruction,
    offersOptions ? DISTRACTOR_QUALITY : "",
    "",
    "## Rules",
    `- Produce exactly ${config.questionCount} questions.`,
    '- Every question MUST set "sourceId" to the id of the library item it came from (the #number above).',
    wantsRules
      ? '- Every question MUST set "sourceKind" to "rule" when it came from a rule, or "word" when it came from a vocabulary item.'
      : '- Every question MUST set "sourceKind" to "word".',
    '- Every question MUST include a short "explanation" that names the rule or word involved.',
    '- For any question with "options", the options MUST be listed in an arbitrary, shuffled order — the correct answer must NOT reliably come first.',
    '- Never reveal the answer inside the "prompt" text.',
    offersOptions
      ? "- Before returning, re-read every question with options and confirm that exactly one option is defensible. Rewrite any question where a second option also fits."
      : "",
    wantsRules
      ? "- Stay faithful to the given rules' explanations and examples; reuse their vocabulary where it fits."
      : "",
    wantsLists
      ? "- Stay faithful to the given words' readings and meanings; do not introduce unseen vocabulary beyond common particles and copulas."
      : "",
    "",
    "## Material",
    sections.join("\n\n"),
    "",
    "## Response format",
    "Return a single JSON object with exactly this shape:",
    RESPONSE_SCHEMA,
  ]
    .filter((part) => part !== "")
    .join("\n");

  return {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    topicSummary: describeCounts(
      wantsRules ? rules.length : 0,
      wantsWords ? words.length : 0,
      wantsPhrases ? words.length : 0
    ),
  };
}

/**
 * Pull the JSON object out of a model response. Models occasionally wrap the
 * payload in code fences or add a sentence in front despite being asked not
 * to, so take the outermost balanced object rather than trusting `JSON.parse`.
 */
export function extractJson(text: string): unknown {
  const cleaned = text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Fall back to the outermost {...} span.
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("The model did not return JSON.");
    }
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}
