/**
 * Guards `leaksAnswer` in `app/lib/quiz-parse.ts`.
 *
 * That function is a *heuristic*: it decides whether a generated question has
 * given its own answer away, and it does so with four tuned thresholds — a
 * minimum needle length, a word-boundary test for Latin, an inflected-stem
 * fallback for Japanese, and an exemption for `true-false`. Every one of them
 * was chosen to avoid dropping a legitimate question, and every one of them
 * could be loosened by a later edit without any visible symptom: the quiz would
 * simply get shorter, and the questions that disappeared would be the ones
 * nobody saw.
 *
 * So the cases below are split by *why* they matter. The first group is the
 * reported bug — real question shapes that must be dropped. The second is the
 * control group — legitimate questions that must survive, including the three
 * that a naive version of the rule would wrongly drop. A guard that fails the
 * first group is not doing its job; one that fails the second is doing damage.
 *
 * Run with `npm run quiz:guard`.
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(REPO, "node_modules", ".cache", "quiz-guard");

const { build } = createRequire(import.meta.url)("esbuild");

mkdirSync(OUT_DIR, { recursive: true });
const bundle = path.join(OUT_DIR, "quiz-parse.mjs");
await build({
  entryPoints: [path.join(REPO, "app", "lib", "quiz-parse.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: bundle,
  logLevel: "warning",
});

const { parseQuizQuestions } = await import(pathToFileURL(bundle).href);

/**
 * One raw model question per case, with the verdict the parser should reach.
 *
 * `drop` means the answer is visible in the question; `keep` means it is not.
 * The `keep` cases are not padding — they are the shapes the four thresholds
 * exist to protect, and a change that breaks one of them is worse than the bug
 * this guards against.
 */
