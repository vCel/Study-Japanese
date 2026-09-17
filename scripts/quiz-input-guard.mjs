/**
 * Guards the shape of an `input` question in `app/lib/quiz-parse.ts`.
 *
 * An `input` question is one of three bounded shapes — fill a gap, rewrite a
 * sentence, or type a reading — and the *parser* decides which, from the
 * question's own fields (`inputForm`). Two things downstream depend on that
 * decision, and neither can see it being made:
 *
 *   - `quiz-runner.tsx` shows `sentence` above the box, so a gap or a rewrite
 *     whose sentence is dropped arrives unanswerable.
 *   - it hides the furigana when `form === "reading"`, because on that question
 *     the annotation *is* the answer.
 *
 * The e2e specs stub the API and hand the runner a question that already has
 * `form` and `sentence` set, so they pin the UI half of the contract and are
 * structurally blind to this one. That is how a parser which never called
 * `inputForm` shipped with a green suite: the function was written, documented,
 * and dead, and the only tests that touched the feature bypassed it. The cases
 * below are the parser half, and the self-test at the bottom is what makes them
 * worth running.
 *
 * Run with `npm run quiz:input`.
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(REPO, "node_modules", ".cache", "quiz-input-guard");
const SOURCE = path.join(REPO, "app", "lib", "quiz-parse.ts");

const { build } = createRequire(import.meta.url)("esbuild");
mkdirSync(OUT_DIR, { recursive: true });

/** Bundle `quiz-parse.ts` — the real file, or a doctored copy of its text. */
async function bundle(outfile, contents) {
  await build({
    ...(contents
      ? {
          stdin: {
            contents,
            resolveDir: path.join(REPO, "app", "lib"),
            loader: "ts",
            sourcefile: "quiz-parse.ts",
          },
        }
      : { entryPoints: [SOURCE] }),
    bundle: true,
    format: "esm",
    platform: "neutral",
    outfile,
    logLevel: "warning",
  });
  return import(pathToFileURL(outfile).href);
}

const parser = await bundle(path.join(OUT_DIR, "quiz-parse.mjs"));

/**
 * One raw model question per case, with the shape the parser should read off it.
 *
 * `form: undefined` is not a gap in the table — it is the answer for a question
 * that is neither of the three shapes, which is what a bare prompt-and-type
 * question (a gloss, a translation) has to stay.
 */
const cases = [
  {
    name: "a gap in the sentence is a fill-the-gap question",
    q: {
      type: "input",
      prompt: "Fill the gap. Type the missing word.",
      sentence: "駅《えき》まで___で行《い》きます。",
      answer: "電車《でんしゃ》",
      acceptableAnswers: ["でんしゃ", "densha"],
    },
    form: "blank",
    sentence: "駅《えき》まで___で行《い》きます。",
  },
  {
    name: "a sentence with no gap is a rewrite",
    q: {
      type: "input",
      prompt: "Rewrite the sentence with 〜てある.",
      sentence: "チケットを買《か》いました。",
      answer: "チケットを買《か》ってあります。",
      acceptableAnswers: ["ちけっとをかってあります", "chiketto wo katte arimasu"],
    },
    form: "transform",
    sentence: "チケットを買《か》いました。",
  },
  {
    name: "a kana answer to a bare prompt is a reading",
    q: {
      type: "input",
      prompt: "Type the reading of 出発 in kana.",
      answer: "しゅっぱつ",
      acceptableAnswers: ["shuppatsu"],
    },
    form: "reading",
    sentence: undefined,
  },
  {
    name: "a kanji answer with no sentence stays a plain typing question",
    q: {
      type: "input",
      prompt: "Type the Japanese for company cafeteria.",
      answer: "社食《しゃしょく》",
      acceptableAnswers: ["しゃしょく", "shashoku"],
    },
    form: undefined,
    sentence: undefined,
  },
  {
    name: "an English gloss with no sentence stays a plain typing question",
    q: {
      type: "input",
      prompt: "What does 定食《ていしょく》 mean?",
      answer: "set meal",
      acceptableAnswers: [],
    },
    form: undefined,
    sentence: undefined,
  },
  {
    // The boundary, written down so that moving it later is a decision rather
    // than an accident. A romaji primary answer is character-for-character
    // indistinguishable from an English gloss, so the parser does not read one
    // as a reading and the furigana stays up. The prompt carries that weight
    // instead: it asks for the reading *in kana* and puts the romaji in
    // `acceptableAnswers`. If a model ever leads with romaji, the reading is on
    // screen — fix it in the prompt, not with a guess here.
    name: "romaji primary answer — not detected; the prompt pins kana instead",
    q: {
      type: "input",
      prompt: "Type the reading of 出発.",
      answer: "shuppatsu",
      acceptableAnswers: ["しゅっぱつ"],
    },
    form: undefined,
    sentence: undefined,
  },
];

