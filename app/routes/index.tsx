import { Link } from "react-router";
import { ListTree, Plus } from "lucide-react";

import type { Route } from "./+types/index";
import { listAllTags, listWordLists } from "~/lib/db.server";
import { ListsHome } from "~/components/lists-home";
import { isConvexClientConfigured } from "~/components/convex-provider";
import { SignedInOnlyClient } from "~/components/signed-in-only";
import { isValidPos, PosFilter } from "~/components/pos-filter";
import { SearchBar, ActiveTagFilter } from "~/components/search-bar";
import { PageHeader } from "~/components/page-header";
import { Card, CardContent } from "~/components/lightswind/card";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Word lists · 日本語Vocab" },
    {
      name: "description",
      content: "Browse tagged Japanese word lists, study one or combine several into a session.",
    },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const tag = url.searchParams.get("tag")?.trim() || null;
  const posParam = url.searchParams.get("pos");
  const pos = isValidPos(posParam) ? posParam : null;
  const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1;

  const [lists, tags] = await Promise.all([
    // Phrase lists live on their own page, so leave them out of the word lists.
    listWordLists(Number.isNaN(page) ? 1 : page, tag, pos, "phrase"),
    listAllTags(),
  ]);
  return { lists, tags, tag, pos, page: Number.isNaN(page) ? 1 : page };
}

export default function Index({ loaderData }: Route.ComponentProps) {
  const { lists, tags, tag, pos, page } = loaderData;
  const makeHref = (nextPos: string) => {
    const qs = new URLSearchParams();
    if (tag) qs.set("tag", tag);
    if (nextPos) qs.set("pos", nextPos);
    const s = qs.toString();
    return s ? `/?${s}` : "/";
  };
  /** Link to a tag filter, keeping the current part-of-speech filter. */
  const tagLink = (name: string) => {
    const qs = new URLSearchParams({ tag: name });
    if (pos) qs.set("pos", pos);
    return `/?${qs.toString()}`;
  };

  return (
    <div className="w-full">
      <PageHeader
        title="Word lists"
        icon={ListTree}
        description={`${lists.total} list${lists.total === 1 ? "" : "s"}${pos ? ` with ${pos} words` : ""}. Study one, or select several to combine.`}
        actions={
          <SignedInOnlyClient>
            <Link
              to="/lists/new"
              className="inline-flex h-10 items-center gap-2 rounded-full bg-primarylw px-6 text-sm font-medium text-white shadow transition-colors hover:bg-primarylw-2"
            >
              <Plus className="h-4 w-4" /> Add word list
            </Link>
          </SignedInOnlyClient>
        }
      />

      {/* Tag filter: the tag shows as a chip below, never inside the box */}
      <SearchBar
        paramName="tag"
        placeholder="Search by tag… (e.g. jlpt)"
        activeValue={null}
        clearTo={pos ? `/?pos=${pos}` : "/"}
        tags={tags}
        tagHref={tagLink}
        selectedTag={tag}
      />

      {tag && <ActiveTagFilter tag={tag} clearTo={pos ? `/?pos=${pos}` : "/"} />}

      {/* Part-of-speech filter */}
      <PosFilter active={pos ?? ""} makeHref={makeHref} />

      {lists.items.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            No word lists{tag ? ` tagged “${tag}”` : ""}
            {pos ? ` with ${pos} words` : ""} yet.{" "}
            <SignedInOnlyClient>
              <Link to="/lists/new" className="text-primarylw underline">
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
          selectedPos={pos}
          page={page}
          pages={lists.pages}
          total={lists.total}
        />
      )}
    </div>
  );
}