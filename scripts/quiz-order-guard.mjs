/**
 * Guards the question order in `app/lib/quiz-parse.ts`.
 *
 * Models write one question type at a time. Ask for an even split across
 * multiple-choice, typing and fill-in-the-blank and what comes back is still
 * four multiple-choice, then four typing, then four fill-in-the-blank — the
 * learner meets the quiz in blocks, which reads as four short quizzes rather
 * than one mixed one.
 *
 * `interleaveByType` deals them out instead, and it is the kind of function
 * that can be deleted without anything going red: every question is still
 * there, every question is still valid, and the only symptom is the block
 * structure coming back. Nothing else in the project looks at order at all —
 * the e2e suite stubs the generate route with JSON the parser never sees, so it
 * cannot reach this code path.
 *
 * Two properties are checked, because either alone is passable by a wrong
 * implementation. The **spread** check (no two adjacent questions share a type
 * while a second type still has questions left) is what was asked for, and a
 * plain shuffle fails it often enough to matter. The **variation** check is the
 * other half of "random order": a deterministic round-robin — always starting
 * with multiple-choice — would satisfy the spread check and give every retake
 * the same sequence.
 *
 * Run with `npm run quiz:order`.
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(REPO, "node_modules", ".cache", "quiz-order-guard");
const SOURCE = path.join(REPO, "app", "lib", "quiz-parse.ts");

const { build } = createRequire(import.meta.url)("esbuild");

mkdirSync(OUT_DIR, { recursive: true });
const bundle = path.join(OUT_DIR, "quiz-parse.mjs");
await build({
  entryPoints: [SOURCE],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: bundle,
  logLevel: "warning",
});

const { parseQuizQuestions } = await import(pathToFileURL(bundle).href);

/** One valid question of each type, distinguishable by its prompt. */
function make(type, index) {
  const base = { prompt: `${type} ${index}` };
  switch (type) {
    case "multiple-choice":
      return { ...base, type, options: ["student", "teacher"], answer: "student" };
    case "input":
      return { ...base, type, prompt: `How is 学生 read? (${index})`, answer: "がくせい" };
    case "fill-blanks":
      return { ...base, type, sentence: `私___学生です。(${index})`, answer: "は" };
    default:
      return { ...base, type, answer: "true" };
  }
}

const block = (type, count) => Array.from({ length: count }, (_, i) => make(type, i + 1));

/** Parse a fixture without trimming anything. */
function parsed(questions) {
  return parseQuizQuestions(JSON.stringify({ questions }), questions.length).questions;
}

/** How many questions of each type came back. */
function counts(questions) {
  const tally = {};
  for (const question of questions) tally[question.type] = (tally[question.type] ?? 0) + 1;
  return tally;
}

/**
 * The mix as a comparable string.
 *
 * Sorted, because the interleave picks its leading type at random and a tally
 * therefore comes back with its keys in a different order run to run — an
 * `Object.keys` comparison would call two identical mixes different.
 */
function mix(tally) {
  return JSON.stringify(Object.entries(tally).sort());
}

/** Indices where a question repeats the type of the one before it. */
function repeats(questions, upTo = questions.length) {
  const found = [];
  for (let i = 1; i < upTo; i++) {
    if (questions[i].type === questions[i - 1].type) found.push(i);
  }
  return found;
}

/**
 * Each case is a fixture in the shape the models actually return — one type at
 * a time — plus how far into it the types must stay apart.
 *
 * `spreadTo` is the point past which a repeat stops being the parser's fault:
 * it is `smallest block × number of types`, which is exactly how far one
 * question per type can carry before the shortest block runs out.
 */
const cases = [
  {
    name: "two types, four each",
    questions: [...block("multiple-choice", 4), ...block("input", 4)],
    spreadTo: 8,
  },
  {
    name: "three types, uneven blocks",
    questions: [
      ...block("multiple-choice", 5),
      ...block("fill-blanks", 3),
      ...block("true-false", 2),
    ],
    spreadTo: 6,
  },
  {
    name: "one type only — nothing to interleave",
    questions: block("input", 4),
    spreadTo: 0,
  },
  {
    name: "a single question",
    questions: block("multiple-choice", 1),
    spreadTo: 0,
  },
];

let failures = 0;
console.log(`quiz-order-guard — ${cases.length} cases against app/lib/quiz-parse.ts\n`);

