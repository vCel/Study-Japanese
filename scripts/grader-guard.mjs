/**
 * Guards the grading contract between `answersMatch` and the prompt.
 *
 * `answersMatch` in `app/components/quiz-runner.tsx` decides whether the learner
 * was right, and it forgives exactly four things: furigana annotations,
 * `**bold**`, whitespace, and a fixed set of punctuation. Everything else is
 * exact — there is no stemming, no article stripping, and **no romaji
 * conversion anywhere in the app**.
 *
 * That last part is why this file exists. The input box promises the learner
 * that "kana or romaji both count", and the only thing that makes that true is
 * the model filling `acceptableAnswers` with both spellings. `ANSWER_FORM` in
 * `app/lib/quiz-prompt.ts` is the instruction that makes it happen — so the two
 * have to agree, and neither one fails loudly when they drift:
 *
 *  - If the prompt stops requiring the romaji, learners typing `toshokan` are
 *    marked wrong for a correct answer, and nothing logs it.
 *  - If the grader's punctuation set grows, the prompt under-promises and the
 *    learner is marked wrong for a character the prompt never mentioned.
 *  - If someone "improves" `answersMatch` to strip leading "to" or "the", every
 *    rule in `ANSWER_FORM` about not writing them becomes wrong.
 *
 * The cases below pin the grader's real behaviour, and the last check compares
 * the punctuation set in the code against the one written out in the prompt —
 * the hand-mirrored pair this repo keeps getting wrong.
 *
 * Run with `npm run grader:guard`.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(REPO, "node_modules", ".cache", "grader-guard");
const RUNNER = path.join(REPO, "app", "components", "quiz-runner.tsx");
const PROMPT = path.join(REPO, "app", "lib", "quiz-prompt.ts");

const { build } = createRequire(import.meta.url)("esbuild");

fs.mkdirSync(OUT_DIR, { recursive: true });
const bundle = path.join(OUT_DIR, "quiz-runner.mjs");

const EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];

await build({
  stdin: {
    contents: `export { answersMatch } from ${JSON.stringify(RUNNER)};`,
    resolveDir: REPO,
    loader: "ts",
    sourcefile: "grader-guard-entry.ts",
  },
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: bundle,
  logLevel: "warning",
  loader: { ".css": "empty" },
  // Vite-only global that vendored lightswind components touch at module scope.
  define: {
    "import.meta.env": JSON.stringify({ DEV: false, PROD: true, MODE: "production", SSR: true }),
  },
  mainFields: ["module", "main"],
  plugins: [
    {
      name: "alias-and-export",
      setup(b) {
        // `~/lib/x` and `~/components/x` are vite aliases pointing at app/.
        // esbuild takes an onResolve path as final, so the extension has to be
        // resolved here rather than through `resolveExtensions`.
        b.onResolve({ filter: /^~\// }, (args) => {
          const base = path.join(REPO, "app", args.path.slice(2));
          const hit = [
            ...EXTENSIONS.map((ext) => base + ext),
            ...EXTENSIONS.map((ext) => path.join(base, `index${ext}`)),
          ].find((candidate) => fs.existsSync(candidate));
          if (!hit) throw new Error(`unresolved alias ${args.path}`);
          return { path: hit };
        });
        // `answersMatch` is not exported. Appending the export keeps the bytes
        // under test identical to the shipped ones — a copy would not.
        b.onLoad({ filter: /quiz-runner\.tsx$/ }, async (args) => ({
          contents: `${await fs.promises.readFile(args.path, "utf8")}\nexport { answersMatch };\n`,
          loader: "tsx",
        }));
      },
    },
  ],
});

const { answersMatch } = await import(pathToFileURL(bundle).href);

/** A stand-in carrying only the fields `answersMatch` reads. */
const q = (answer, acceptableAnswers) => ({ answer, acceptableAnswers });

/**
 * The grader's behaviour, as the prompt depends on it.
 *
 * `true` means the learner is marked correct. The first block is the romaji
 * promise; the second is the failure the prompt rule exists to prevent — note
 * that both "omitted from alts" cases are the *model's* fault, not the grader's,
 * and they are here to prove the prompt's rule is load-bearing rather than
 * decorative.
 */
