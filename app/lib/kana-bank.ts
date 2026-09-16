/**
 * The kana keyboard shown under a "Type the answer" question.
 *
 * The input box has always told the learner "kana or romaji both count", and
 * nothing in the app converts romaji — so that promise only ever held for
 * someone who already knew the romaji. A bank of tiles is the other half of it:
 * the learner picks the kana they recognise instead of producing them.
 *
 * Pure, and dependent only on `furigana`, so the shape of the bank can be
 * reasoned about on its own. What the tiles are *worth* is decided elsewhere —
 * `quiz-runner.tsx` only offers a bank whose reading the grader would accept.
 */

import { parseFurigana, stripEmphasis } from "./furigana";

/** The kana a bank can spell, and the tiles it spells them with. */
export interface KanaBank {
  /** The reading as plain kana — what tapping the right tiles produces. */
  reading: string;
  /** The shuffled tiles: the reading's own kana, among decoys. */
  tiles: string[];
}

/**
 * Beyond this the bank stops being a keyboard and becomes a wall of tiles. The
 * longest readings in the library sit well under it, so this only ever fires on
 * a sentence the model decided to make the answer.
 */
const MAX_READING = 14;

/** How many decoy kana to mix in, so the bank reads as a keyboard. */
const DECOYS = 10;

/** The gojūon — the kana a learner at this level is expected to recognise. */
const GOJUON =
  "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん";

/** Kana only: hiragana and katakana, including ー and the small forms. */
const KANA_ONLY = /^[\u3041-\u309f\u30a0-\u30ff]+$/;

/** Fisher-Yates, so the bank's order is never a hint. */
function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * The kana bank for an answer, or null when there is nothing to build.
 *
 * An annotated answer gives up its annotation: 図書館《としょかん》 reads
 * としょかん, which is the string the learner actually has to produce. A bare
 * kana answer is already its own reading. Everything else — an English gloss, a
 * kanji answer the model forgot to annotate, a whole sentence — has no reading
 * to offer, and gets no bank rather than a misleading one.
 *
 * The decoys are drawn from the gojūon minus the reading's own kana, so a kana
 * the answer repeats gets one tile per occurrence and never a spare.
 */
export function kanaBank(answer: string): KanaBank | null {
  const reading = parseFurigana(stripEmphasis(answer))
    .map((segment) => segment.reading ?? segment.text)
    .join("");

  if (reading.length < 1 || reading.length > MAX_READING) return null;
  if (!KANA_ONLY.test(reading)) return null;

  const letters = [...reading];
  const decoys = shuffle([...GOJUON].filter((kana) => !letters.includes(kana))).slice(0, DECOYS);

  return { reading, tiles: shuffle([...letters, ...decoys]) };
}
