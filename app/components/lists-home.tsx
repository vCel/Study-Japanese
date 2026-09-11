import * as React from "react";
import { Link } from "react-router";
import { CheckSquare, GraduationCap, ListTree, Square, X } from "lucide-react";

import type { WordListSummary } from "~/lib/db.server";
import { Badge } from "~/components/lightswind/badge";
import { Card, CardContent } from "~/components/lightswind/card";

/**
 * Word-list grid on the home page: per-list study buttons, multi-select
 * checkboxes to combine lists into a single study session, and tag links.
 */
export function ListsHome({
  lists,
  selectedTag,
  selectedPos,
  page,
  pages,
  total,
  basePath = "/",
  unit = "words",
}: {
  lists: WordListSummary[];
  selectedTag: string | null;
  selectedPos: string | null;
  page: number;
  pages: number;
  total: number;
  /** Root path used for tag links and pagination ("/" for word lists, "/phrases/lists" for phrase lists). */
  basePath?: string;
  /** Noun used for the per-list count badge. */
  unit?: string;
}) {
  const [selected, setSelected] = React.useState<number[]>([]);

  const toggle = (id: number) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  };

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {lists.map((list) => {
          const isSelected = selected.includes(list.id);
          return (
            <Card
              key={list.id}
              className={
                "relative h-full transition-transform hover:-translate-y-0.5 " +
                (isSelected ? "border-primarylw/60 ring-1 ring-primarylw/40" : "")
              }
            >
              <CardContent className="p-6">
                <label
                  className="absolute right-4 top-4 z-10 cursor-pointer"
                  aria-label={`Select ${list.title} for combined study`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={isSelected}
                    onChange={() => toggle(list.id)}
                  />
                  {isSelected ? (
                    <CheckSquare className="h-5 w-5 text-primarylw" />
                  ) : (
                    <Square className="h-5 w-5 text-muted-foreground/60 hover:text-foreground" />
                  )}
                </label>

                <Link to={`/lists/${list.id}`} className="block">
                  <h2 className="mb-1 text-xl font-semibold hover:text-primarylw">{list.title}</h2>
                  {list.description && (
                    <p className="line-clamp-2 text-sm text-muted-foreground">{list.description}</p>
                  )}
                </Link>

                {list.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {list.tags.map((t) => (
                      <Link
                        key={t}
                        to={`${basePath}?tag=${encodeURIComponent(t)}`}
                        className="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primarylw/40 hover:text-foreground"
                      >
                        #{t}
                      </Link>
                    ))}
                  </div>
                )}

                <div className="mt-4 flex items-center justify-between">
                  <Badge variant="secondary">
                    <ListTree className="mr-1 h-3 w-3" /> {list.wordCount} {unit}
                  </Badge>
                  {list.wordCount > 0 && (
                    <Link
                      to={`/study/session?lists=${list.id}`}
                      className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primarylw px-6 text-sm font-medium text-white transition-colors hover:bg-primarylw-2"
                    >
                      <GraduationCap className="h-4 w-4" /> Study
                    </Link>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <SelectionBar selected={selected} clear={() => setSelected([])} />
      <Pager
        selectedTag={selectedTag}
        selectedPos={selectedPos}
        page={page}
        pages={pages}
        total={total}
        basePath={basePath}
      />
    </div>
  );
}

/** Floating bar shown while lists are selected, offering a combined study session. */
function SelectionBar({ selected, clear }: { selected: number[]; clear: () => void }) {
  if (selected.length === 0) return null;
  return (
    <div className="fixed bottom-6 left-1/2 z-50 flex w-[min(92vw,30rem)] -translate-x-1/2 items-center justify-between gap-3 rounded-[var(--radius)] border border-primarylw/40 bg-card p-4 shadow-xl">
      <div className="text-sm">
        <p className="font-semibold">
          {selected.length} list{selected.length === 1 ? "" : "s"} selected
        </p>
        <p className="text-xs text-muted-foreground">Combine them into one study session</p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="inline-flex h-9 items-center gap-1 rounded-[var(--radius)] px-3 text-sm text-muted-foreground hover:bg-muted"
          onClick={clear}
        >
          <X className="h-4 w-4" /> Clear
        </button>
        <Link
          to={`/study/session?lists=${selected.join(",")}`}
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primarylw px-6 text-sm font-medium text-white transition-colors hover:bg-primarylw-2"
        >
          <GraduationCap className="h-4 w-4" /> Study
        </Link>
      </div>
    </div>
  );
}

/** Tag-aware pager for the home page. */
function Pager({
  selectedTag,
  selectedPos,
  page,
  pages,
  total,
  basePath,
}: {
  selectedTag: string | null;
  selectedPos: string | null;
  page: number;
  pages: number;
  total: number;
  basePath: string;
}) {
  if (pages <= 1) return null;
  const href = (target: number) => {
    const qs = new URLSearchParams();
    if (selectedTag) qs.set("tag", selectedTag);
    if (selectedPos) qs.set("pos", selectedPos);
    if (target > 1) qs.set("page", String(target));
    const s = qs.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const cell = "rounded-full border border-border px-5 py-1.5 hover:bg-muted";
  return (
    <div className="mt-8 flex items-center justify-center gap-3 text-sm">
      {page > 1 ? (
        <Link to={href(page - 1)} className={cell}>
          ← Prev
        </Link>
      ) : (
        <span className={cell + " opacity-40"}>← Prev</span>
      )}
      <span className="text-muted-foreground">
        Page {page} of {pages} · {total} lists
      </span>
      {page < pages ? (
        <Link to={href(page + 1)} className={cell}>
          Next →
        </Link>
      ) : (
        <span className={cell + " opacity-40"}>Next →</span>
      )}
    </div>
  );
}