/** Run one raw question through the real parser; a throw means it was dropped. */
function parseOne(q) {
  try {
    return parser.parseQuizQuestions(JSON.stringify({ questions: [q] }), 1).questions[0] ?? null;
  } catch {
    return null;
  }
}

let failures = 0;
console.log(`quiz-input-guard — ${cases.length} cases against app/lib/quiz-parse.ts\n`);

for (const testCase of cases) {
  const parsed = parseOne(testCase.q);
  const problems = [];
  if (!parsed) {
    problems.push("dropped");
  } else {
    if (parsed.form !== testCase.form) {
      problems.push(`form ${parsed.form ?? "undefined"}, expected ${testCase.form ?? "undefined"}`);
    }
    if (parsed.sentence !== testCase.sentence) {
      problems.push(
        `sentence ${parsed.sentence ?? "undefined"}, expected ${testCase.sentence ?? "undefined"}`
      );
    }
  }
  const ok = problems.length === 0;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${(testCase.form ?? "—").padEnd(9)} ${testCase.name}`);
  if (!ok) console.log(`          ${problems.join("; ")}`);
}

/**
 * The prompt's own worked examples have to come back with their shape intact.
 *
 * `quiz-prompt.ts` and `quiz-parse.ts` must agree about what a good question
 * looks like, and nothing else checks that they do — the models copy the
 * examples far more closely than they follow the rules, so an example the
 * parser silently strips is a shape the prompt asks for and the app then
 * breaks. This is the check that would have caught the dead `inputForm` from
 * the prompt side: the gap and rewrite examples came back with no sentence at
 * all.
 */
console.log("\nworked examples — the prompt's input examples must keep their shape");
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
    const examples = JSON.parse(fenced[1]).questions.filter((q) => q.type === "input");
    for (const example of examples) {
      const parsed = parseOne(example);
      const problems = [];
      if (!parsed) problems.push("dropped");
      else {
        // Not circular: this asserts the shape *survived*, not which of
        // blank/transform the parser chose.
        if (parsed.form === undefined) problems.push("no form — the example has no shape");
        if (parsed.sentence !== example.sentence) {
          problems.push(`sentence ${parsed.sentence ?? "undefined"}, expected ${example.sentence ?? "undefined"}`);
        }
      }
      const ok = problems.length === 0;
      if (!ok) exampleFailures += 1;
      console.log(`  ${ok ? "ok  " : "FAIL"}  ${parsed?.form ?? "—"}`.padEnd(20) + `  ${example.prompt}`);
      if (!ok) console.log(`          ${problems.join("; ")}`);
    }
  }
}

/**
 * The self-test, and the reason to trust the loop above.
 *
 * Every case here would also pass against a parser that never looked at the
 * sentence, because the *expectations* are what is being compared and a
 * question with no shape at all reads as "form undefined" — which three of the
 * six cases expect. So bundle the module a second time with the wiring deleted
 * and assert that every case expecting a shape now fails to get one. That is
 * the only check that distinguishes a real guard from a reassuring one, and it
 * fails loudly if the anchor below stops matching, which is the signal that the
 * `input` branch was refactored and this file needs a human.
 */
const ANCHOR = "    sentence: sentence ?? undefined,\n    form: inputForm(answer, sentence),\n";
const source = readFileSync(SOURCE, "utf8");
let selfTestFailures = 0;

console.log("\nself-test — with the wiring deleted, every shaped case must lose its shape");

if (!source.includes(ANCHOR)) {
  console.log("  FAIL  the `input` branch has moved — its sentence/form wiring is not where this file expects.");
  console.log("        Re-point ANCHOR at whatever now sets `form` on an input question.");
  selfTestFailures = 1;
} else {
  const loose = await bundle(
    path.join(OUT_DIR, "quiz-parse.neutered.mjs"),
    source.replace(ANCHOR, "")
  );

  for (const testCase of cases.filter((entry) => entry.form !== undefined)) {
    let parsed = null;
    try {
      parsed = loose.parseQuizQuestions(JSON.stringify({ questions: [testCase.q] }), 1).questions[0] ?? null;
    } catch {
      parsed = null;
    }
    // Without the wiring the case must now disagree with its expectation.
    const ok = !parsed || parsed.form !== testCase.form || parsed.sentence !== testCase.sentence;
    if (!ok) selfTestFailures += 1;
    console.log(
      `  ${ok ? "ok  " : "FAIL"}  ${testCase.name}${ok ? "" : " — passed anyway, so this case proves nothing"}`
    );
  }
}

console.log("");
if (failures === 0 && exampleFailures === 0 && selfTestFailures === 0) {
  console.log(`${cases.length}/${cases.length} cases behaved as expected.`);
  console.log("worked examples: the prompt and the parser agree about the three shapes.");
  console.log("self-test: the shapes are the parser's doing, not the case list's.");
} else {
  console.log(
    `${failures} case failure(s), ${exampleFailures} example failure(s), ${selfTestFailures} self-test failure(s).`
  );
  process.exitCode = 1;
}
