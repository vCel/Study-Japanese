#!/usr/bin/env node
/**
 * Guards the romaji → kana form-name mapping in `app/lib/form-names.ts`.
 *
 * The conversion is written twice: in TypeScript, which runs on every import,
 * read and write, and in `migrations/0014_suffix_subtype_kana_forms.sql`, which
 * cleaned the rows that already existed. Neither fails loudly on its own — a bad
 * entry just puts the wrong kana in the library — so the checks below pin the
 * behaviour that both implementations have to agree on:
 *
 *   1. Every stem converts, and to something that is not romaji. `ta: "ta"` is
 *      the failure this exists to catch: it looks like a mapping and maps
 *      nothing, and a reader skimming the table would never see it.
 *   2. Idempotence. The mapping runs on the read path *and* the write path, so a
 *      second pass must not compound — `て` stays `て`, never `て形`.
 *   3. Labels pass through untouched. `Dictionary`, `past`, `adverbial` and the
 *      marker names are labels, not romaji form names; renaming them would be
 *      editing the library's data rather than transliterating it.
 *   4. The 24 form names the live table holds (live D1, 2026-09-17), each pinned
 *      to what it must become. The four that change — te ×17, ta ×17, nai ×17,
 *      te-form ×13 — are the values migration 0014 was verified to write, so
 *      the SQL and the TypeScript cannot drift apart unnoticed.
 *   5. The spellings of one name land together: `te`, `Te`, `te-form`,
 *      `te_form` and `tekei` are the same form written five ways.
 *   6. The import path applies both. `normalizeForms` converts the names and
 *      `normalizeEntry` resolves a `"pos": "suffix"` into pos+subtype — the
 *      wiring, which the pure function above cannot demonstrate on its own.
 *
 * Run with `npm run forms:guard`.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(REPO, "node_modules", ".cache", "form-names-guard");
const MODULE = path.join(REPO, "app", "lib", "form-names.ts");
const VOCAB = path.join(REPO, "app", "lib", "vocab.ts");

const { build } = createRequire(import.meta.url)("esbuild");

fs.mkdirSync(OUT_DIR, { recursive: true });
const bundle = path.join(OUT_DIR, "form-names.mjs");

await build({
  stdin: {
    contents: `export { kanaFormName, ROMAJI_FORM_STEMS } from ${JSON.stringify(MODULE)};
export { parseVocabJson } from ${JSON.stringify(VOCAB)};`,
    resolveDir: REPO,
    loader: "ts",
    sourcefile: "form-names-guard-entry.ts",
  },
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: bundle,
  logLevel: "warning",
});

const { kanaFormName, ROMAJI_FORM_STEMS, parseVocabJson } = await import(pathToFileURL(bundle).href);

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

const LATIN = /[A-Za-z]/;

console.log(`1. All ${ROMAJI_FORM_STEMS.length} stems convert, bare and -form`);
const badStems = [];
for (const stem of ROMAJI_FORM_STEMS) {
  const bare = kanaFormName(stem);
  if (LATIN.test(bare) || bare === stem) badStems.push(`${stem} → ${JSON.stringify(bare)} is still romaji`);
  const suffixed = kanaFormName(`${stem}-form`);
  if (!suffixed.endsWith("形")) {
    badStems.push(`${stem}-form → ${JSON.stringify(suffixed)} does not end in 形`);
  }
}
if (badStems.length === 0) ok("every stem converts to kana, and every -form ends in 形");
else badStems.forEach(fail);

console.log("2. Idempotent — the mapping runs on the read path and the write path");
for (const name of ["て", "て形", "ます", "ます形", "辞書形", "ない", "た", "Dictionary", "topic marker", ""]) {
  const once = kanaFormName(name);
  check(`a second pass over ${JSON.stringify(once)}`, kanaFormName(once), once);
}

console.log("3. Labels and unknown names are not renamed");
for (const label of [
  "Dictionary",
  "past",
  "adverbial",
  "negative",
  "topic marker",
  "usage",
  "na-adj form",
  "suru-verb",
  "form",
  "kei",
  "にほんご",
  "ます",
]) {
  check(label, kanaFormName(label), label);
}

console.log("4. The form names the live table holds");
for (const [name, expected] of [
  ["Dictionary", "Dictionary"],
  ["topic marker", "topic marker"],
  ["object marker", "object marker"],
  ["ます", "ます"],
  ["te", "て"],
  ["ta", "た"],
  ["nai", "ない"],
  ["past", "past"],
  ["adverbial", "adverbial"],
  ["te-form", "て形"],
  ["negative", "negative"],
  ["location marker", "location marker"],
  ["usage", "usage"],
  ["condition marker", "condition marker"],
  ["time marker", "time marker"],
  ["target marker", "target marker"],
  ["na-adj form", "na-adj form"],
  ["verb phrase", "verb phrase"],
  ["suru-verb", "suru-verb"],
  ["state marker", "state marker"],
  ["source marker", "source marker"],
  ["direction marker", "direction marker"],
  ["counter usage", "counter usage"],
  ["adjective", "adjective"],
]) {
  check(name, kanaFormName(name), expected);
}

console.log("5. The spellings of one name land together");
for (const [name, expected] of [
  ["te", "て"],
  ["Te", "て"],
  ["TE", "て"],
  ["  te  ", "て"],
  ["te-form", "て形"],
  ["te form", "て形"],
  ["te_form", "て形"],
  ["tekei", "て形"],
  ["ます-form", "ます形"],
  ["masu", "ます"],
  ["masu-form", "ます形"],
  ["masukei", "ます形"],
  ["jisho", "辞書形"],
  ["jishokei", "辞書形"],
  ["辞書形", "辞書形"],
  ["nai-form", "ない形"],
  ["ta-form", "た形"],
  ["ukemi", "受身形"],
  ["shiekiukemi", "使役受身形"],
  ["mizen", "未然形"],
  ["renyou", "連用形"],
]) {
  check(name, kanaFormName(name), expected);
}

console.log("6. The import path applies both — kana form names and the suffix subtype");
/** The one line an import turns into: `pos/subtype name=value …`. */
const imported = (entry) => {
  const parsed = parseVocabJson(JSON.stringify(entry));
  if (!parsed.ok) return `error: ${parsed.error}`;
  const [first] = parsed.entries;
  const forms = first.forms.map((form) => `${form.name}=${form.value}`).join(" ") || "-";
  return `${first.pos}/${first.subtype} ${forms}`;
};
for (const [label, entry, expected] of [
  [
    "pos \"suffix\"",
    { word: "～さん", kana: "～さん", pos: "suffix", meanings: ["Mr./Ms."], forms: [{ name: "te", value: "～さんて" }, { name: "ます-form", value: "～さんます" }] },
    "noun/suffix て=～さんて ます形=～さんます",
  ],
  ["subtype \"suffix\"", { word: "～人", kana: "～じん", pos: "noun", subtype: "suffix", meanings: ["…person"] }, "noun/suffix -"],
  ["subtype \"Suffix Noun\"", { word: "～人", kana: "～じん", pos: "noun", subtype: "Suffix Noun", meanings: ["…person"] }, "noun/suffix -"],
  ["a subtype outside the catalog is dropped", { word: "本", kana: "ほん", pos: "noun", subtype: "bogus", meanings: ["book"] }, "noun/null -"],
  [
    "forms as a name→value map",
    { word: "食べる", kana: "たべる", pos: "verb", meanings: ["to eat"], forms: { te: "食べて", "te-form": "食べて", ます: "食べます" } },
    "verb/null て=食べて て形=食べて ます=食べます",
  ],
]) {
  check(label, imported(entry), expected);
}

if (failures === 0) {
  console.log("\nall checks passed.");
} else {
  console.log(`\n${failures} check(s) failed.`);
}
process.exit(failures === 0 ? 0 : 1);
