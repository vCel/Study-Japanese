import * as React from "react";
import { Link } from "react-router";
import { Search, Tags, X } from "lucide-react";

import type { TagInfo } from "~/lib/db.server";

/**
 * Shared search bar used on the word-lists home page (tag search) and the
 * words page (word/kana search). Pill input with the search button embedded
 * inside it; optionally shows a "Tags" button that opens a popover with every
 * tag as a filter chip.
 */
export function SearchBar({
  paramName,
  placeholder,
  activeValue,
  clearTo,
  tags,
  tagHref,
  selectedTag,
}: {
  /** Query-string parameter name: "tag" on the home page, "q" on /words. */
  paramName: string;
  placeholder: string;
  /**
   * The value shown in the text input. Leave it `null` on a page that filters
   * by tag: the tag is shown as a chip by `ActiveTagFilter` instead of being
   * dumped into the search box.
   */
  activeValue: string | null;
  /** Where the ✕ (clear) link points. */
  clearTo: string;
  /** When provided, shows the Tags popover button (word-lists home only). */
  tags?: TagInfo[];
  /** Builds a tag chip's href; defaults to the word-lists home page. */
  tagHref?: (tag: string) => string;
  /** The tag currently filtering the list, if any — shown as the active chip. */
  selectedTag?: string | null;
}) {
  const [open, setOpen] = React.useState(false);
  const popoverRef = React.useRef<HTMLDivElement>(null);
  /** The active filter shown in the popover, whichever kind it is. */
  const chip = selectedTag ?? activeValue;

  // Close the popover when clicking anywhere outside of it.
  React.useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative mb-4 flex w-full items-center gap-2">
      <form method="get" className="relative flex w-full items-center">
        <input
          name={paramName}
          defaultValue={activeValue ?? ""}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-11 w-full rounded-full border border-border bg-card py-2 pl-5 pr-32 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primarylw/50"
        />
        {activeValue && (
          <Link
            to={clearTo}
            aria-label="Clear search"
            className="absolute right-[7.2rem] cursor-pointer rounded-full p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </Link>
        )}
        <button
          type="submit"
          className="absolute right-1.5 inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-primarylw px-5 text-sm font-medium text-white transition-colors hover:bg-primarylw-2"
        >
          <Search className="h-4 w-4" /> Search
        </button>
      </form>

      {tags && (
        <div ref={popoverRef} className="relative">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-haspopup="true"
            className={
              "inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-5 text-sm font-medium transition-colors " +
              (open || chip
                ? "border-primarylw/50 bg-primarylw/15 text-primarylw"
                : "border-border hover:bg-muted")
            }
          >
            <Tags className="h-4 w-4" /> Tags
          </button>

          {open && (
            <div
              data-slot="tag-popover"
              className="absolute right-0 top-13 z-40 w-72 rounded-[var(--radius)] border border-border bg-card p-4 shadow-xl"
            >
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold">Filter by tag</p>
                <button
                  type="button"
                  className="cursor-pointer rounded p-1 text-muted-foreground hover:bg-muted"
                  aria-label="Close tag filter"
                  onClick={() => setOpen(false)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {chip && (
                <Link
                  to={clearTo}
                  onClick={() => setOpen(false)}
                  className="mb-2 inline-flex items-center gap-1 rounded-full bg-primarylw px-3 py-1 text-xs font-semibold text-white"
                >
                  {chip} ✕
                </Link>
              )}
              {tags.length === 0 ? (
                <p className="text-xs text-muted-foreground">No tags yet.</p>
              ) : (
                <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
                  {tags
                    .filter((t) => t.name !== chip)
                    .map((t) => (
                      <Link
                        key={t.name}
                        to={
                          tagHref
                            ? tagHref(t.name)
                            : `/?tag=${encodeURIComponent(t.name)}`
                        }
                        onClick={() => setOpen(false)}
                        className="rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primarylw/40 hover:text-foreground"
                      >
                        #{t.name} <span className="opacity-60">{t.listCount}</span>
                      </Link>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The chip shown under a search bar while a tag filter is applied — every list
 * page uses it, so the active tag never lands in the search input itself.
 */
export function ActiveTagFilter({ tag, clearTo }: { tag: string; clearTo: string }) {
  return (
    <div className="mb-4">
      <Link
        to={clearTo}
        className="inline-flex items-center gap-1 rounded-full bg-primarylw px-3 py-1 text-xs font-semibold text-white"
      >
        #{tag} ✕
      </Link>
    </div>
  );
}