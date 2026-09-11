import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

/**
 * The "ポイント!" (point!) callout used for a rule's pattern — a dashed box with
 * a small solid label overlapping its top-left border. Pass `children` to put
 * something other than static text inside it (e.g. an input on the edit page).
 */
export function RulePoint({
  pattern,
  children,
  className,
}: {
  pattern?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative rounded-[var(--radius)] border border-dashed border-muted-foreground/40 px-4 pb-4 pt-5",
        className
      )}
    >
      <span className="absolute -top-3 left-3 rounded-[4px] bg-foreground px-2 py-0.5 text-[11px] font-bold tracking-wide text-background">
        ポイント!
      </span>
      {children ?? <p className="text-sm font-semibold leading-relaxed">{pattern}</p>}
    </div>
  );
}
