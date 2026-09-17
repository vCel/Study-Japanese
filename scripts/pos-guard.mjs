#!/usr/bin/env node
/**
 * Guards the part-of-speech values the app and the table agree on.
 *
 * Two implementations have to agree about a legacy pos value, and neither fails
 * loudly on its own: `migrations/0015_pos_categories.sql`, which moved the rows
 * that already held one, and `POS_SYNONYMS` in `app/lib/vocab.ts`, which maps
 * the same labels on import. A row left on a value POS_VALUES does not know is
 * absent from every pill on /words, and word-edit.tsx's own whitelist has no
 * option for it either — so the next save parses its pos to null and blanks it.
 *
 *   1. The legacy values really are outside POS_VALUES. If one is added to the
 *      catalog, this guard is asserting a bug that no longer exists.
 *   2. The migration's SQL assigns each of them the class below.
 *   3. The import path assigns the same class. This is the pin: 1 and 2 can
 *      both hold while the two implementations quietly disagree.
 *   4. Every target is a value the app can store, show and edit.
 *   5. 0014's rule still holds — `"suffix"` is pos noun plus subtype suffix —
 *      and the two migrations do not fight over the same rows.
 *   6. Self-test: with the synonym lines deleted, every case above must lose its
 *      class. A guard that cannot fail is worth nothing.
 *
 * Run with `npm run pos:guard`.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(REPO, "node_modules", ".cache", "pos-guard");
const VOCAB = path.join(REPO, "app", "lib", "vocab.ts");
const FILTER = path.join(REPO, "app", "components", "pos-filter.tsx");
const MIGRATION = path.join(REPO, "migrations", "0015_pos_categories.sql");

const { build } = createRequire(import.meta.url)("esbuild");
fs.mkdirSync(OUT_DIR, { recursive: true });

/** Bundle `parseVocabJson` from the real vocab.ts, or a doctored copy of it. */
async function bundle(outfile, contents) {
  await build({
    ...(contents
      ? {
          stdin: {
            contents,
            resolveDir: path.join(REPO, "app", "lib"),
            loader: "ts",
            sourcefile: "vocab.ts",
          },
        }
      : { entryPoints: [VOCAB] }),
    bundle: true,
    format: "esm",
    platform: "neutral",
    outfile,
    logLevel: "warning",
  });
}

const REAL = path.join(OUT_DIR, "vocab.mjs");
await bundle(REAL);
const { parseVocabJson } = await import(pathToFileURL(REAL).href);

