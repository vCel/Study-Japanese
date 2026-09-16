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
      return `- "input": ${QUIZ_TYPE_HINTS.input} Put the canonical answer in "answer" and every accepted spelling in "acceptableAnswers" — "What the answer must look like" below says exactly what that field has to contain.`;
    case "fill-blanks":
      return [
        `- "fill-blanks": ${QUIZ_TYPE_HINTS["fill-blanks"]}`,
        `  Write a natural Japanese sentence in "sentence" and replace each missing word with "___" (three underscores).`,
        `  Set "blanks" to the number of gaps.`,
        `  Put the correct fillers in "answer", joined by ", " in gap order.`,
        particleRules
          ? `  For a question about one of the particle rules below, the gaps MUST be the particles themselves — e.g. 「私___学生です」 with the answer 「は」 — and "options" must add plausible distractor particles (が, を, に, で, と, も) so the bank is not trivially solvable. For any other item, "options" must contain the correct fillers plus at least three plausible distractors of the same word class, in a shuffled order.`
          : `  "options" must contain the correct fillers plus at least three plausible distractors of the same word class, in a shuffled order.`,
        `  Every distractor must be wrong in the sentence you wrote — test each one against it before returning. A bank of two options is a coin flip, so there must be at least three distractors.`,
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
  "",
  "### The opposite failure: a giveaway",
  "A question also breaks by being too *easy*. If the item under test appears verbatim in the question, the only option that repeats it is obviously the answer, and the learner scores without knowing any Japanese — which is worse than a hard question, because it teaches nothing and looks careless.",
  "- The answer must never be the only option that shares a word, a character, or a reading with the question or the sentence.",
  "- **The prompt must not contain the answer.** Before you return, search your own \"prompt\" string for the answer text: if the answer appears in it, in any language, the question is broken. Rewrite it so the answer appears only in \"options\".",
  "- **A meaning question must make the learner go through the Japanese.** If the options are English meanings, the prompt shows the Japanese word and does NOT state the meaning: What does 定食《ていしょく》 mean? with options \"set meal\" / \"meal ticket\" / \"documents\". If the prompt states the English meaning, the options must be Japanese words: Which of these means \"set meal\"? with options 定食 / 食券 / 資料. Never state the English meaning in the prompt *and* offer English meanings as options — Which of these means set meal? with the option \"set meal\" answers itself, and the learner can pick it without reading a word of Japanese.",
  "- **Never quote a sentence that already contains the item under test.** If a question quotes Japanese, the tested word or ending must be absent from that quotation — leave it as ___ instead. 社食で昼ごはんを食べます。 where 社食 means company cafeteria gives the answer away twice over; so does quoting お客様はもう朝食を召し上がりましたか。 and then asking which honorific verb to use, because 召し上がる is the only option that appears in the quotation. Ask instead about ___で昼ごはんを食べます。, or quote a sentence that does not contain the verb at all.",
  "- Where the question quotes Japanese, every option must be a plausible continuation or replacement of that quotation, so simply recognising the quoted text does not pick one out.",
  "  Asking 「学生《がくせい》」 を使った文を選びなさい where only one option contains 学生 is a giveaway. Make every option usable in the sentence and let the grammar decide which is right.",
  "- Keep the options the same kind of thing — same word class, same conjugation, similar length — so the answer cannot be identified by its shape alone.",
].join("\n");

/**
 * Ruby text for the kanji.
 *
 * The quiz is aimed at a learner who cannot read kanji, so every kanji they
 * meet carries its reading. The notation is the traditional Japanese ruby form,
 * `漢字《かんじ》`, rather than parentheses or brackets: `《》` does not occur in
 * ordinary prose, so the pattern can be parsed without guessing which
 * punctuation the sentence legitimately contained. `furigana.ts` turns it into a
 * `<ruby>` element, and a toggle hides the readings again.
 *
 * The wording matters. An earlier draft listed "prompt" among the *Japanese*
 * fields, which reads as permission to write the prompt in Japanese — the
 * exact opposite of what the system prompt asks for. The fields are not
 * Japanese or English; the rule is about any Japanese that appears in them.
 *
 * The exception matters as much as the rule. Annotating the item under test
 * hands over the answer — a question asking how to read 学生 is ruined by
 * 学生《がくせい》 — so the annotated and the tested form have to be kept apart.
 */
const FURIGANA_RULE = [
  '## Ruby text for kanji',
  'The reader cannot read kanji, so every kanji they will meet carries its reading, written in 《》 — the traditional Japanese ruby notation.',
  '',
  '- Annotate every kanji you write, wherever it appears: 学生です → 学生《がくせい》です, 今日は寒い → 今日《きょう》は寒《さむ》い.',
  '- That includes Japanese quoted inside an English "prompt" or "explanation": Which of these means 学生《がくせい》?',
  '- Kana is left bare: です, ます, は, を take no annotation.',
  '- Annotate whole words, not single characters: 大学《だいがく》, never 大《だい》学《がく》.',
  '- Use the reading that fits the sentence — the same kanji can be read several ways.',
  '- EXCEPTION, and it overrides everything above: never annotate the item the question is testing. If the question asks how to read a word, that word stays bare — the annotation would be the answer.',
].join('\n');

