import { Link, useParams } from "react-router";
import { Pencil } from "lucide-react";

import type { Route } from "./+types/word-detail";
import { getWord } from "~/lib/db.server";
import { isConvexClientConfigured } from "~/components/convex-provider";
import { PageHeader } from "~/components/page-header";
import { CanEdit } from "~/components/author-only";
import { Badge } from "~/components/lightswind/badge";
import { Button } from "~/components/lightswind/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/lightswind/card";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Word · 日本語Vocab" },
    {
      name: "description",
      content: "Word details: kana reading, meanings and example sentences.",
    },
  ];
}

export async function loader({ params }: Route.LoaderArgs) {
  const id = Number.parseInt(params.id ?? "", 10);
  if (Number.isNaN(id)) {
    throw new Response("Invalid word id", { status: 400 });
  }
  const word = await getWord(id);
  if (!word) {
    throw new Response("Word not found", { status: 404 });
  }
  return { word };
}

export default function WordDetail({ loaderData }: Route.ComponentProps) {
  const { word } = loaderData;

  return (
    <div className="w-full">
      <PageHeader
        title={word.word}
        breadcrumbs={[{ label: "Words", to: "/words" }]}
        description={<span className="font-medium text-foreground">{word.kana}</span>}
        actions={
          <>
            {isConvexClientConfigured() && (
              <CanEdit ownerIds={[word.createdBy, word.listAuthor]}>
                <Link
                  to={`/words/${word.id}/edit`}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-5 text-sm font-medium transition-colors hover:border-primarylw/40 hover:bg-muted"
                >
                  <Pencil className="h-4 w-4" /> Edit word
                </Link>
              </CanEdit>
            )}
          </>
        }
      />

      {/*
        Meanings and example sentences share the width on large screens: a
        one-line meanings list no longer floats in a card stretched the whole
        way across the page.
      */}
      <div className="grid items-start gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg">Meanings</CardTitle>
            {word.pos && (
              <Badge variant="secondary" className="text-sm">
                {word.pos}
              </Badge>
            )}
          </CardHeader>
          <CardContent>
            {word.meanings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No meanings yet.</p>
            ) : (
              <ol className="list-decimal space-y-2 pl-5 text-base leading-relaxed">
                {word.meanings.map((meaning) => (
                  <li key={meaning}>{meaning}</li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">
              Example sentences{" "}
              <span className="text-sm font-normal text-muted-foreground">
                ({word.examples.length})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 xl:grid-cols-2">
            {word.examples.length === 0 ? (
              <p className="text-sm text-muted-foreground">No examples yet for this word.</p>
            ) : (
              word.examples.map((example) => (
                <div
                  key={example.id}
                  className="rounded-[var(--radius)] border border-border p-4"
                >
                  <p className="text-lg">{example.japanese}</p>
                  {example.translation && (
                    <p className="mt-1 text-sm text-muted-foreground">{example.translation}</p>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {word.listId && word.listTitle && (
        <p className="mt-6 text-sm text-muted-foreground">
          Part of word list{" "}
          <Link to={`/lists/${word.listId}`} className="font-medium text-primarylw hover:underline">
            {word.listTitle}
          </Link>
          .
        </p>
      )}
    </div>
  );
}