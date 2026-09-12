import * as React from "react";
import { Link } from "react-router";
import { ChevronDown, GraduationCap, Layers, Pencil, Star } from "lucide-react";

import type { Route } from "./+types/list-detail";
import { getWordList } from "~/lib/db.server";
import { useStarredIds } from "~/lib/use-stars";
import { isConvexClientConfigured } from "~/components/convex-provider";
import { ImportantStar } from "~/components/important-star";
import { SignedInOnly } from "~/components/signed-in-only";
import { PageHeader } from "~/components/page-header";
import { CanEdit } from "~/components/author-only";
import { Badge } from "~/components/lightswind/badge";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/lightswind/popover";
import { Card, CardContent } from "~/components/lightswind/card";
import { cn } from "~/lib/utils";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Word list · 日本語Vocab" }];
}

export async function loader({ params }: Route.LoaderArgs) {
  const id = Number.parseInt(params.id ?? "", 10);
  if (Number.isNaN(id)) {
    throw new Response("Invalid list id", { status: 400 });
  }
  const list = await getWordList(id);
  if (!list) {
    throw new Response("Word list not found", { status: 404 });
  }
  return { list };
}

/**
 * A word list (or phrase list) with its cards. Starring is per-user and lives
 * in Convex, so the star state below comes from `useStarredIds()` rather than
 * from the loader.
 */
export default function ListDetail({ loaderData }: Route.ComponentProps) {
  const { list } = loaderData;
  const configured = isConvexClientConfigured();
  const starred = useStarredIds();
  const [studyOpen, setStudyOpen] = React.useState(false);
  // Phrase lists are browsed on their own page, so their tags link there.
  const isPhraseList = list.words.some((word) => word.pos === "phrase");
  // The cards this list holds that the current user has starred. "Study
  // starred" then narrows the deck down to just those cards.
  const starredIds = list.words
    .filter((word) => starred.words.has(word.id))
    .map((word) => word.id);
  const starredCount = starredIds.length;
  const noun = isPhraseList ? "phrase" : "word";
  const tagHref = (tag: string) =>
    isPhraseList
      ? `/phrases/lists?tag=${encodeURIComponent(tag)}`
      : `/?tag=${encodeURIComponent(tag)}`;

  return (
    <div className="w-full">
      <PageHeader
        title={list.title}
        breadcrumbs={[{ label: "Word lists", to: "/" }]}
        description="Open a word for its meanings and example sentences, or study the whole list"
        badge={
          <Badge variant="secondary">
            {list.wordCount} word{list.wordCount === 1 ? "" : "s"}
            {starredCount > 0 ? ` · ${starredCount} ★` : ""}
          </Badge>
        }
        tags={
          list.tags.length > 0 ?
            list.tags.map((tag) => (
              <Link
                key={tag}
                to={tagHref(tag)}
                className="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primarylw/40 hover:text-foreground"
              >
                #{tag}
              </Link>
            )) : null
        }
        actions={
          <>
            {list.wordCount > 0 && (
              // One button, one menu: "all" and "starred only" are the same
              // intent, so they live behind a popover instead of sitting side
              // by side as two competing buttons.
              <Popover open={studyOpen} onOpenChange={setStudyOpen}>
                <PopoverTrigger
                  className={cn(
                    "h-10 rounded-full bg-primarylw px-6 text-sm font-medium text-white shadow transition-colors hover:bg-primarylw-2",
                    studyOpen && "bg-primarylw-2"
                  )}
                >
                  <GraduationCap className="h-4 w-4" /> Study this list
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 transition-transform duration-200",
                      studyOpen && "rotate-180"
                    )}
                  />
                </PopoverTrigger>
                <PopoverContent align="end" className="w-64 p-1">
                  <Link
                    to={`/study/session?lists=${list.id}`}
                    role="menuitem"
                    onClick={() => setStudyOpen(false)}
                    className="flex items-start gap-3 rounded-[var(--radius)] px-3 py-2 transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                  >
                    <Layers className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">
                        All {list.wordCount} {noun}
                        {list.wordCount === 1 ? "" : "s"}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        Every card in this list
                      </span>
                    </span>
                  </Link>

                  {starredCount > 0 && (
                    <Link
                      to={`/study/session?lists=${list.id}&starredIds=${starredIds.join(",")}`}
                      role="menuitem"
                      onClick={() => setStudyOpen(false)}
                      className="flex items-start gap-3 rounded-[var(--radius)] px-3 py-2 transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                    >
                      <Star className="mt-0.5 h-4 w-4 shrink-0 fill-current text-amber-500" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">
                          {starredCount} starred
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          Only the cards you starred
                        </span>
                      </span>
                    </Link>
                  )}
                </PopoverContent>
              </Popover>
            )}
            {configured && (
              <CanEdit ownerIds={[list.createdBy]}>
                <Link
                  to={`/lists/${list.id}/edit`}
                  className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border px-5 text-sm font-medium transition-colors hover:border-primarylw/40 hover:bg-muted"
                >
                  <Pencil className="h-4 w-4" /> Edit list
                </Link>
              </CanEdit>
            )}
          </>
        }
      />
      {list.description && (
        <p className="mb-3 max-w-2xl text-muted-foreground">{list.description}</p>
      )}

      {list.words.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            This list has no words yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {list.words.map((word) => (
            // Same card as the vocabulary page — word, kana underneath, muted
            // meaning, word type bottom-right — except the ★ stays here: the
            // card itself is not a link, the word link is stretched over it with
            // `after:` so the star and the footer stay clickable.
            <Card
              key={word.id}
              data-slot="word-card"
              className="relative flex h-full flex-col transition-transform hover:-translate-y-0.5"
            >
              <CardContent className="flex flex-1 flex-col p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="break-words text-2xl font-semibold">
                      <Link
                        to={`/words/${word.id}`}
                        className="after:absolute after:inset-0 after:content-['']"
                      >
                        {word.word}
                      </Link>
                    </h2>
                    <p className="mt-0.5 text-sm text-muted-foreground">{word.kana}</p>
                  </div>
                  {configured && (
                    <SignedInOnly>
                      <ImportantStar
                        kind="word"
                        id={word.id}
                        label={word.word}
                        className="relative z-10 shrink-0"
                      />
                    </SignedInOnly>
                  )}
                </div>

                <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                  {word.meaning ?? "-"}
                </p>

                {word.pos && (
                  <div className="mt-auto flex justify-end pt-4">
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {word.pos}
                    </Badge>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}