const cases = [
  // The input box says "kana or romaji both count".
  ["kana typed for an annotated kanji answer", "としょかん", q("図書館《としょかん》", ["としょかん", "toshokan"]), true],
  ["romaji typed for an annotated kanji answer", "toshokan", q("図書館《としょかん》", ["としょかん", "toshokan"]), true],
  ["kanji typed for an annotated kanji answer", "図書館", q("図書館《としょかん》", ["としょかん", "toshokan"]), true],
  ["romaji in mixed case, with padding", "  Toshokan ", q("図書館《としょかん》", ["としょかん", "toshokan"]), true],
  ["kana typed for a long reading", "ゆうきゅうきゅうか", q("有給休暇《ゆうきゅうきゅうか》", ["ゆうきゅうきゅうか", "yuukyuukyuuka"]), true],
  ["romaji typed for a long reading", "yuukyuukyuuka", q("有給休暇《ゆうきゅうきゅうか》", ["ゆうきゅうきゅうか", "yuukyuukyuuka"]), true],

  // ...and it is only true because the model filled the field.
  ["romaji when the model omitted it from alts", "toshokan", q("図書館《としょかん》", ["としょかん"]), false],
  ["romaji when alts is absent entirely", "toshokan", q("図書館《としょかん》", undefined), false],

  // The four allowances, and the things that are deliberately NOT forgiven.
  ["plain English answer", "eat", q("eat", []), true],
  ["a leading 'to' is NOT forgiven", "to eat", q("eat", []), false],
  ["a leading 'the' is NOT forgiven", "the company cafeteria", q("company cafeteria", []), false],
  ["bold markers in the answer", "学生", q("**学生《がくせい》**", []), true],
  ["a sentence-final 。 is forgiven", "私は学生です", q("私《わたし》は学生《がくせい》です。", []), true],
  ["a full-width space is forgiven", "私　は　学生です", q("私《わたし》は学生《がくせい》です", []), true],
  ["a half-width space is forgiven", "私 は 学生です", q("私《わたし》は学生《がくせい》です", []), true],
  ["a genuinely wrong answer is still wrong", "ほん", q("図書館《としょかん》", ["としょかん", "toshokan"]), false],
];

let failures = 0;
const fail = (message) => {
  failures += 1;
  console.log(`  FAIL  ${message}`);
};

console.log(`grader-guard — ${cases.length} cases against answersMatch\n`);
for (const [name, typed, question, expected] of cases) {
  const actual = answersMatch(typed, question);
  if (actual === expected) {
    console.log(`  ok    ${actual ? "correct  " : "incorrect"}  ${name}`);
  } else {
    fail(`${name} — expected ${expected ? "correct" : "incorrect"}, got ${actual ? "correct" : "incorrect"}`);
  }
}

/**
 * The hand-mirrored pair: the prompt writes the punctuation set out in prose, so
 * adding a character to one side without the other is silent.
 *
 * Every occurrence of the anchor is checked, not just the first — the phrase
 * appears both in the doc comment and in the string the model actually reads,
 * and a stale copy in either one is the same bug. For each, the first run of
 * class characters is compared as a set; taking only the first run avoids
 * picking up an unrelated sentence period further along the line.
 */
console.log("\npunctuation set — every list in the prompt must match what the grader strips");

const runnerSource = fs.readFileSync(RUNNER, "utf8");
const classMatch = runnerSource.match(/\.replace\(\/\[([^\]]*)\]\//g)?.find((m) => m.includes("。"));
if (!classMatch) {
  fail("could not find the punctuation class in answersMatch — was the replace() rewritten?");
} else {
  const classChars = [...classMatch.slice(classMatch.indexOf("[") + 1, classMatch.lastIndexOf("]"))];
  const classSet = new Set(classChars);

  const promptSource = fs.readFileSync(PROMPT, "utf8");
  const ANCHOR = "and the punctuation ";
  const WINDOW = 60;

  const starts = [];
  for (let from = 0; ; ) {
    const at = promptSource.indexOf(ANCHOR, from);
    if (at === -1) break;
    starts.push(at + ANCHOR.length);
    from = at + ANCHOR.length;
  }

  if (starts.length === 0) {
    fail(`the prompt no longer says "${ANCHOR}" — re-point this check`);
  }

  for (const start of starts) {
    const window = promptSource.slice(start, start + WINDOW);
    const first = [...window].findIndex((c) => classSet.has(c));
    if (first === -1) {
      fail(`a list near offset ${start} contains no punctuation characters at all`);
      continue;
    }
    let end = first;
    while (end < window.length && classSet.has(window[end])) end += 1;

    const listed = [...window.slice(first, end)];
    const listedSet = new Set(listed);
    const missing = classChars.filter((c) => !listedSet.has(c));
    const extra = listed.filter((c) => !classSet.has(c));
    // The line the occurrence sits on, so a failure points somewhere useful.
    const line = promptSource.slice(0, start).split("\n").length;

    if (missing.length === 0 && extra.length === 0) {
      console.log(`  ok    line ${line}: lists all ${classChars.length} — ${listed.join("")}`);
    } else {
      if (missing.length > 0) {
        fail(`line ${line}: the grader strips ${missing.join("")} but this list omits it`);
      }
      if (extra.length > 0) {
        fail(`line ${line}: this list promises ${extra.join("")}, which the grader does not strip`);
      }
    }
  }
}

if (failures === 0) {
  console.log("\nall checks passed.");
} else {
  console.log(`\n${failures} check(s) failed.`);
}
process.exit(failures === 0 ? 0 : 1);