for (const testCase of cases) {
  const fixture = testCase.questions;
  const out = parsed(fixture);

  // The fixture has to be the shape the bug produces, or the case proves
  // nothing: a fixture that already alternates would pass any implementation.
  const groupedIn = repeats(fixture).length;
  if (fixture.length > 1 && testCase.spreadTo > 0 && groupedIn === 0) {
    console.log(`  FAIL  ${testCase.name} — the fixture is not grouped, so it cannot test anything`);
    failures += 1;
    continue;
  }

  if (out.length !== fixture.length) {
    console.log(`  FAIL  ${testCase.name} — ${out.length} of ${fixture.length} questions survived`);
    failures += 1;
    continue;
  }

  const before = mix(counts(fixture));
  const after = mix(counts(out));
  if (before !== after) {
    console.log(`  FAIL  ${testCase.name} — the mix changed: ${before} → ${after}`);
    failures += 1;
    continue;
  }

  const stuck = repeats(out, testCase.spreadTo);
  if (stuck.length > 0) {
    const at = stuck[0];
    console.log(
      `  FAIL  ${testCase.name} — ${out[at - 1].type} twice in a row at position ${at} of ${out.length}`
    );
    failures += 1;
    continue;
  }

  console.log(
    `  ok    ${testCase.name} — ${out.length} kept, mix intact, types apart through ${testCase.spreadTo}`
  );
}

/**
 * The variation half: the order has to differ between runs.
 *
 * Deliberately checked by repeating the same fixture rather than by asserting
 * on one output — a fixed sequence satisfies the spread check perfectly, and
 * would hand every learner the same quiz order forever.
 */
console.log("\nvariation — the same quiz must not come back in the same order every time");
{
  const fixture = [...block("multiple-choice", 4), ...block("input", 4)];
  const seen = new Set();
  const RUNS = 40;
  for (let i = 0; i < RUNS; i++) {
    seen.add(parsed(fixture).map((question) => question.prompt).join(","));
  }
  if (seen.size < 2) {
    console.log(`  FAIL  ${RUNS} runs produced a single order — the interleave is deterministic`);
    failures += 1;
  } else {
    console.log(`  ok    ${RUNS} runs produced ${seen.size} distinct orders`);
  }
}

/**
 * The self-test: with the interleave removed, the grouped fixture must come
 * back grouped.
 *
 * Without this the whole file could read "the order is spread" while never
 * reaching `interleaveByType` — every question is still valid, so the checks
 * above would pass on a parser that had quietly stopped calling it. Failing
 * loudly here is also the signal that the anchor below moved and this file
 * needs a human.
 */
const ANCHOR = "  return { questions: interleaveByType(questions), dropped };";
const source = readFileSync(SOURCE, "utf8");
let selfTestFailures = 0;

console.log("\nself-test — without the interleave, the grouped fixture must stay grouped");

if (!source.includes(ANCHOR)) {
  console.log(`  FAIL  the guard has moved — no \`${ANCHOR.trim()}\` in quiz-parse.ts.`);
  console.log("        Re-point ANCHOR at whatever now orders the questions.");
  selfTestFailures = 1;
} else {
  const neutered = path.join(OUT_DIR, "quiz-parse.neutered.mjs");
  await build({
    stdin: {
      contents: source.replace(ANCHOR, "  return { questions, dropped };"),
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

  for (const testCase of cases.filter((entry) => entry.spreadTo > 0)) {
    const out = loose.parseQuizQuestions(
      JSON.stringify({ questions: testCase.questions }),
      testCase.questions.length
    ).questions;
    const ok = repeats(out, testCase.spreadTo).length > 0;
    if (!ok) selfTestFailures += 1;
    console.log(
      `  ${ok ? "ok  " : "FAIL"}  ${testCase.name}${ok ? "" : " — still spread without the interleave"}`
    );
  }
}

console.log("");
if (failures === 0 && selfTestFailures === 0) {
  console.log(`${cases.length}/${cases.length} cases behaved as expected.`);
  console.log("variation: the order is not fixed.");
  console.log("self-test: the spread is the interleave's doing, not the fixture's.");
} else {
  console.log(`${failures} case failure(s), ${selfTestFailures} self-test failure(s).`);
  process.exitCode = 1;
}
