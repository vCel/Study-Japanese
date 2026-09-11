import type * as React from "react";

import { cn } from "~/lib/utils";

/** Inline success / error banner shared by all create & edit forms. */
export function FormMessage({
  tone,
  children,
}: {
  tone: "error" | "success";
  children: React.ReactNode;
}) {
  return (
    <p
      role={tone === "error" ? "alert" : undefined}
      className={cn(
        "rounded-[var(--radius)] border px-4 py-2 text-sm",
        tone === "error"
          ? "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400"
          : "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      )}
    >
      {children}
    </p>
  );
}
