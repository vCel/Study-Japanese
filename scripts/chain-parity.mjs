#!/usr/bin/env node
/**
 * Checks that `CHAIN_LABELS` in `app/components/quiz-runner.tsx` still lines up
 * with `MODEL_CHAIN` in `app/lib/ai.server.ts`.
 *
 * The two lists are hand-mirrored and positional: the server's `attempt` event
 * carries an *index* into `MODEL_CHAIN`, and the loading bar reads
 * `CHAIN_LABELS[index]`. A reorder on the server that the client does not follow
 * therefore mislabels every row after it — silently, and worse than falling back
 * to the raw id, because a real attempt is shown under the wrong model's name.
 *
 * Two checks:
 *
 *   1. Count parity — the obvious one.
 *   2. Label↔model correspondence — each row's own label must be its *best*
 *      match among all labels. This is the check that catches a **swap**, which
 *      a count check cannot see, because a swap moves no rows.
 *
 * Check 2 is a heuristic, not a proof. It scores token overlap between the model
 * id and each label, so it catches gross mismatches (a swapped, stale or
 * copy-pasted label). It says nothing about a label that is merely worded
 * badly — "OpenCode Muse Spark 1.3" and "Muse Spark 1.3 (OpenCode)" score the
 * same, and both are fine.
 *
 * The **provider breaks ties**, because a model id can name two rows. Meta
 * serves `muse-spark-1.3-contributor` while OpenCode Zen serves `muse-spark-1.3`;
 * with `contributor` treated as noise both reduce to the same three tokens, so
 * coverage alone scores both labels 1.00 and the check fails on a correct pair.
 * A label that names its row's provider wins that tie. Nothing else changes:
 * labels like "Xiaomi MiMo V2.5" that omit the provider still score on coverage
 * alone.
 *
 * Usage:  node scripts/chain-parity.mjs [--self-test]
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Tokens that carry no model identity, so they must not be allowed to make two
 * unrelated labels look alike. `contributor` is Meta's pricing tier and `free`
 * is a promo flag — both appear on ids whose *identity* is the name+version.
 */
const NOISE = new Set(["free", "contributor", "batch", "latest", "preview", "it"]);

