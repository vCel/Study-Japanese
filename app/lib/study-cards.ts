import type { RuleDetail, WordDetail } from "~/lib/db.server";

/** Which side of a flashcard is shown first. */
export type CardSide = "title" | "meaning";

/**
 * Deal a card its leading side. Called while building the deck *on the server*,
 * so the side travels with the loader data and the hydrated client renders the
 * exact same markup — picking it during render would desync SSR and hydration.
 *
 * Only words and phrases are dealt at random: a rule always leads with its
 * point (see {@link ruleToStudyCards}), because a rule's explanation is the
 * answer and must stay hidden until the card is flipped.
 */
export function randomCardSide(): CardSide {
  return Math.random() < 0.5 ? "title" : "meaning";
}

/**
 * Shuffle a copy of `items` (Fisher–Yates).
 *
 * Shared by the session loader, which shuffles a flattened deck so no rule's
 * points arrive as one block, and by the session itself, where it re-orders the
 * queue for a restart.
 */
export function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * A single flashcard, independent of what it was built from. Word lists,
 * phrase lists and grammar rules all flatten into this shape so the same
 * `Flashcards` component can drill any of them.
 */
export interface StudyCard {
  /**
   * Stable local-stats key, namespaced by source and — for rules — by point:
   * `w:12` (a word) or `r:3:0` (point one of rule 3).
   */
  key: string;
  /** Big text on the question side. */
  title: string;
  /** Reading / pattern, shown on the answer side. */
  reading: string | null;
  /**
   * The kana to show on the *question* side, or null when there is nothing to
   * add: a rule (its `reading` is the rule's name, not a reading of the point
   * the card asks about) and a word already written in kana. Whether the front
   * is the Japanese side is the caller's business — on a meaning-side front
   * this is half the answer.
   */
  frontKana: string | null;
  /** Meaning lines (a rule's explanation for grammar cards). */
  meanings: string[];
  /** Which side this card leads with, decided once per session. */
  side: CardSide;
  examples: { japanese: string; translation: string | null }[];
}

export function wordToStudyCard(word: WordDetail, side: CardSide): StudyCard {
  return {
    key: `w:${word.id}`,
    title: word.word,
    reading: word.kana,
    // A headword that is already its own reading adds nothing but a repeat.
    frontKana: word.kana && word.kana !== word.word ? word.kana : null,
    meanings: word.meanings.length > 0 ? word.meanings : ["—"],
    side,
    examples: word.examples.map((example) => ({
      japanese: example.japanese,
      translation: example.translation,
    })),
  };
}

/**
 * Flatten a rule into **one card per ポイント (point!)**.
 *
 * A rule that lists three points is three separate things to learn, so it
 * becomes three cards instead of one card that shows point one and hides the
 * rest. The rule's title and explanation are repeated on every one of them —
 * each point is drilled in the context of the rule it belongs to.
 *
 * Every rule card leads with its point. Unlike a word, where either side can
 * be the question, a rule's explanation is always the answer: dealing a rule a
 * random side would sometimes open with the explanation, which gives the point
 * away before the learner has tried to recall it.
 */
export function ruleToStudyCards(rule: RuleDetail): StudyCard[] {
  const hasPoints = rule.points.length > 0;
  // A rule saved without any point still needs a question side; its title is
  // the only thing left to ask about.
  const points = hasPoints ? rule.points : [rule.title];
  return points.map((point, index) => ({
    key: `r:${rule.id}:${index}`,
    title: point,
    reading: hasPoints ? rule.title : null,
    // Never a reading of the point: a rule's title is its *name*, and the point
    // is what the card asks about.
    frontKana: null,
    meanings: [rule.explanation],
    side: "title",
    examples: rule.examples.map((example) => ({
      japanese: example.japanese,
      // The card's answer side is the *equivalent* — how the grammar is said in
      // English — falling back to the plain translation when there is none.
      translation: example.englishEquivalent || example.english || null,
    })),
  }));
}

/**
 * The id a card came from, decoded from its `w:12` / `r:3:0` key. Starring is
 * per-user and only known in the browser, so the study screen marks its cards
 * client-side from this.
 */
export function studyCardSource(card: StudyCard): { kind: "word" | "rule"; id: number } | null {
  const match = /^([wr]):(\d+)(?::\d+)?$/.exec(card.key);
  if (!match) return null;
  return { kind: match[1] === "w" ? "word" : "rule", id: Number(match[2]) };
}
