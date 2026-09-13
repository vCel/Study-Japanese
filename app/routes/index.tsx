import { Form, Link, useActionData, useNavigation } from "react-router";
import { ListTree, Plus, Sparkles } from "lucide-react";

import type { Route } from "./+types/index";
import {
  copyStarterPack,
  getStarterChoice,
  hasContent,
  listAllTags,
  listWordLists,
  setStarterChoice,
} from "~/lib/db.server";
import { ListsHome } from "~/components/lists-home";
import { ownerContext } from "~/lib/owner.server";
import { isValidPos, PosFilter } from "~/components/pos-filter";
import { SearchBar } from "~/components/search-bar";
import { PageHeader } from "~/components/page-header";
import { Button } from "~/components/lightswind/button";
import { Card, CardContent } from "~/components/lightswind/card";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Word lists · 日本語Vocab" },
    {
      name: "description",
      content: "Your private Japanese word lists — study one or combine several into a session.",
    },
  ];
}

export interface IndexActionData {
  ok: boolean;
  error?: string;
  copied?: { lists: number; words: number; rules: number };
}

/**
 * Onboarding: a brand-new owner (fresh device or new account) chooses whether
 * to copy the starter pack into their private library or start empty. Either
 * choice is recorded so the prompt never returns.
 */
export async function action({ request, context }: Route.ActionArgs): Promise<IndexActionData> {
  const owner = context.get(ownerContext);
  if (!owner) return { ok: false, error: "Could not identify your library." };

  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "starter") {
    try {
      const copied = await copyStarterPack(owner.ownerId);
      return { ok: true, copied };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown database error";
      return { ok: false, error: `Could not load the starter pack: ${message}` };
    }
  }

  if (intent === "empty") {
    await setStarterChoice(owner.ownerId, false);
    return { ok: true };
  }

  return { ok: false, error: "Unknown onboarding choice." };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const tag = url.searchParams.get("tag")?.trim() || null;
  const posParam = url.searchParams.get("pos");
  const pos = isValidPos(posParam) ? posParam : null;
  const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1;

  const owner = context.get(ownerContext);
  const ownerId = owner?.ownerId ?? "anonymous";

  const [lists, tags, contentExists, starterChosen] = await Promise.all([
    // Phrase lists live on their own page, so leave them out of the word lists.
    listWordLists(ownerId, Number.isNaN(page) ? 1 : page, tag, pos, "phrase"),
    listAllTags(ownerId),
    hasContent(ownerId),
    getStarterChoice(ownerId),
  ]);

  return {
    lists,
    tags,
    tag,
    pos,
    page: Number.isNaN(page) ? 1 : page,
    // Show onboarding only when the owner has nothing at all and hasn't chosen.
    onboarding: !contentExists && starterChosen === null,
  };
}

export default function Index({ loaderData }: Route.ComponentProps) {
  const { lists, tags, tag, pos, page, onboarding } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

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
        description={`${lists.total} list${lists.total === 1 ? "" : "s"}${pos ? ` with ${pos} words` : ""}. Your lists are private — only you can see them.`}
        actions={
          <Link
            to="/lists/new"
            className="inline-flex h-10 items-center gap-2 rounded-full bg-primarylw px-6 text-sm font-medium text-white shadow transition-colors hover:bg-primarylw-2"
          >
            <Plus className="h-4 w-4" /> Add word list
          </Link>
        }
      />

      {onboarding && (
        <Card className="mb-6 border-primarylw/30">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="rounded-full bg-primarylw/10 p-3 text-primarylw">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-semibold">Welcome to your Japanese library</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Everything you create is private to you. Start with a starter pack of common
                  words, phrases and grammar rules, or begin with an empty library.
                </p>
                {actionData?.error && (
                  <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
                    {actionData.error}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-3">
                  {/* Form (not <form>): on an index route it appends ?index so the
                      POST hits this route's action instead of the parent (root). */}
                  <Form method="post">
                    <input type="hidden" name="intent" value="starter" />
                    <Button type="submit" disabled={submitting}>
                      {submitting ? "Loading…" : "Start with the starter pack"}
                    </Button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="intent" value="empty" />
                    <Button type="submit" variant="outline" disabled={submitting}>
                      Start empty
                    </Button>
                  </Form>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tag filter: the active tag shows as a chip inside the search box */}
      <SearchBar
        paramName="tag"
        placeholder="Search by tag… (e.g. jlpt)"
        activeValue={null}
        clearTo={pos ? `/?pos=${pos}` : "/"}
        tags={tags}
        tagHref={tagLink}
        selectedTag={tag}
      />

      {/* Part-of-speech filter */}
      <PosFilter active={pos ?? ""} makeHref={makeHref} />

      {lists.items.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            No word lists{tag ? ` tagged “${tag}”` : ""}
            {pos ? ` with ${pos} words` : ""} yet.{" "}
            <Link to="/lists/new" className="text-primarylw underline">
              Create the first one
            </Link>
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
