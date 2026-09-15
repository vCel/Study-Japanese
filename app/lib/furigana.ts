/**
 * Ruby text — the reading a learner needs, written above the kanji.
 *
 * The quiz is written for someone who cannot yet read kanji, so the generation
 * prompt asks the model to annotate every Japanese field. The wire notation is
 * `漢字《かんじ》`: the traditional Japanese ruby form, and — more importantly
 * here — an unambiguous one. `《》` does not occur in ordinary prose, so every
 * match is an annotation and never a piece of the sentence. Parentheses, the
 * obvious alternative, would be indistinguishable from a gloss: stripping
 * `What does 食べる (to eat) mean?` would eat the English.
 *
 * Two shapes of string therefore flow through the app, and mixing them up is
 * the bug this module exists to prevent:
 *
 * - **annotated** — `学生《がくせい》です`, what the model returns and what the
 *   UI renders. Kept verbatim on `QuizQuestion`.
 * - **plain** — `学生です`, what the user types and what the grader compares.
 *
 * So every comparison normalises through {@link stripFurigana} first. Without
 * that, `question.answer` arrives as `学生《がくせい》`, the user types `学生`,
 * and every kanji answer is silently marked wrong.
 */

/**
 * What a reading may attach to: CJK ideographs, the two iteration marks, and
 * the small ヶ that turns up in place names and counters.
 *
 * Written as escapes rather than literals so the ranges stay readable — and so
 * an editor that normalises Unicode cannot quietly widen them.
 */
const KANJI_CLASS = "\\u3005\\u3006\\u30f6\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff";

/** `漢字《かんじ》` — a run of kanji, then its reading in ruby brackets. */
const PAIR_SOURCE = `([${KANJI_CLASS}]+)《([^》]+)》`;

/** A `《…》` whose base was not kanji — the model annotating kana anyway. */
const LONE_READING_SOURCE = "《[^》]*》";

/**
 * Fresh patterns per call rather than shared module-level ones.
 *
 * A `/g` regex carries `lastIndex` between uses, so a shared instance makes
 * every helper depend on what ran before it — and `parseFurigana` walks a
 * string in a loop, which is exactly the case that gets it wrong. Constructing
 * them is cheap; the class of bug they avoid is not.
 */
function pairPattern(): RegExp {
  return new RegExp(PAIR_SOURCE, "g");
}

/** True when `text` carries at least one annotation. */
export function hasFurigana(text: string): boolean {
  return new RegExp(PAIR_SOURCE).test(text);
}

/** Whether any of these values carries an annotation. */
export function anyHasFurigana(values: (string | null | undefined)[]): boolean {
  return values.some((value) => typeof value === "string" && hasFurigana(value));
}

/**
 * The plain text, with every reading removed — `学生《がくせい》です` → `学生です`.
 *
 * This is the form to compare against, never to display: it is what the user
 * types.
 */
export function stripFurigana(text: string): string {
  return text.replace(pairPattern(), "$1").replace(new RegExp(LONE_READING_SOURCE, "g"), "");
}

/** One run of text, and the reading the model gave it if there was one. */
export interface FuriganaSegment {
  /** The text as written — a kanji run, or the kana and punctuation between them. */
  text: string;
  /** The reading, present only where the model annotated this run. */
  reading?: string;
}

/**
 * Split annotated text into its runs, so a renderer can wrap the annotated ones
 * in `<ruby>` and leave the rest alone.
 *
 * Unannotated text is returned as a single segment rather than dropped, so a
 * caller that always goes through here renders identically whether or not the
 * model annotated anything.
 */
export function parseFurigana(text: string): FuriganaSegment[] {
  const segments: FuriganaSegment[] = [];
  const pattern = pairPattern();
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    // The plain text between two annotations — kana, punctuation, English.
    if (match.index > cursor) segments.push({ text: text.slice(cursor, match.index) });
    segments.push({ text: match[1], reading: match[2] });
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}
