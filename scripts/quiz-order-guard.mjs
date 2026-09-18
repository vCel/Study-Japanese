/**
 * Guards the list `parseQuizQuestions` hands the runner: its order, and its
 * membership.
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
 * The same complaint arrives on a second axis: a model that fixates writes its
 * questions about one library item together as well, and a fixation is a single
 * type too — so the type spread cannot see it. `spreadBySource` deals within
 * each type, and it gets its own check *and* its own self-test, because dropping
 * it moves nothing else here.
 *
 * The third section is membership rather than order: a question the model
 * returned twice is dropped (`factKey`), and that is invisible in the same way —
 * the quiz is simply one question shorter, with nothing to say which question
 * went or why.
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
 * One question about a given library item, citing it the way a model does.
 *
 * The prompt varies per item on purpose: `parseQuizQuestions` drops a question
 * it has already seen, and a fixture that asked the same thing about two items
 * in identical words would come back short for that reason instead.
 */
function aboutItem(id, n) {
  return {
    type: "input",
    prompt: `How is 学生 read? (item ${id}, question ${n})`,
    answer: "がくせい",
    sourceId: id,
    sourceKind: "word",
  };
}

/** Indices where a question repeats the library item of the one before it. */
function sourceRepeats(questions, upTo = questions.length) {
  const key = (question) => `${question.sourceKind ?? "?"}:${question.sourceId ?? "?"}`;
  const found = [];
  for (let i = 1; i < upTo; i++) {
    if (key(questions[i]) === key(questions[i - 1])) found.push(i);
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
 * The item axis, on its own fixture.
 *
 * Deliberately lopsided — five questions about one item and three about another
 * — because that is what makes the self-test below deterministic: five of eight
 * cannot be separated by three others, so *every* order of the raw fixture has
 * two neighbours from the same item, and only the deal can take them apart.
 *
 * `ITEM_SPREAD_TO` is the usual smallest-block × items: how far one question per
 * item carries before the shorter item runs out and the surplus has to follow
 * itself. That tail is not a failure — no arrangement avoids it.
 */
const itemFixture = [
  ...Array.from({ length: 5 }, (_, i) => aboutItem(7, i + 1)),
  ...Array.from({ length: 3 }, (_, i) => aboutItem(8, i + 1)),
];
const ITEM_SPREAD_TO = 6;

console.log("\nsource spread — questions about one item must not sit next to each other");
{
  const out = parsed(itemFixture);

  if (out.length !== itemFixture.length) {
    console.log(`  FAIL  ${out.length} of ${itemFixture.length} questions survived`);
    failures += 1;
  } else if (sourceRepeats(itemFixture).length === 0) {
    console.log("  FAIL  the fixture is not grouped by item, so it cannot test anything");
    failures += 1;
  } else {
    const stuck = sourceRepeats(out, ITEM_SPREAD_TO);
    if (stuck.length > 0) {
      const at = stuck[0];
      console.log(
        `  FAIL  item ${out[at].sourceId} twice in a row at position ${at} of ${out.length}`
      );
      failures += 1;
    } else {
      console.log(`  ok    items apart through ${ITEM_SPREAD_TO} of ${out.length}`);
    }
  }
}

/**
 * Membership: a question the model returned twice.
 *
 * The prompt forbids repeating a fact and the parser drops the repeat
 * (`factKey`), which is invisible — the quiz is simply one question shorter.
 * The interesting part is how narrow the key is, so the second case is the
 * control: two questions about one library item that are genuinely different
 * questions both have to survive, because a key that merged those would take
 * real questions out of every quiz without a symptom.
 */
const dedupeCases = [
  {
    name: "an exact repeat is dropped, and one copy is kept",
    questions: [aboutItem(7, 1), aboutItem(7, 1)],
    kept: 1,
  },
  {
    name: "a repeat differing only by its annotation is still a repeat",
    questions: [
      { type: "input", prompt: "Type the Japanese for company cafeteria.", answer: "社食《しゃしょく》" },
      { type: "input", prompt: "Type the Japanese for company cafeteria.", answer: "社食" },
    ],
    kept: 1,
  },
  {
    name: "meaning and reading of one word are different questions",
    questions: [
      { type: "input", prompt: "Type the reading of 図書館 in kana.", answer: "としょかん", sourceId: 4, sourceKind: "word" },
      { type: "multiple-choice", prompt: "What does 図書館 mean?", options: ["library", "hospital"], answer: "library", sourceId: 4, sourceKind: "word" },
    ],
    kept: 2,
  },
];

console.log("\nmembership — a question returned twice is dropped, a different one is not");
for (const testCase of dedupeCases) {
  const out = parsed(testCase.questions);
  const ok = out.length === testCase.kept;
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? "ok  " : "FAIL"}  ${testCase.name} — ${out.length} of ${testCase.questions.length} kept`
  );
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

/**
 * The item axis's own self-test, and its own anchor.
 *
 * The check above is the only one that fails if `spreadBySource` is dropped
 * while `interleaveByType` stays — and the type self-test cannot see that,
 * because it neuters the whole deal, so a fixture of one type comes back
 * grouped for a different reason. This one neuters the item deal alone and
 * requires the same lopsided fixture to come back with two neighbours from one
 * item, which every order of it has.
 */
const SOURCE_ANCHOR = "spreadBySource(shuffle(bucket))";

console.log("\nself-test — without the item deal, the lopsided fixture must come back grouped");

if (!source.includes(SOURCE_ANCHOR)) {
  console.log(`  FAIL  the item deal has moved — no \`${SOURCE_ANCHOR}\` in quiz-parse.ts.`);
  console.log("        Re-point SOURCE_ANCHOR at whatever now spreads the items.");
  selfTestFailures += 1;
} else {
  const neutered = path.join(OUT_DIR, "quiz-parse.no-source-spread.mjs");
  await build({
    stdin: {
      contents: source.replace(SOURCE_ANCHOR, "shuffle(bucket)"),
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

  const out = loose.parseQuizQuestions(
    JSON.stringify({ questions: itemFixture }),
    itemFixture.length
  ).questions;
  const ok = sourceRepeats(out).length > 0;
  if (!ok) selfTestFailures += 1;
  console.log(
    `  ${ok ? "ok  " : "FAIL"}  the lopsided fixture${ok ? "" : " — still spread without the item deal"}`
  );
}

/**
 * The membership self-test, with its own anchor.
 *
 * The cases above would pass against a parser that had stopped checking for
 * repeats, as long as something else dropped the second copy — and something
 * else easily could, since `leaksAnswer` and the option floors run on the same
 * entries. So the check has to be seen to be the one doing the work.
 */
const DEDUPE_ANCHOR = "    if (seen.has(key)) {";

console.log("\nself-test — without the repeat check, the dropped copies must come back");

if (!source.includes(DEDUPE_ANCHOR)) {
  console.log(`  FAIL  the repeat check has moved — no \`${DEDUPE_ANCHOR.trim()}\` in quiz-parse.ts.`);
  console.log("        Re-point DEDUPE_ANCHOR at whatever now drops a repeated question.");
  selfTestFailures += 1;
} else {
  const neutered = path.join(OUT_DIR, "quiz-parse.no-dedupe.mjs");
  await build({
    stdin: {
      contents: source.replace(DEDUPE_ANCHOR, "    if (false) {"),
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

  for (const testCase of dedupeCases.filter((entry) => entry.kept < entry.questions.length)) {
    const out = loose.parseQuizQuestions(
      JSON.stringify({ questions: testCase.questions }),
      testCase.questions.length
    ).questions;
    const ok = out.length === testCase.questions.length;
    if (!ok) selfTestFailures += 1;
    console.log(
      `  ${ok ? "ok  " : "FAIL"}  ${testCase.name}${ok ? "" : " — still dropped without the check"}`
    );
  }
}

console.log("");
if (failures === 0 && selfTestFailures === 0) {
  console.log(`order: ${cases.length}/${cases.length} cases behaved as expected.`);
  console.log("variation: the order is not fixed.");
  console.log("source spread: no two questions about one item sit together.");
  console.log("membership: a repeat is dropped and a different question is not.");
  console.log("self-test: the spreads and the drop are the parser's doing, not the fixtures'.");
} else {
  console.log(`${failures} case failure(s), ${selfTestFailures} self-test failure(s).`);
  process.exitCode = 1;
}