/**
 * What the answer field has to contain, derived from the grader rather than
 * from taste.
 *
 * `answersMatch` in `quiz-runner.tsx` compares the learner's typing to `answer`
 * and `acceptableAnswers` after exactly four allowances — furigana annotations,
 * `**bold**`, whitespace, and the punctuation `。．.、,，!！?？`. Everything
 * else is an exact match. So `to eat` does not accept `eat`, a different
 * conjugation does not accept the plain form, and romaji does not accept kana.
 *
 * That last one is why this block exists at all: the input box *tells* the
 * learner "kana or romaji both count", and `acceptableAnswers` is the only
 * thing that makes the promise true. Nothing in the app converts romaji.
 */
const ANSWER_FORM = [
  "## What the answer must look like",
  'The learner\'s typing is compared to "answer" and "acceptableAnswers" after only four allowances: furigana annotations, **bold** markers, spaces, and the punctuation 。．.、,，!！?？. Nothing else is forgiven, so:',
  "",
  '- Write "answer" as the exact string a learner would type. Never a gloss, never a parenthetical, and never two variants joined by "/" or "or" — `to eat / eat` matches neither.',
  '- For an English answer use the shortest natural form: `eat`, not `to eat`; `company cafeteria`, not `the company cafeteria`. A leading article or "to" is not ignored.',
  '- For a Japanese answer, use the form the library item uses. Annotate its kanji like everything else — the annotation is stripped before comparing.',
  '- **An "input" answer containing kanji MUST list both its kana reading and that reading in romaji in "acceptableAnswers".** 図書館《としょかん》 → ["としょかん", "toshokan"]. The input box promises the learner that "kana or romaji both count", and this field is the only thing that makes that true. Nothing else in the app converts romaji.',
  '- Also list the other forms a learner might reasonably type — a plain or polite variant of the same verb, a second reading in common use — but never a string that would be equally right for a different question.',
].join("\n");

/**
 * Three examples of the whole thing done properly.
 *
 * `RESPONSE_SCHEMA` says what the fields are; it cannot show the *shape* of a
 * good question — a prompt that does not contain its answer, options where
 * every wrong one is wrong in this sentence, an explanation that says why. Prose
 * rules only reach so far, and a worked example is what a model actually
 * copies: measured 2026-09-16, all three runs of the first version asked the
 * fill-blanks sentence verbatim, which is why the preamble now forbids reusing
 * them and why that example was moved off the material's own vocabulary.
 *
 * The items are invented, and the preamble says so: examples drawn from the
 * real material is how a quiz ends up asking about 図書館 in a quiz that never
 * mentioned it.
 */
const WORKED_EXAMPLES = [
  "## Three worked examples",
  'These items are from an unrelated library. Copy the *shape* and never the content — the ids are placeholders, and none of this may appear in your answer.',
  'They illustrate field shapes, not a menu: write only the question types listed under "Question types to use" above.',
  "**Write your own sentences.** These are illustrations, not a bank: never reuse one of their sentences, and never ask the same sentence twice.",
  "",
  "```json",
  `{
  "questions": [
    {
      "type": "multiple-choice",
      "prompt": "What does 図書館《としょかん》 mean?",
      "options": ["library", "hospital", "post office", "station"],
      "answer": "library",
      "explanation": "図書館《としょかん》 is where you borrow books. 病院《びょういん》 is a hospital and 郵便局《ゆうびんきょく》 a post office, so neither names this place.",
      "sourceId": 4,
      "sourceKind": "word"
    },
    {
      "type": "input",
      "prompt": "Type the Japanese for \\"departure\\".",
      "answer": "出発《しゅっぱつ》",
      "acceptableAnswers": ["しゅっぱつ", "shuppatsu"],
      "explanation": "出発《しゅっぱつ》 is the moment you leave to begin a journey — the noun, rather than the verb 出発《しゅっぱつ》する.",
      "sourceId": 9,
      "sourceKind": "word"
    },
    {
      "type": "fill-blanks",
      "prompt": "Which ending fits the sentence?",
      "sentence": "この道《みち》は狭《せま》くて通《とお》り___です。",
      "blanks": 1,
      "options": ["にくい", "やすい", "たい", "ながら"],
      "answer": "にくい",
      "explanation": "狭《せま》くて says the road is narrow, so it is hard to pass: 通りにくい. 通りやすい is grammatical but contradicts that — やすい means easy to do.",
      "sourceId": 1,
      "sourceKind": "rule"
    }
  ]
}`,
  "```",
  "What to copy from them:",
  "",
  "- The first prompt names the Japanese and asks for the meaning. It never states the meaning *and* offers meanings — that question answers itself, and the learner can score without reading a word of Japanese.",
  '- Every wrong option is wrong *in this question*, not merely less likely. "hospital" and "post office" are real places; they are simply not what 図書館《としょかん》 means.',
  "- The third one is the harder lesson: 通りやすい is perfectly grammatical, and the sentence is what rules it out. Letting 狭《せま》くて decide is the whole question.",
  '- The explanations say why the answer fits and, where it matters, why the alternative does not. None of them restates the question or gives a bare dictionary gloss.',
  '- The input question carries kana *and* romaji in "acceptableAnswers", so a learner who types either is marked right.',
].join("\n");

