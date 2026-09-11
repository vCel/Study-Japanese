import { Link } from "react-router";

import { cn } from "~/lib/utils";

/** Canonical part-of-speech values used across the app. */
export const POS_VALUES = ["noun", "verb", "adjective", "adverb", "other"] as const;

export function isValidPos(value: string | null | undefined): boolean {
  return !!value && (POS_VALUES as readonly string[]).includes(value);
}

/** POS filter pills (All + each type). Phrases have their own page. */
export const POS_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "noun", label: "Nouns" },
  { value: "verb", label: "Verbs" },
  { value: "adjective", label: "Adjectives" },
  { value: "adverb", label: "Adverbs" },
];

/**
 * Part-of-speech filter pills (All / Nouns / Verbs / Adjectives / Adverbs).
 * `makeHref` builds the target URL for each option, preserving any other
 * query params of the current page.
 */
export function PosFilter({
  active,
  makeHref,
}: {
  active: string;
  makeHref: (pos: string) => string;
}) {
  return (
    <div className="mb-6 flex flex-wrap gap-1.5">
      {POS_FILTERS.map((filter) => {
        const isActive = active === filter.value;
        return (
          <Link
            key={filter.value || "all"}
            to={makeHref(filter.value)}
            aria-current={isActive ? "true" : undefined}
            className={cn(
              "rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
              isActive
                ? "border-primarylw bg-primarylw/15 text-primarylw"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {filter.label}
          </Link>
        );
      })}
    </div>
  );
}