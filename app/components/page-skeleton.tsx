/**
 * Generic page skeleton shown while a client-side navigation waits for its
 * loader data. It mirrors the shape every list page shares (title, subtitle,
 * search bar, card grid) so the swap to real content does not jump, and it is
 * aria-hidden-ish (`aria-busy` + a sr-only "Loading") so screen readers know
 * something is in flight rather than reading placeholder boxes.
 */
export function PageSkeleton() {
  return (
    <div className="w-full" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      <div className="mb-6 space-y-3">
        <div className="h-9 w-56 animate-pulse rounded-[var(--radius)] bg-muted" />
        <div className="h-5 w-80 max-w-full animate-pulse rounded-[var(--radius)] bg-muted/70" />
      </div>

      <div className="mb-6 h-12 w-full animate-pulse rounded-full bg-muted/60" />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div
            key={index}
            className="rounded-[var(--radius)] border border-border/70 p-5"
            style={{ animationDelay: `${index * 40}ms` }}
          >
            <div className="h-7 w-1/2 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-4 w-1/3 animate-pulse rounded bg-muted/70" />
            <div className="mt-4 h-4 w-full animate-pulse rounded bg-muted/60" />
            <div className="mt-2 h-4 w-2/3 animate-pulse rounded bg-muted/60" />
          </div>
        ))}
      </div>
    </div>
  );
}
