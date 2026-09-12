"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { Star } from "lucide-react";

import { api } from "../../convex/_generated/api";
import { Tooltip } from "~/components/lightswind/tooltip";
import { cn } from "~/lib/utils";

/**
 * The ★ "important / priority" toggle shown on the cards *inside a list* (word
 * lists, which cover phrases too) and on the rules list.
 *
 * Stars are per-user: they are stored in Convex keyed to the signed-in account
 * (see `convex/stars.ts`), so a star follows the user across devices and never
 * affects anyone else's view. The button flips optimistically while the
 * mutation is in flight, then settles on whatever the database actually holds.
 *
 * Mount it only when Convex is configured, and inside `SignedInOnly`: starring
 * is a signed-in write.
 */
export function ImportantStar({
  kind,
  id,
  className,
  label,
}: {
  kind: "word" | "rule";
  /** Id of the word (or phrase, or rule) to star. */
  id: number;
  className?: string;
  /** Accessible name, e.g. "Japanese language". */
  label: string;
}) {
  const stars = useQuery(api.stars.mine);
  const toggle = useMutation(api.stars.toggle);

  // Set while the mutation is in flight — treat it as the new value so the
  // icon responds immediately.
  const [pending, setPending] = React.useState<boolean | null>(null);

  const stored = (kind === "rule" ? stars?.rules : stars?.words)?.includes(id) ?? false;
  const value = pending ?? stored;

  const onClick = async () => {
    const next = !value;
    setPending(next);
    try {
      await toggle({ kind, itemId: id, important: next });
    } catch {
      // Leave the star as it was — clearing `pending` falls back to `stored`.
    } finally {
      setPending(null);
    }
  };

  return (
    <Tooltip content={value ? "Important — click to unstar" : "Mark as important (priority)"}>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={value}
        aria-label={value ? `${label} is important — remove the star` : `Mark ${label} as important`}
        className={cn(
          "inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border transition-colors",
          value
            ? "border-amber-400/60 bg-amber-400/15 text-amber-500"
            : "border-border text-muted-foreground hover:border-amber-400/50 hover:text-amber-500",
          className
        )}
      >
        <Star className={cn("h-4 w-4", value && "fill-current")} />
      </button>
    </Tooltip>
  );
}
