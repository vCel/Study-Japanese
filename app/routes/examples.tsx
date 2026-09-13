import { Link } from "react-router";
import { BookOpenText } from "lucide-react";

import type { Route } from "./+types/examples";
import { listExamples } from "~/lib/db.server";
import { ownerContext } from "~/lib/owner.server";
import { PageHeader } from "~/components/page-header";
import { Card, CardContent } from "~/components/lightswind/card";
import { Pagination } from "~/components/lightswind/pagination";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Example sentences · 日本語Vocab" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1;
  const owner = context.get(ownerContext);
  const ownerId = owner?.ownerId ?? "anonymous";
  return await listExamples(ownerId, Number.isNaN(page) ? 1 : page);
}

export default function Examples({ loaderData }: Route.ComponentProps) {
  return (
    <div className="w-full">
      <PageHeader
        title="Example sentences"
        icon={BookOpenText}
        breadcrumbs={[{ label: "Words", to: "/words" }]}
        description={`${loaderData.total} sentence${loaderData.total === 1 ? "" : "s"} to read words in context`}
      />

      {loaderData.items.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            No example sentences yet.{" "}
            <Link to="/lists/new" className="text-primarylw underline">
              Add some words with examples
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {loaderData.items.map((example) => (
            <Card key={example.id}>
              <CardContent className="p-5">
                <p className="text-lg">{example.japanese}</p>
                {example.translation && (
                  <p className="mt-1 text-sm text-muted-foreground">{example.translation}</p>
                )}
                <Link
                  to={`/words/${example.wordId}`}
                  className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primarylw hover:underline"
                >
                  <BookOpenText className="h-4 w-4" />
                  {example.word} <span className="font-normal text-muted-foreground">({example.kana})</span>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="mt-8">
        <Pagination
          page={loaderData.page}
          pages={loaderData.pages}
          makeHref={() => "/words/examples"}
        />
      </div>
    </div>
  );
}