/**
 * How to spread the questions, for each axis that has something to spread over:
 * the selected question types, and the two kinds of list material.
 *
 * One setting covers both axes, so "even" is said twice — once per axis — and an
 * axis with a single bucket is dropped rather than told to spread across itself.
 * The kinds axis names `type: phrase`, because that line in the material is the
 * only thing distinguishing a phrase from an individual word.
 */
function distributionInstruction(config: QuizConfig): string {
  const typeCount = config.types.length;
  const splitsKinds = config.sources.includes("words") && config.sources.includes("phrases");
  if (typeCount <= 1 && !splitsKinds) return "";

  const lines: string[] = [];

  if (typeCount > 1) {
    lines.push(
      config.distribution === "even"
        ? `Spread the questions as evenly as you reasonably can across the ${typeCount} selected question types — about ${Math.max(
            1,
            Math.round(config.questionCount / typeCount)
          )} of each. It does not have to be exact.`
        : "Choose the mix of question types yourself, freely — some types may end up more common than others."
    );
  }

  if (splitsKinds) {
    lines.push(
      config.distribution === "even"
        ? 'Spread the questions evenly between the individual words and the phrases — the items marked "type: phrase" are the phrases. Neither kind should carry the whole quiz. It does not have to be exact.'
        : 'Choose freely how much of the quiz draws on individual words and how much on phrases — the items marked "type: phrase" are the phrases. One kind may end up more common than the other.'
    );
  }

  return lines.join(" ");
}

const RESPONSE_SCHEMA = `{
  "questions": [
    {
      "type": "multiple-choice" | "input" | "fill-blanks" | "true-false",
      "prompt": "the question text shown to the user — English, with any Japanese inside it annotated",
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
    "You are a Japanese-language teacher writing a quiz for an English-speaking learner who cannot yet read kanji.",
    'Write the question itself in English: "prompt" and "explanation" are English sentences, and Japanese appears only as the material under test, quoted inside them. The learner must be able to tell what is being asked without reading a word of Japanese.',
    "You are given a fixed set of library items. Write questions about THOSE items only — never invent rules, words or readings that are not supported by the material.",
    "All Japanese must be natural, correctly spelled and grammatical (except where a true/false question deliberately contains one error).",
    // Kana errors are the ones a learner cannot catch: they have no reference
    // to compare against, so a wrong particle is simply learned wrong. Called
    // out specifically because the free tiers produced `んが` for `のが`.
    "Kana must be exact, character for character. Never substitute a similar kana and never approximate a particle: の is の and never ん, は is は and never わ, を is を and never お. If you are unsure of a spelling or a reading, use the one from the given material rather than reconstructing it.",
    "Every question that offers a set of options must have exactly ONE defensible answer — no distractor may also be grammatical and plausible in the given context.",
    "Reply with raw JSON only. No markdown, no code fences, no commentary before or after.",
    // The line above is read as being about the *envelope*, so the free tiers
    // happily put `**bold**` inside an explanation. The distinction has to be
    // spelled out: plain prose is a property of the strings, not of the reply.
    'Every string inside the JSON is plain prose. Do not use Markdown anywhere in a value — no **bold**, no *italics*, no `backticks`, no headings, no bullet characters. There is no way to emphasise text in this format, so write the sentence so it does not need it.',
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
    ANSWER_FORM,
    offersOptions ? DISTRACTOR_QUALITY : "",
    FURIGANA_RULE,
    WORKED_EXAMPLES,
    "",
    "## Rules",
    `- Produce exactly ${config.questionCount} questions.`,
    '- Write "prompt" and "explanation" in English. Japanese belongs only *inside* them, as the material under test — never as the instruction itself.',
    '- Every question MUST set "sourceId" to the id of the library item it came from (the #number above).',
    wantsRules
      ? '- Every question MUST set "sourceKind" to "rule" when it came from a rule, or "word" when it came from a vocabulary item.'
      : '- Every question MUST set "sourceKind" to "word".',
    '- Every question MUST include a short "explanation": name the rule or word involved, say why the answer is right *in this sentence*, and — where a tempting option was wrong — say why. Do not restate the question, and do not give a bare dictionary gloss.',
    '- Do not test the same fact twice. A word\'s meaning and its reading are different facts and both may be asked; the same meaning asked twice is a wasted question.',
    '- For any question with "options", the options MUST be listed in an arbitrary, shuffled order — the correct answer must NOT reliably come first.',
    '- Never reveal the answer inside the "prompt" text.',
    offersOptions
      ? "- Before returning, re-read every question with options and check three things: that exactly one option is defensible; that the answer text does not appear anywhere in \"prompt\" or \"sentence\"; and that the answer is not the only option repeating a word or character from the question. Rewrite any question that fails any of the three."
      : "",
    '- No Markdown in any value: no **bold**, no *italics*, no `backticks`, no headings.',
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
