import { Link } from "react-router";

import { cn } from "~/lib/utils";

/**
 * Lightswind UI — Pagination
 * https://lightswind.com/components/pagination
 */
export function Pagination({
  page,
  pages,
  makeHref,
  search,
}: {
  page: number;
  pages: number;
  makeHref: (page: number) => string;
  search?: string | null;
}) {
  if (pages <= 1) return null;

  const windowSize = 2;
  const pageNumbers: number[] = [];
  for (let p = Math.max(1, page - windowSize); p <= Math.min(pages, page + windowSize); p++) {
    pageNumbers.push(p);
  }

  const href = (target: number) => {
    // `makeHref` may already carry a query string (filtered pages).
    const [path, existing] = makeHref(1).split("?");
    const qs = new URLSearchParams(existing ?? "");
    if (search) qs.set("q", search);
    if (target > 1) qs.set("page", String(target));
    const s = qs.toString();
    return s ? `${path}?${s}` : path;
  };

  const arrowClass =
    "flex h-9 items-center rounded-[var(--radius)] border border-border px-3 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 hover:bg-muted";

  return (
    <div className="flex items-center justify-center gap-1.5">
      {page > 1 ? (
        <Link to={href(page - 1)} className={arrowClass}>
          ← Prev
        </Link>
      ) : (
        <span className={cn(arrowClass, "cursor-not-allowed opacity-40")}>← Prev</span>
      )}
      {pageNumbers.map((p) => (
        <Link
          key={p}
          to={href(p)}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-[var(--radius)] text-sm font-medium transition-colors",
            p === page
              ? "bg-primarylw text-white shadow"
              : "border border-border hover:bg-muted"
          )}
        >
          {p}
        </Link>
      ))}
      {page < pages ? (
        <Link to={href(page + 1)} className={arrowClass}>
          Next →
        </Link>
      ) : (
        <span className={cn(arrowClass, "cursor-not-allowed opacity-40")}>Next →</span>
      )}
    </div>
  );
}