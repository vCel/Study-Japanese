import type { RuleDetail, WordDetail } from "~/lib/db.server";

/** Which side of a flashcard is shown first. */
export type CardSide = "title" | "meaning";

/**
 * Deal a card its leading side. Called while building the deck *on the server*,
 * so the side travels with the loader data and the hydrated client renders the
 * exact same markup — picking it during render would desync SSR and hydration.
 */
export function randomCardSide(): CardSide {
  return Math.random() < 0.5 ? "title" : "meaning";
}

/**
 * A single flashcard, independent of what it was built from. Word lists,
 * phrase lists and grammar rules all flatten into this shape so the same
 * `Flashcards` component can drill any of them.
 */
export interface StudyCard {
  /** Stable local-stats key, namespaced by source (`w:12`, `r:3`). */
  key: string;
  /** Big text on the question side. */
  title: string;
  /** Reading / pattern, shown on the answer side. */
  reading: string | null;
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
    meanings: word.meanings.length > 0 ? word.meanings : ["—"],
    side,
    examples: word.examples.map((example) => ({
      japanese: example.japanese,
      translation: example.translation,
    })),
  };
}

export function ruleToStudyCard(rule: RuleDetail, side: CardSide): StudyCard {
  // The first point is the rule's headline; more points still show on the page.
  const point = rule.points[0] ?? null;
  return {
    key: `r:${rule.id}`,
    title: point ?? rule.title,
    reading: point ? rule.title : null,
    meanings: [rule.explanation],
    side,
    examples: rule.examples.map((example) => ({
      japanese: example.japanese,
      // The card's answer side is the *equivalent* — how the grammar is said in
      // English — falling back to the plain translation when there is none.
      translation: example.englishEquivalent || example.english || null,
    })),
  };
}

/**
 * The id a card came from, decoded from its `w:12` / `r:3` key. Starring is
 * per-user and only known in the browser, so the study screen marks its cards
 * client-side from this.
 */
export function studyCardSource(card: StudyCard): { kind: "word" | "rule"; id: number } | null {
  const match = /^([wr]):(\d+)$/.exec(card.key);
  if (!match) return null;
  return { kind: match[1] === "w" ? "word" : "rule", id: Number(match[2]) };
}
