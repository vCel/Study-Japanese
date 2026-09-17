/**
 * Conjugation-form names, in kana.
 *
 * A form name arrives in whatever spelling its author used, and the library
 * held a mix — `te` ×17, `ta` ×17, `nai` ×17, `te-form` ×13 beside `ます` ×17
 * (live D1, 2026-09-17). Every form name now passes through `kanaFormName` on
 * import, on read and on write, so the card shows one spelling whatever was
 * typed.
 *
 * The table is the romaji reading of the kana name. `form` and `kei` are
 * accepted as suffixes on any stem, because the same name is written `te-form`,
 * `tekei` and `て形`; a stem whose kana name already ends in 形 keeps it, so
 * `jisho` and `jishokei` both land on 辞書形.
 *
 * Names outside the table are returned unchanged, deliberately. `topic marker`,
 * `usage` and `Dictionary` are labels rather than romaji form names, and a
 * mapping that guessed at them would be renaming the library's data, not
 * transliterating it.
 */

/** Romaji reading of a form name → the kana form name. */
const ROMAJI_FORM_NAMES: Record<string, string> = {
  // 辞書形 / ます形
  jisho: "辞書形",
  masu: "ます",
  masen: "ません",
  // て形 / た形 / ない形
  te: "て",
  ta: "た",
  nai: "ない",
  nakatta: "なかった",
  katta: "かった",
  // 活用形 (学校文法)
  mizen: "未然形",
  renyou: "連用形",
  rentai: "連体形",
  shushi: "終止形",
  katei: "仮定形",
  meirei: "命令形",
  ishi: "意向形",
  ikou: "意向形",
  kanou: "可能形",
  ukemi: "受身形",
  shieki: "使役形",
  shiekiukemi: "使役受身形",
  jouken: "条件形",
  // その他
  ba: "ば",
  tara: "たら",
  tai: "たい",
  sugiru: "すぎる",
  teiru: "ている",
};

/** The suffixes the same name is written with: `te-form`, `tekei`, `て形`. */
const SUFFIXES = ["form", "kei"];

/** Strip everything that is not a letter or a digit: "te-form" → "teform". */
function collapse(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Both spellings of every stem, bare and suffixed. Derived rather than written
 * out, so a new row in the table above cannot arrive without its variants.
 */
const FORM_NAME_MAP: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const [romaji, kana] of Object.entries(ROMAJI_FORM_NAMES)) {
    const suffixed = kana.endsWith("形") ? kana : `${kana}形`;
    for (const stem of [romaji, kana]) {
      map[stem] = kana;
      for (const suffix of SUFFIXES) map[stem + suffix] = suffixed;
    }
  }
  return map;
})();

/**
 * The kana name for a form name, or the name unchanged when it is not a romaji
 * form name. Idempotent — a kana name maps to itself, which is what lets this
 * run on both the read and the write path without compounding.
 */
export function kanaFormName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";

  const key = collapse(trimmed);
  const direct = FORM_NAME_MAP[key];
  if (direct) return direct;

  for (const suffix of SUFFIXES) {
    if (!key.endsWith(suffix)) continue;
    const stem = FORM_NAME_MAP[key.slice(0, -suffix.length)];
    if (stem) return stem.endsWith("形") ? stem : `${stem}形`;
  }

  return trimmed;
}

/** The romaji stems the table knows — read by `scripts/form-names-guard.mjs`. */
export const ROMAJI_FORM_STEMS = Object.keys(ROMAJI_FORM_NAMES);
