import type { RuleDetail, WordDetail } from "~/lib/db.server";

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
  /** Small labels: part of speech, rule kind, tags. */
  badges: string[];
  examples: { japanese: string; translation: string | null }[];
}

export function wordToStudyCard(word: WordDetail): StudyCard {
  return {
    key: `w:${word.id}`,
    title: word.word,
    reading: word.kana,
    meanings: word.meanings.length > 0 ? word.meanings : ["—"],
    badges: word.pos ? [word.pos] : [],
    examples: word.examples.map((example) => ({
      japanese: example.japanese,
      translation: example.translation,
    })),
  };
}

export function ruleToStudyCard(rule: RuleDetail): StudyCard {
  // The first point is the rule's headline; more points still show on the page.
  const point = rule.points[0] ?? null;
  return {
    key: `r:${rule.id}`,
    title: point ?? rule.title,
    reading: point ? rule.title : null,
    meanings: [rule.explanation],
    badges: [rule.kind === "word" ? "word rule / form" : "sentence rule", ...rule.tags.map((tag) => `#${tag}`)],
    examples: rule.examples.map((example) => ({
      japanese: example.japanese,
      translation: example.english || null,
    })),
  };
}
