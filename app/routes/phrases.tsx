import { Link, useSearchParams } from "react-router";
import { MessageSquareQuote, Plus } from "lucide-react";

import type { Route } from "./+types/phrases";
import { listWords } from "~/lib/db.server";
import { PageHeader } from "~/components/page-header";
import { isConvexClientConfigured } from "~/components/convex-provider";
import { SignedInOnlyClient } from "~/components/signed-in-only";
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

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const search = url.searchParams.get("q")?.trim() || null;
  const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1;
  return await listWords(search, Number.isNaN(page) ? 1 : page, "phrase");
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
          <SignedInOnlyClient>
            <Link
              to="/phrases/new"
              className="inline-flex h-10 items-center gap-2 rounded-full bg-primarylw px-6 text-sm font-medium text-white shadow transition-colors hover:bg-primarylw-2"
            >
              <Plus className="h-4 w-4" /> Add phrases
            </Link>
          </SignedInOnlyClient>
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
            <SignedInOnlyClient>
              <Link to="/phrases/new" className="text-primarylw underline">
                Add the first one
              </Link>
            </SignedInOnlyClient>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {loaderData.items.map((phrase) => (
            <Link key={phrase.id} to={`/words/${phrase.id}`} className="block h-full">
              <Card className="h-full transition-transform hover:-translate-y-0.5">
                <CardContent className="p-5">
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="text-xs">
                      phrase
                    </Badge>
                    <Badge variant="kana">{phrase.kana}</Badge>
                  </div>
                  <h2 className="break-words text-2xl font-semibold">{phrase.word}</h2>
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    {phrase.meaning ?? "-"}
                  </p>
                  {phrase.listId && phrase.listTitle && (
                    <p className="mt-2 text-xs">
                      <Link
                        to={`/lists/${phrase.listId}`}
                        className="text-primarylw hover:underline"
                      >
                        {phrase.listTitle}
                      </Link>
                    </p>
                  )}
                </CardContent>
              </Card>
            </Link>
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
