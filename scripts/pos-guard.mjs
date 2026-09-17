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

console.log("1. The legacy values are genuinely outside the catalog");
const filterSource = fs.readFileSync(FILTER, "utf8");
const valuesMatch = filterSource.match(/POS_VALUES\s*=\s*\[([^\]]*)\]/);
let POS_VALUES = [];
if (!valuesMatch) {
  fail("POS_VALUES not found in app/components/pos-filter.tsx — this guard's anchor moved.");
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

console.log("\n6. Self-test — with the synonym lines gone, every case must lose its class");
const vocabSource = fs.readFileSync(VOCAB, "utf8").replace(/\r\n/g, "\n");
const stripped = vocabSource.replace(/\n {2}\/\/ Values the table held[\s\S]*?\n {2}intj: "other",/, "");
if (stripped === vocabSource) {
  fail("could not delete the synonym lines — the anchor moved, so this self-test proved nothing.");
} else {
  const DOCTORED = path.join(OUT_DIR, "vocab-doctored.mjs");
  await bundle(DOCTORED, stripped);
  const { parseVocabJson: doctored } = await import(pathToFileURL(DOCTORED).href);
  for (const value of Object.keys(LEGACY)) {
    const result = doctored(JSON.stringify({ word: "x", kana: "x", pos: value, meanings: ["x"] }));
    const pos = result.ok ? result.entries[0].pos : `error: ${result.error}`;
    if (pos === LEGACY[value]) fail(`without the mapping, "${value}" still resolves to ${pos} — the cases above are not testing it`);
    else ok(`without the mapping, "${value}" falls through to ${JSON.stringify(pos)}`);
  }
}

if (failures === 0) {
  console.log("\nall checks passed.");
} else {
  console.log(`\n${failures} check(s) failed.`);
}
process.exit(failures === 0 ? 0 : 1);
