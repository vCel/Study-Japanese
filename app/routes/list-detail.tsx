import { Link, useParams } from "react-router";
import { GraduationCap, Pencil } from "lucide-react";

import type { Route } from "./+types/list-detail";
import { getWordList } from "~/lib/db.server";
import { isConvexClientConfigured } from "~/components/convex-provider";
import { PageHeader } from "~/components/page-header";
import { CanEdit } from "~/components/author-only";
import { Badge } from "~/components/lightswind/badge";
import { Button } from "~/components/lightswind/button";
import { Card, CardContent } from "~/components/lightswind/card";

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

export default function ListDetail({ loaderData }: Route.ComponentProps) {
  const { list } = loaderData;
  // Phrase lists are browsed on their own page, so their tags link there.
  const isPhraseList = list.words.some((word) => word.pos === "phrase");
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
              <Link
                to={`/study/session?lists=${list.id}`}
                className="inline-flex h-10 items-center gap-1.5 rounded-full bg-primarylw px-6 text-sm font-medium text-white shadow transition-colors hover:bg-primarylw-2"
              >
                <GraduationCap className="h-4 w-4" /> Study this list
              </Link>
            )}
            {isConvexClientConfigured() && (
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
            <Link key={word.id} to={`/words/${word.id}`} className="block h-full">
              <Card className="h-full transition-transform hover:-translate-y-0.5">
                <CardContent className="p-5">
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    {word.pos && <Badge variant="outline" className="text-xs">{word.pos}</Badge>}
                    <Badge variant="kana">{word.kana}</Badge>
                  </div>
                  <h2 className="break-words text-2xl font-semibold">{word.word}</h2>
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    {word.meaning ?? "-"}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}