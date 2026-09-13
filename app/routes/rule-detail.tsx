import { Link, useParams } from "react-router";
import { BookOpen, Languages, Pencil } from "lucide-react";

import type { Route } from "./+types/rule-detail";
import { getRule } from "~/lib/db.server";
import { ownerContext } from "~/lib/owner.server";
import { PageHeader } from "~/components/page-header";
import { Badge } from "~/components/lightswind/badge";
import { Button } from "~/components/lightswind/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/lightswind/card";
import { RulePoint } from "~/components/rule-point";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Rule · 日本語Vocab" }];
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const id = Number.parseInt(params.id ?? "", 10);
  if (Number.isNaN(id)) {
    throw new Response("Invalid rule id", { status: 400 });
  }
  const owner = context.get(ownerContext);
  const ownerId = owner?.ownerId ?? "anonymous";
  const rule = await getRule(ownerId, id);
  if (!rule) {
    throw new Response("Rule not found", { status: 404 });
  }
  return { rule };
}

export default function RuleDetail({ loaderData }: Route.ComponentProps) {
  const { rule } = loaderData;
  const englishExamples = rule.examples.filter((example) => example.english.trim().length > 0);

  return (
    <div className="w-full">
      <PageHeader
        title={rule.title}
        breadcrumbs={[{ label: "Rules & forms", to: "/rules" }]}
        description="Points, examples and translations for this rule"
        badge={
          <Badge variant={rule.kind === "sentence" ? "default" : "kana"}>
            {rule.kind === "sentence" ? "Sentence rule" : "Word rule"}
          </Badge>
        }
        tags={
          rule.tags.length > 0 ? (
            <>
              {rule.tags.map((t) => (
                <Link
                  key={t}
                  to={`/rules?tag=${encodeURIComponent(t)}`}
                  className="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primarylw/40 hover:text-foreground"
                >
                  #{t}
                </Link>
              ))}
            </>
          ) : null
        }
        actions={
          <>
            <Link
              to={`/rules/${rule.id}/edit`}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-5 text-sm font-medium transition-colors hover:border-primarylw/40 hover:bg-muted"
            >
              <Pencil className="h-4 w-4" /> Edit rule
            </Link>
          </>
        }
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Explanation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="whitespace-pre-line text-sm leading-relaxed">{rule.explanation}</p>
          {rule.points.map((point, index) => (
            <RulePoint key={index} pattern={point} />
          ))}
        </CardContent>
      </Card>

      {rule.notes && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
              {rule.notes}
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Examples{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ({rule.examples.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {rule.examples.length === 0 ? (
            <p className="text-sm text-muted-foreground">No examples yet.</p>
          ) : (
            rule.examples.map((example, index) => (
              <div key={index} className="rounded-[var(--radius)] border border-border p-4">
                <p className="text-lg">{example.japanese}</p>
                <p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
                  <BookOpen className="mt-0.5 h-4 w-4 shrink-0" />
                  {example.english}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {englishExamples.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-lg">
              English equivalents{" "}
              <span className="text-sm font-normal text-muted-foreground">
                ({englishExamples.length})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {englishExamples.map((example, index) => (
                <li
                  key={index}
                  className="flex items-start gap-2 rounded-[var(--radius)] border border-border bg-muted/30 p-3 text-sm leading-relaxed"
                >
                  <Languages className="mt-0.5 h-4 w-4 shrink-0 text-primarylw" />
                  <span>{example.english}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {rule.related.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-lg">Related rules</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {rule.related.map((other) => (
              <div
                key={other.id}
                className="relative rounded-[var(--radius)] border border-border p-4 transition-colors hover:border-primarylw/40"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link
                    to={`/rules/${other.id}`}
                    className="font-medium after:absolute after:inset-0 hover:text-primarylw"
                  >
                    {other.title}
                  </Link>
                  <Badge variant={other.kind === "sentence" ? "default" : "kana"}>
                    {other.kind === "sentence" ? "Sentence rule" : "Word rule"}
                  </Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}