/** Lowercased identity tokens: vendor path prefix and promo suffixes dropped. */
function tokens(text) {
  return text
    .toLowerCase()
    .replace(/^[^/]*\//, "") // `qwen/qwen3.8-27b` → `qwen3.8-27b`
    .split(/[^a-z0-9.]+/)
    .filter((token) => token && !NOISE.has(token));
}

/** How much of the model id the label accounts for, in 0..1. */
function score(modelTokens, label, provider) {
  const labelTokens = new Set(tokens(label));
  const shared = modelTokens.filter((token) => labelTokens.has(token)).length;
  return {
    coverage: modelTokens.length === 0 ? 0 : shared / modelTokens.length,
    // Only ever a tie-break, never part of the coverage: most labels here do not
    // name their provider ("Xiaomi MiMo V2.5"), so requiring it would fail rows
    // that are perfectly correct.
    provider: labelTokens.has(provider) ? 1 : 0,
  };
}

/**
 * Pull one `{ model, provider }` per uncommented row out of `MODEL_CHAIN`.
 *
 * Matches `model:` then the *next* `provider:`, which is the same row's because
 * every row declares `model` first. A row written the other way round would
 * silently pair across rows, so the counts are asserted instead.
 */
function readModelChain(source) {
  const start = source.indexOf("export const MODEL_CHAIN");
  const end = source.indexOf("\n];", start);
  if (start === -1 || end === -1) throw new Error("MODEL_CHAIN not found in ai.server.ts");

  const body = source
    .slice(start, end)
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

  const rows = [...body.matchAll(/model:\s*"([^"]+)"[\s\S]*?provider:\s*"([^"]+)"/g)].map(
    (match) => ({ model: match[1], provider: match[2] })
  );

  const models = [...body.matchAll(/model:\s*"/g)].length;
  const providers = [...body.matchAll(/provider:\s*"/g)].length;
  if (rows.length !== models || rows.length !== providers) {
    throw new Error(
      `MODEL_CHAIN parse is ambiguous: ${models} model / ${providers} provider fields but ` +
        `${rows.length} rows paired. Every row must declare \`model\` before \`provider\`.`
    );
  }
  return rows;
}

/** Pull the string literals out of `CHAIN_LABELS`. */
function readChainLabels(source) {
  const start = source.indexOf("const CHAIN_LABELS = [");
  const end = source.indexOf("\n];", start);
  if (start === -1 || end === -1) throw new Error("CHAIN_LABELS not found in quiz-runner.tsx");
  return source
    .slice(start, end)
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .flatMap((line) => [...line.matchAll(/"([^"]+)"/g)].map((match) => match[1]));
}

function check(rows, labels) {
  const problems = [];

  if (rows.length !== labels.length) {
    problems.push(
      `count: ${rows.length} rows in MODEL_CHAIN but ${labels.length} entries in CHAIN_LABELS`
    );
  }

  const results = [];
  for (let index = 0; index < rows.length; index++) {
    const { model, provider } = rows[index];
    const modelTokens = tokens(model);
    const scored = labels.map((label, at) => ({ at, ...score(modelTokens, label, provider) }));
    // Rank by coverage, then by whether the label names the provider, then by
    // position — so a genuine tie resolves to the earlier label and the row
    // fails rather than passing by luck. The row's own label must be the
    // outright winner: a tie means the two labels are interchangeable to this
    // check, which is exactly the ambiguity that mislabels a loading bar.
    const ranked = [...scored].sort(
      (a, b) => b.coverage - a.coverage || b.provider - a.provider || a.at - b.at
    );
    const own = scored[index] ?? { coverage: 0, provider: 0 };
    const winner = ranked[0];
    const ok = own.coverage > 0 && winner.at === index;

    results.push({ index, model, provider, label: labels[index], own: own.coverage, ok });
    if (!ok) {
      problems.push(
        `row ${index}: \`${model}\` (${provider}) is labelled "${labels[index]}" (coverage ` +
          `${own.coverage.toFixed(2)}), but "${labels[winner.at] ?? "?"}" fits better ` +
          `(${winner.coverage.toFixed(2)}${winner.provider ? " + provider" : ""})`
      );
    }
  }

  return { rows: results, problems };
}

function report(models, labels, { quiet = false } = {}) {
  const { rows, problems } = check(models, labels);

  if (!quiet) {
    console.log(`MODEL_CHAIN ${models.length} rows · CHAIN_LABELS ${labels.length} entries\n`);
    for (const row of rows) {
      const mark = row.ok ? "ok  " : "FAIL";
      console.log(
        `${mark} ${String(row.index).padStart(2)}  ${row.model.padEnd(44)} ${row.label ?? "<missing>"}`
      );
    }
    console.log();
  }

  if (problems.length > 0) {
    console.error("chain parity FAILED:");
    for (const problem of problems) console.error(`  - ${problem}`);
    return false;
  }

  if (!quiet) console.log("chain parity ok — every label matches its own model.");
  return true;
}

const models = readModelChain(readFileSync(join(ROOT, "app/lib/ai.server.ts"), "utf8"));
const labels = readChainLabels(readFileSync(join(ROOT, "app/components/quiz-runner.tsx"), "utf8"));

if (process.argv.includes("--self-test")) {
  // A checker that fails everything would "catch" every swap, so the control
  // case — the real list must pass — is what makes the rest meaningful.
  const cases = [
    ["control: the real list passes", () => {}],
    ["an adjacent swap is caught", (list) => ([list[0], list[1]] = [list[1], list[0]])],
    // Rows 0 and 2 are the reason the provider tie-break exists: `muse-spark-1.3`
    // and `muse-spark-1.3-contributor` reduce to the same tokens, so coverage
    // alone cannot separate them.
    ["a cross-provider swap is caught", (list) => ([list[0], list[2]] = [list[2], list[0]])],
  ];

  let allOk = true;
  for (const [name, mutate] of cases) {
    const list = [...labels];
    mutate(list);
    const passed = report(models, list, { quiet: true });
    const expected = name.startsWith("control");
    const ok = passed === expected;
    if (!ok) allOk = false;
    console.log(`${ok ? "ok  " : "FAIL"} self-test: ${name}.`);
  }
  process.exit(allOk ? 0 : 1);
}

process.exit(report(models, labels) ? 0 : 1);