const cases = [
  // The reported bug: four question shapes from the owner's screenshots.
  {
    verdict: "drop",
    name: "English answer stated in an English prompt",
    q: {
      type: "multiple-choice",
      prompt: "Which of these means set meal?",
      options: ["set meal", "meal ticket", "documents"],
      answer: "set meal",
    },
  },
  {
    verdict: "drop",
    name: "tested word repeated as the answer",
    q: {
      type: "multiple-choice",
      prompt: "Which word in 社食《しゃしょく》で昼《ひる》ごはんを食《た》べます。 means company cafeteria?",
      options: ["社食《しゃしょく》", "昼《ひる》", "ごはん"],
      answer: "社食《しゃしょく》",
    },
  },
  {
    verdict: "drop",
    name: "same word quoted in the sentence field",
    q: {
      type: "fill-blanks",
      prompt: "Complete the sentence.",
      sentence: "社食《しゃしょく》で昼《ひる》ごはんを___。",
      blanks: 1,
      options: ["食《た》べます", "飲《の》みます"],
      answer: "社食《しゃしょく》",
    },
  },
  {
    verdict: "drop",
    name: "conjugated verb quoted in the sentence (stem match)",
    q: {
      type: "multiple-choice",
      prompt: "Which honorific verb is used here?",
      sentence: "お客様《おきゃくさま》はもう朝食《ちょうしょく》を召《め》し上《あ》がりましたか。",
      options: ["召し上がる", "食べる", "飲む", "見る"],
      answer: "召し上がる",
    },
  },
  {
    verdict: "drop",
    name: "the reading the model annotated over the tested word",
    q: {
      type: "input",
      prompt: "How do you read 学生《がくせい》?",
      answer: "がくせい",
    },
  },

  // The control group: legitimate questions, including three near-misses.
  {
    verdict: "keep",
    name: "corrected giveaway — Japanese options, English prompt",
    q: {
      type: "multiple-choice",
      prompt: 'Which of these means "set meal"?',
      options: ["定食《ていしょく》", "食券《しょっけん》", "資料《しりょう》"],
      answer: "定食《ていしょく》",
    },
  },
  {
    verdict: "keep",
    name: "corrected giveaway — English options, Japanese prompt",
    q: {
      type: "multiple-choice",
      prompt: "What does 定食《ていしょく》 mean?",
      options: ["set meal", "meal ticket", "documents"],
      answer: "set meal",
    },
  },
  {
    verdict: "keep",
    name: "fill-blank with the answer absent from the sentence",
    q: {
      type: "fill-blanks",
      prompt: "Complete the sentence.",
      sentence: "私《わたし》は学生《がくせい》___。",
      blanks: 1,
      options: ["です", "ます", "でした"],
      answer: "です",
    },
  },
  {
    verdict: "keep",
    name: "particle question — a one-character answer is never a leak",
    q: {
      type: "fill-blanks",
      prompt: "Which particle belongs in the gap?",
      sentence: "私《わたし》___学生《がくせい》です。",
      blanks: 1,
      options: ["は", "が", "を", "に"],
      answer: "は",
    },
  },
  {
    verdict: "keep",
    name: 'true-false — "true" in the prompt is not a leak',
    q: {
      type: "true-false",
      prompt: "True or false: this sentence is correct.",
      sentence: "私《わたし》は学生《がくせい》です。",
      answer: "true",
    },
  },
  {
    verdict: "keep",
    name: "Latin answer inside a longer Latin word",
    q: {
      type: "multiple-choice",
      prompt: "Which of these is a great way to say you ate?",
      options: ["eat", "sleep", "run"],
      answer: "eat",
    },
  },
  {
    verdict: "keep",
    name: "reading question — the tested word is left bare",
    q: {
      type: "input",
      prompt: "How is 学生 read?",
      answer: "がくせい",
    },
  },
  {
    verdict: "keep",
    name: "input — answer is the Japanese, prompt is the gloss",
    q: {
      type: "input",
      prompt: "Type the Japanese for company cafeteria.",
      answer: "社食《しゃしょく》",
    },
  },
  {
    verdict: "keep",
    name: "conjugation question — the stem must not over-fire",
    q: {
      type: "multiple-choice",
      prompt: "Choose the correct polite form of 飲む.",
      options: ["飲みます", "飲む", "飲んだ", "飲まない"],
      answer: "飲みます",
    },
  },
  {
    verdict: "keep",
    name: "katakana loanword is not trimmed to a stem",
    q: {
      type: "multiple-choice",
      prompt: "What does コーヒー mean?",
      options: ["coffee", "tea", "juice"],
      answer: "coffee",
    },
  },
  {
    verdict: "keep",
    name: "long English answer that only partly overlaps the prompt",
    q: {
      type: "multiple-choice",
      prompt: "What does 有給休暇《ゆうきゅうきゅうか》 mean?",
      options: ["paid holiday", "overtime", "sick leave"],
      answer: "paid holiday",
    },
  },
  {
    verdict: "keep",
    name: "grammar question with a Japanese sentence and no leak",
    q: {
      type: "multiple-choice",
      prompt: "Which ending makes this sentence negative?",
      sentence: "明日《あした》は学校《がっこう》へ___。",
      options: ["行きません", "行きます", "行きました"],
      answer: "行きません",
    },
  },
];

/** Run one raw question through the real parser; a throw counts as dropped. */
function verdictFor(q) {
  try {
    return parseQuizQuestions(JSON.stringify({ questions: [q] }), 1).questions.length === 1
      ? "keep"
      : "drop";
  } catch {
    return "drop";
  }
}

let failures = 0;
console.log(`quiz-guard — ${cases.length} cases against app/lib/quiz-parse.ts\n`);

