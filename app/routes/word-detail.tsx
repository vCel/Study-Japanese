import { Link, useParams } from "react-router";
import { Pencil } from "lucide-react";

import type { Route } from "./+types/word-detail";
import { getWord } from "~/lib/db.server";
import { subtypeLabel } from "~/lib/vocab";
import { ownerContext } from "~/lib/owner.server";
import { PageHeader } from "~/components/page-header";
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

export async function loader({ params, context }: Route.LoaderArgs) {
  const id = Number.parseInt(params.id ?? "", 10);
  if (Number.isNaN(id)) {
    throw new Response("Invalid word id", { status: 400 });
  }
  const owner = context.get(ownerContext);
  const ownerId = owner?.ownerId ?? "anonymous";
  const word = await getWord(ownerId, id);
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
            <Link
              to={`/words/${word.id}/edit`}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-5 text-sm font-medium transition-colors hover:border-primarylw/40 hover:bg-muted"
            >
              <Pencil className="h-4 w-4" /> Edit word
            </Link>
          </>
        }
      />

      {/*
        Meanings and conjugation forms share the width on large screens: a
        one-line meanings list no longer floats in a card stretched the whole
        way across the page. The row is stretched (no `items-start`) so the two
        cards measure the same height.
      */}
      <div className="grid items-stretch gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg">Meanings</CardTitle>
            {word.pos && (
              <Badge variant="secondary" className="text-sm">
                {word.pos}
                {word.subtype ? ` · ${subtypeLabel(word.subtype)}` : ""}
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

        {/* Conjugation forms — listed before the example sentences. */}
        {word.forms.length > 0 && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg">
                Forms{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  ({word.forms.length})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {word.forms.map((form, index) => (
                <div
                  key={index}
                  className="flex items-baseline justify-between gap-2 rounded-[var(--radius)] border border-border p-3"
                >
                  <span className="text-sm font-medium text-muted-foreground">
                    {form.name || "Form"}
                  </span>
                  <span className="text-lg font-semibold">{form.value}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="mt-6">
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

      {/* Notes */}
      {word.notes && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-lg">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
              {word.notes}
            </p>
          </CardContent>
        </Card>
      )}

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