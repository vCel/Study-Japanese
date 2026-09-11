import { Link } from "react-router";
import { ListTree, Plus } from "lucide-react";

import type { Route } from "./+types/phrases-lists";
import { listAllTags, listWordLists } from "~/lib/db.server";
import { ListsHome } from "~/components/lists-home";
import { isConvexClientConfigured } from "~/components/convex-provider";
import { SignedInOnlyClient } from "~/components/signed-in-only";
import { PageHeader } from "~/components/page-header";
import { ActiveTagFilter, SearchBar } from "~/components/search-bar";
import { Card, CardContent } from "~/components/lightswind/card";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Phrase lists · 日本語Vocab" },
    { name: "description", content: "Collections of everyday Japanese phrases." },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const tag = url.searchParams.get("tag")?.trim() || null;
  const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1;

  const [lists, tags] = await Promise.all([
    listWordLists(Number.isNaN(page) ? 1 : page, tag, "phrase"),
    listAllTags(),
  ]);
  return { lists, tags, tag, page: Number.isNaN(page) ? 1 : page };
}

export default function PhrasesLists({ loaderData }: Route.ComponentProps) {
  const { lists, tags, tag, page } = loaderData;

  return (
    <div className="w-full">
      <PageHeader
        title="Phrase lists"
        icon={ListTree}
        description={`${lists.total} phrase list${lists.total === 1 ? "" : "s"}. Collections of everyday phrases.`}
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

      {/* Tag filter: the tag shows as a chip below, never inside the box */}
      <SearchBar
        paramName="tag"
        placeholder="Search phrase lists by tag… (e.g. phrases)"
        activeValue={null}
        clearTo="/phrases/lists"
        tags={tags}
        tagHref={(name) => `/phrases/lists?tag=${encodeURIComponent(name)}`}
        selectedTag={tag}
      />

      {tag && <ActiveTagFilter tag={tag} clearTo="/phrases/lists" />}

      {lists.items.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            No phrase lists{tag ? ` tagged “${tag}”` : ""} yet.{" "}
            <SignedInOnlyClient>
              <Link to="/phrases/new" className="text-primarylw underline">
                Create the first one
              </Link>
            </SignedInOnlyClient>
            .
          </CardContent>
        </Card>
      ) : (
        <ListsHome
          lists={lists.items}
          selectedTag={tag}
          selectedPos={null}
          page={page}
          pages={lists.pages}
          total={lists.total}
          basePath="/phrases/lists"
          unit="phrases"
        />
      )}
    </div>
  );
}
