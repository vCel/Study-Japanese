import { Link } from "react-router";
import { ListTree, Plus } from "lucide-react";

import type { Route } from "./+types/phrases-lists";
import { listAllTags, listWordLists } from "~/lib/db.server";
import { ownerContext } from "~/lib/owner.server";
import { ListsHome } from "~/components/lists-home";
import { PageHeader } from "~/components/page-header";
import { SearchBar } from "~/components/search-bar";
import { Card, CardContent } from "~/components/lightswind/card";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Phrase lists · 日本語Vocab" },
    { name: "description", content: "Collections of everyday Japanese phrases." },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const tag = url.searchParams.get("tag")?.trim() || null;
  const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1;
  const owner = context.get(ownerContext);
  const ownerId = owner?.ownerId ?? "anonymous";

  const [lists, tags] = await Promise.all([
    listWordLists(ownerId, Number.isNaN(page) ? 1 : page, tag, "phrase"),
    listAllTags(ownerId),
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
          <Link
            to="/phrases/new"
            className="inline-flex h-10 items-center gap-2 rounded-full bg-primarylw px-6 text-sm font-medium text-white shadow transition-colors hover:bg-primarylw-2"
          >
            <Plus className="h-4 w-4" /> Add phrases
          </Link>
        }
      />

      {/* Tag filter: the active tag shows as a chip inside the search box */}
      <SearchBar
        paramName="tag"
        placeholder="Search phrase lists by tag… (e.g. phrases)"
        activeValue={null}
        clearTo="/phrases/lists"
        tags={tags}
        tagHref={(name) => `/phrases/lists?tag=${encodeURIComponent(name)}`}
        selectedTag={tag}
      />

      {lists.items.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            No phrase lists{tag ? ` tagged “${tag}”` : ""} yet.{" "}
            <Link to="/phrases/new" className="text-primarylw underline">
              Create the first one
            </Link>
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
