import { Link, useSearchParams } from "react-router";
import { MessageSquareQuote, Plus } from "lucide-react";

import type { Route } from "./+types/phrases";
import { listWords } from "~/lib/db.server";
import { ownerContext } from "~/lib/owner.server";
import { PageHeader } from "~/components/page-header";
import { SearchBar } from "~/components/search-bar";
import { Badge } from "~/components/lightswind/badge";
import { Card, CardContent } from "~/components/lightswind/card";
import { Pagination } from "~/components/lightswind/pagination";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Phrases · 日本語Vocab" },
    { name: "description", content: "Everyday Japanese phrases and set expressions." },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const search = url.searchParams.get("q")?.trim() || null;
  const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1;
  const owner = context.get(ownerContext);
  const ownerId = owner?.ownerId ?? "anonymous";
  return await listWords(ownerId, search, Number.isNaN(page) ? 1 : page, "phrase");
}

export default function Phrases({ loaderData }: Route.ComponentProps) {
  const [searchParams] = useSearchParams();
  const search = searchParams.get("q");

  return (
    <div className="w-full">
      <PageHeader
        title="Phrases"
        icon={MessageSquareQuote}
        description={`${loaderData.total} phrase${loaderData.total === 1 ? "" : "s"}. Polite set phrases and everyday expressions.`}
        actions={
          <Link
            to="/phrases/new"
            className="inline-flex h-10 items-center gap-2 rounded-full bg-primarylw px-6 text-sm font-medium text-white shadow transition-colors hover:bg-primarylw-2"
          >
            <Plus className="h-4 w-4" /> Add phrases
          </Link>
        }
      />

      <SearchBar
        paramName="q"
        placeholder="Search phrases…"
        activeValue={search}
        clearTo="/phrases"
      />

      {loaderData.items.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            No phrases found{search ? ` for “${search}”` : ""}.{" "}
            <Link to="/phrases/new" className="text-primarylw underline">
              Add the first one
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {loaderData.items.map((phrase) => (
            // Same card as a word on /words — headword, kana, meaning, then a
            // footer — so the two libraries read alike. The card itself is not a
            // link: the phrase link is stretched over it with `after:` so the
            // list link in the footer stays clickable.
            <Card
              key={phrase.id}
              data-slot="word-card"
              className="relative flex h-full flex-col transition-transform hover:-translate-y-0.5"
            >
              <CardContent className="flex flex-1 flex-col p-5">
                <div className="min-w-0">
                  <h2 className="break-words text-2xl font-semibold">
                    <Link
                      to={`/words/${phrase.id}`}
                      className="after:absolute after:inset-0 after:content-['']"
                    >
                      {phrase.word}
                    </Link>
                  </h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">{phrase.kana}</p>
                </div>

                {phrase.meaning && (
                  <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                    {phrase.meaning}
                  </p>
                )}

                {/* Footer: source list on the left, part of speech pinned bottom-right. */}
                <div className="mt-auto flex items-end justify-between gap-2 pt-4">
                  {phrase.listId && phrase.listTitle ? (
                    <Link
                      to={`/lists/${phrase.listId}`}
                      className="min-w-0 truncate text-xs text-muted-foreground transition-colors hover:text-primarylw hover:underline"
                    >
                      {phrase.listTitle}
                    </Link>
                  ) : (
                    <span />
                  )}
                  {phrase.pos && (
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {phrase.pos}
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="mt-8">
        <Pagination
          page={loaderData.page}
          pages={loaderData.pages}
          makeHref={() => "/phrases"}
          search={search}
        />
      </div>
    </div>
  );
}