for (const testCase of cases) {
  const actual = verdictFor(testCase.q);
  const ok = actual === testCase.verdict;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${testCase.verdict.padEnd(4)}  ${testCase.name}`);
  if (!ok) console.log(`          expected ${testCase.verdict}, got ${actual}`);
}

/**
 * The worked examples in the prompt must survive the guard.
 *
 * `quiz-prompt.ts` and `quiz-parse.ts` have to agree about what a good question
 * looks like, and nothing else in the project checks that they do. An example
 * the guard rejects would be a shape the prompt asks for and the parser then
 * throws away — and the models copy the examples more closely than they follow
 * the rules.
 */
console.log("\nworked examples — the prompt's own examples must pass the guard");
let exampleFailures = 0;
{
  const promptBundle = path.join(OUT_DIR, "quiz-prompt.mjs");
  await build({
    entryPoints: [path.join(REPO, "app", "lib", "quiz-prompt.ts")],
    bundle: true,
    format: "esm",
    platform: "neutral",
    outfile: promptBundle,
    logLevel: "warning",
  });
  const { buildQuizPrompt } = await import(pathToFileURL(promptBundle).href);

  const rendered = buildQuizPrompt(
    {
      sources: ["words", "rules"],
      focus: "all",
      questionCount: 3,
      types: ["multiple-choice", "input", "fill-blanks"],
      distribution: "even",
      difficulty: "normal",
    },
    { rules: [], words: [] }
  ).messages[1].content;

  const fenced = rendered.match(/## Worked examples[\s\S]*?```json\n([\s\S]*?)\n```/);
  if (!fenced) {
    console.log("  FAIL  no fenced json block under 'Worked examples' — the section moved or went away.");
    exampleFailures = 1;
  } else {
    for (const question of JSON.parse(fenced[1]).questions) {
      const actual = verdictFor(question);
      const ok = actual === "keep";
      if (!ok) exampleFailures += 1;
      console.log(`  ${ok ? "ok  " : "FAIL"}  ${question.type.padEnd(16)} ${question.prompt}`);
    }
  }
}

/**
 * The self-test, and the reason to trust the loop above.
 *
 * A green run on its own proves nothing, because every `drop` case would also
 * drop for reasons that have nothing to do with the guard — too few options, a
 * blank-less sentence, a multiple-choice whose answer is not among its options.
 * The case list would then read as "the guard works" while never once reaching
 * it, and would keep reading that way after the guard was deleted.
 *
 * So bundle the module a second time with `leaksAnswer` neutered and assert
 * that every `drop` case comes back `keep`. That is the only check that can
 * distinguish a real guard from a reassuring one, and it fails loudly if the
 * anchor below stops matching — which is the signal that the function was
 * refactored and this file needs a human.
 */
const ANCHOR = "  if (needle.length < 2) return false;";
const source = readFileSync(path.join(REPO, "app", "lib", "quiz-parse.ts"), "utf8");
let selfTestFailures = 0;

console.log("\nself-test — with `leaksAnswer` neutered, every drop case must become keep");

if (!source.includes(ANCHOR)) {
  console.log("  FAIL  the guard has moved — no `" + ANCHOR.trim() + "` in quiz-parse.ts.");
  console.log("        Re-point ANCHOR at whatever now short-circuits leaksAnswer.");
  selfTestFailures = 1;
} else {
  const neutered = path.join(OUT_DIR, "quiz-parse.neutered.mjs");
  await build({
    stdin: {
      contents: source.replace(ANCHOR, "  return false;"),
      resolveDir: path.join(REPO, "app", "lib"),
      loader: "ts",
      sourcefile: "quiz-parse.ts",
    },
    bundle: true,
    format: "esm",
    platform: "neutral",
    outfile: neutered,
    logLevel: "warning",
  });
  const loose = await import(pathToFileURL(neutered).href);

  for (const testCase of cases.filter((entry) => entry.verdict === "drop")) {
    let actual;
    try {
      actual =
        loose.parseQuizQuestions(JSON.stringify({ questions: [testCase.q] }), 1).questions.length === 1
          ? "keep"
          : "drop";
    } catch {
      actual = "drop";
    }
    const ok = actual === "keep";
    if (!ok) selfTestFailures += 1;
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${testCase.name}${ok ? "" : " — still dropped without the guard"}`);
  }
}

console.log("");
if (failures === 0 && selfTestFailures === 0 && exampleFailures === 0) {
  console.log(`${cases.length}/${cases.length} cases behaved as expected.`);
  console.log("worked examples: the prompt and the parser agree.");
  console.log("self-test: the drops are the guard's doing, not the case list's.");
} else {
  console.log(
    `${failures} case failure(s), ${exampleFailures} example failure(s), ${selfTestFailures} self-test failure(s).`
  );
  process.exitCode = 1;
}