let failures = 0;
const fail = (message) => {
  failures += 1;
  console.log(`  FAIL  ${message}`);
};
const ok = (message) => console.log(`  ok    ${message}`);
const check = (label, actual, expected) => {
  if (actual === expected) ok(`${label} → ${JSON.stringify(actual)}`);
  else fail(`${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
};

/** The class each legacy value must land on. Measured live D1, 2026-09-17. */
const LEGACY = { expression: "other", pronoun: "noun", interjection: "other" };
/** Labels an import may use for the same value, all of which must agree. */
const ALIASES = { expr: "expression", pron: "pronoun", intj: "interjection" };
/**
 * Labels the app has no synonym for. They must land on the fallback rather than
 * being stored as free text: that is the half of the rule covering a label
 * nobody listed, and the reason an unknown import cannot create a row the edit
 * form has no option for.
 */
const UNKNOWN = ["onomatopoeia", "counters", "determiner", "連体詞"];

console.log("1. The legacy values are genuinely outside the catalog");
const valuesMatch = fs.readFileSync(VOCAB, "utf8").match(/POS_VALUES\s*=\s*\[([^\]]*)\]/);
let POS_VALUES = [];
if (!valuesMatch) {
  fail("POS_VALUES not found in app/lib/vocab.ts — this guard's anchor moved.");
} else {
  POS_VALUES = valuesMatch[1].split(",").map((v) => v.trim().replace(/^"|"$/g, "")).filter(Boolean);
  ok(`POS_VALUES = ${POS_VALUES.join(", ")}`);
  for (const value of Object.keys(LEGACY)) {
    if (POS_VALUES.includes(value)) fail(`"${value}" is in POS_VALUES — the migration is moot, drop both`);
    else ok(`"${value}" is not a pos the app offers`);
  }
}

console.log("\n2. The migration assigns each legacy value that class");
const sql = fs.readFileSync(MIGRATION, "utf8");
const assigned = {};
for (const match of sql.matchAll(
  /UPDATE\s+words\s+SET\s+pos\s*=\s*'([^']+)'\s+WHERE\s+pos\s+(?:IN\s*\(([^)]*)\)|=\s*'([^']+)')/gi
)) {
  const target = match[1];
  const values = match[2]
    ? match[2].split(",").map((v) => v.trim().replace(/^'|'$/g, ""))
    : [match[3]];
  for (const value of values) assigned[value] = target;
}
if (Object.keys(assigned).length === 0) {
  fail("no `UPDATE words SET pos = …` statements matched — the migration's shape changed.");
}
for (const [value, target] of Object.entries(LEGACY)) {
  check(`0015: ${value}`, assigned[value] ?? "(not assigned)", target);
}
for (const value of Object.keys(assigned)) {
  if (!(value in LEGACY)) fail(`0015 assigns "${value}", which is not a value this guard knows about`);
}

console.log("\n3. The import path assigns the same class");
const imported = (entry) => {
  const parsed = parseVocabJson(JSON.stringify(entry));
  if (!parsed.ok) return `error: ${parsed.error}`;
  const [first] = parsed.entries;
  return `${first.pos}/${first.subtype}`;
};
for (const [value, target] of Object.entries(LEGACY)) {
  check(`pos "${value}"`, imported({ word: "はじめまして", kana: "はじめまして", pos: value, meanings: ["x"] }), `${target}/null`);
}
for (const [alias, value] of Object.entries(ALIASES)) {
  check(`pos "${alias}" (alias of ${value})`, imported({ word: "x", kana: "x", pos: alias, meanings: ["x"] }), `${LEGACY[value]}/null`);
}
for (const label of UNKNOWN) {
  check(`pos "${label}" (unknown)`, imported({ word: "x", kana: "x", pos: label, meanings: ["x"] }), "other/null");
}

console.log("\n4. Every target is a value the app can store and show");
for (const target of new Set(Object.values(LEGACY))) {
  if (POS_VALUES.includes(target) || target === "phrase") ok(`"${target}" is storable`);
  else fail(`"${target}" is not in POS_VALUES and is not "phrase"`);
}

console.log("\n5. 0014's rule is untouched, and the migrations do not overlap");
check("pos \"suffix\"", imported({ word: "～さん", kana: "～さん", pos: "suffix", meanings: ["Mr./Ms."] }), "noun/suffix");
check("pos \"phrase\" still reaches the Phrases page", imported({ word: "いらっしゃる", kana: "いらっしゃる", pos: "phrase", meanings: ["to be"] }), "phrase/null");
if ("suffix" in assigned) fail("0015 rewrites pos='suffix' too — 0014 already did that");
else ok("0015 leaves pos='suffix' to 0014");

console.log("\n6. The pos lists agree with each other");
/** The `value: "…"` entries of a `const NAME … = [ … ];` block in a source file. */
function optionValues(file, name) {
  const source = fs.readFileSync(path.join(REPO, file), "utf8");
  const block = source.match(new RegExp(`const ${name}[^=]*=\\s*\\[([\\s\\S]*?)\\];`));
  if (!block) return null;
  return [...block[1].matchAll(/value:\s*"([^"]*)"/g)].map((match) => match[1]).filter(Boolean);
}
const lists = {};
for (const [label, file, name] of [
  ["edit-word-form POS_OPTIONS", "app/components/edit-word-form.tsx", "POS_OPTIONS"],
  ["vocab-rows POS_OPTIONS", "app/lib/vocab-rows.ts", "POS_OPTIONS"],
  ["quiz-setup POS_OPTIONS", "app/components/quiz-setup.tsx", "POS_OPTIONS"],
  ["study-setup POS_OPTIONS", "app/components/study-setup.tsx", "POS_OPTIONS"],
  ["pos-filter POS_FILTERS", "app/components/pos-filter.tsx", "POS_FILTERS"],
]) {
  const values = optionValues(file, name);
  if (!values) fail(`${label} not found in ${file} — this guard's anchor moved.`);
  else lists[label] = values;
}
const editOptions = lists["edit-word-form POS_OPTIONS"];
const routeSource = fs.readFileSync(path.join(REPO, "app", "routes", "word-edit.tsx"), "utf8");
const whitelistMatch = routeSource.match(/\["noun",\s*"verb"[\s\S]*?\]\.includes/);
const routeWhitelist = whitelistMatch
  ? [...whitelistMatch[0].matchAll(/"([^"]+)"/g)].map((match) => match[1])
  : null;
if (!routeWhitelist) fail("word-edit.tsx's pos whitelist not found — this guard's anchor moved.");

if (editOptions && routeWhitelist) {
  const dropped = editOptions.filter((value) => !routeWhitelist.includes(value));
  if (dropped.length) {
    fail(`word-edit.tsx rejects ${dropped.join(", ")}, which its own form offers — saving one blanks the pos`);
  } else {
    ok("the word form's route accepts every option the form offers");
  }
}

if (editOptions) {
  const storables = [...POS_VALUES, "phrase"];
  const missing = storables.filter((value) => !editOptions.includes(value));
  if (missing.length) fail(`the word form has no option for ${missing.join(", ")}, which a row can be stored with`);
  else ok(`every storable pos has a form option (${storables.join(", ")})`);

  // Nothing may offer a value the edit form cannot round-trip. That is the bug
  // that blanked 22 rows before 0015, and the bulk editor, the quiz and study
  // filters are all separate literals.
  for (const [label, values] of Object.entries(lists)) {
    if (label === "edit-word-form POS_OPTIONS") continue;
    const extra = values.filter((value) => !editOptions.includes(value));
    if (extra.length) fail(`${label} offers ${extra.join(", ")}, which the word form cannot round-trip`);
    else ok(`${label} offers nothing the word form cannot round-trip`);
  }
}

if (lists["pos-filter POS_FILTERS"]) {
  const stray = lists["pos-filter POS_FILTERS"].filter((value) => !POS_VALUES.includes(value));
  if (stray.length) fail(`a filter pill filters on ${stray.join(", ")}, which is not in POS_VALUES`);
  else ok("every filter pill filters on a value POS_VALUES knows");
}

console.log("\n7. Self-test — every case must fail without the code it pins");
const vocabSource = fs.readFileSync(VOCAB, "utf8").replace(/\r\n/g, "\n");

/** Bundle a doctored vocab.ts and hand back its `parseVocabJson`. */
async function doctored(label, from, to) {
  const source = typeof from === "string" ? vocabSource.replace(from, to) : vocabSource.replace(from, to);
  if (source === vocabSource) {
    fail(`${label}: the anchor moved, so this self-test proved nothing.`);
    return null;
  }
  const out = path.join(OUT_DIR, `vocab-${label}.mjs`);
  await bundle(out, source);
  return (await import(pathToFileURL(out).href)).parseVocabJson;
}

const parse = (parseVocabJson, value) => {
  const result = parseVocabJson(JSON.stringify({ word: "x", kana: "x", pos: value, meanings: ["x"] }));
  return result.ok ? result.entries[0].pos : `error: ${result.error}`;
};

// The clamp is what stops a value the app has no option for from being stored
// at all — it is the half that covers every label nobody thought of.
const freeText = await doctored(
  "freetext",
  'return STORABLE_POS.includes(canonical) ? canonical : "other";',
  "return canonical;"
);
if (freeText) {
  if (UNKNOWN.length === 0) fail("no unknown label to test the clamp with — this check is vacuous");
  for (const label of UNKNOWN) {
    const pos = parse(freeText, label);
    if (pos === "other") fail(`without the clamp, "${label}" still resolves to other`);
    else ok(`without the clamp, "${label}" falls through to ${JSON.stringify(pos)}`);
  }
}

// The synonym table is what puts a legacy label on its own class rather than on
// the fallback, so it is only checkable where the two differ.
const noSynonyms = await doctored(
  "nosynonyms",
  /\n {2}\/\/ Values the table held[\s\S]*?\n {2}intj: "other",/,
  ""
);
if (noSynonyms) {
  const specific = Object.entries(LEGACY).filter(([, target]) => target !== "other");
  if (specific.length === 0) fail("no case depends on the synonym table — this check is vacuous");
  for (const [value, target] of specific) {
    const pos = parse(noSynonyms, value);
    if (pos === target) fail(`without the synonym table, "${value}" still resolves to ${pos}`);
    else ok(`without the synonym table, "${value}" falls through to ${JSON.stringify(pos)}`);
  }
}

if (failures === 0) {
  console.log("\nall checks passed.");
} else {
  console.log(`\n${failures} check(s) failed.`);
}
process.exit(failures === 0 ? 0 : 1);
