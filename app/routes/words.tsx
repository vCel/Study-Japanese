import { Link, useSearchParams } from "react-router";

import type { Route } from "./+types/words";
import { listWords } from "~/lib/db.server";
import { ownerContext } from "~/lib/owner.server";
import { isValidPos, PosFilter } from "~/components/pos-filter";
import { SearchBar } from "~/components/search-bar";
import { PageHeader } from "~/components/page-header";
import { Badge } from "~/components/lightswind/badge";
import { Card, CardContent } from "~/components/lightswind/card";
import { Pagination } from "~/components/lightswind/pagination";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Words · 日本語Vocab" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const search = url.searchParams.get("q")?.trim() || null;
  const posParam = url.searchParams.get("pos");
  const pos = isValidPos(posParam) ? posParam : null;
  const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1;
  const owner = context.get(ownerContext);
  const ownerId = owner?.ownerId ?? "anonymous";
  // Phrases live on their own page, so exclude them from the vocabulary list.
  return await listWords(ownerId, search, Number.isNaN(page) ? 1 : page, pos, "phrase");
}

export default function Words({ loaderData }: Route.ComponentProps) {
  const [searchParams] = useSearchParams();
  const search = searchParams.get("q");
  const pos = searchParams.get("pos") ?? "";
  const makePosHref = (nextPos: string) => {
    const qs = new URLSearchParams();
    if (search) qs.set("q", search);
    if (nextPos) qs.set("pos", nextPos);
    const s = qs.toString();
    return s ? `/words?${s}` : "/words";
  };

  return (
    <div className="w-full">
      <PageHeader
        title="Vocabulary"
        description={`${loaderData.total} word${loaderData.total === 1 ? "" : "s"} in the collection`}
      />

      {/* Word / kana search — same search bar as the word-lists home page */}
      <SearchBar
        paramName="q"
        placeholder="Search words or kana…"
        activeValue={search}
        clearTo={pos ? makePosHref("") : "/words"}
      />

      {/* Part-of-speech filter */}
      <PosFilter active={pos} makeHref={makePosHref} />

      {loaderData.items.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            No words found{search ? ` for “${search}”` : ""}. Try a different search.{" "}
            <Link to="/lists/new" className="text-primarylw underline">
              Add some words
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {loaderData.items.map((word) => (
            // The card itself is not a link: the word link is stretched over it
            // with `after:` so the list link in the footer stays clickable.
            <Card
              key={word.id}
              data-slot="word-card"
              className="relative flex h-full flex-col transition-transform hover:-translate-y-0.5"
            >
              <CardContent className="flex flex-1 flex-col p-5">
                <div className="min-w-0">
                  <h2 className="break-words text-2xl font-semibold">
                    <Link
                      to={`/words/${word.id}`}
                      className="after:absolute after:inset-0 after:content-['']"
                    >
                      {word.word}
                    </Link>
                  </h2>
                  {/* Kana reading directly under the word, same size as before, no badge. */}
                  <p className="mt-0.5 text-sm text-muted-foreground">{word.kana}</p>
                </div>

                {/*
                  The definition is muted and one step smaller than the word, so
                  a long English meaning no longer competes with the headword.
                */}
                {word.meaning && (
                  <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                    {word.meaning}
                  </p>
                )}

                {/* Footer: source list on the left, word type pinned bottom-right. */}
                <div className="mt-auto flex items-end justify-between gap-2 pt-4">
                  {word.listId && word.listTitle ? (
                    <Link
                      to={`/lists/${word.listId}`}
                      className="min-w-0 truncate text-xs text-muted-foreground transition-colors hover:text-primarylw hover:underline"
                    >
                      {word.listTitle}
                    </Link>
                  ) : (
                    <span />
                  )}
                  {word.pos && (
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {word.pos}
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="mt-8">
        <Pagination page={loaderData.page} pages={loaderData.pages} makeHref={() => "/words"} search={search} />
      </div>
    </div>
  );
}