import { Link } from "react-router";
import { BookOpen, Sparkles } from "lucide-react";

import type { Route } from "./+types/rule-examples";
import { listRuleExamples } from "~/lib/db.server";
import { ownerContext } from "~/lib/owner.server";
import { PageHeader } from "~/components/page-header";
import { Badge } from "~/components/lightswind/badge";
import { Card, CardContent } from "~/components/lightswind/card";
import { Pagination } from "~/components/lightswind/pagination";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Rule examples · 日本語Vocab" },
    {
      name: "description",
      content: "Example sentences for every grammar rule and form, with their English equivalents.",
    },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1;
  const owner = context.get(ownerContext);
  const ownerId = owner?.ownerId ?? "anonymous";
  return await listRuleExamples(ownerId, Number.isNaN(page) ? 1 : page);
}

/**
 * A separate home for the rules & forms example sentences, so they are not
 * mixed in with the word-list examples on /examples.
 */
export default function RuleExamples({ loaderData }: Route.ComponentProps) {
  return (
    <div className="w-full">
      <PageHeader
        title="Rule examples"
        icon={Sparkles}
        breadcrumbs={[{ label: "Rules & forms", to: "/rules" }]}
        description={`${loaderData.total} example sentence${loaderData.total === 1 ? "" : "s"} from the rules & forms, each with its English equivalent`}
      />

      {loaderData.items.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            No rule examples yet.{" "}
            <Link to="/rules/new" className="text-primarylw underline">
              Add a rule with examples
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {loaderData.items.map((example) => (
            <Card key={example.id}>
              <CardContent className="p-5">
                <p className="text-lg">{example.japanese}</p>
                {example.english && (
                  <p className="mt-1 text-sm text-muted-foreground">{example.english}</p>
                )}
                {example.englishEquivalent && (
                  <p className="mt-1 flex items-start gap-1.5 text-sm font-medium text-primarylw">
                    <BookOpen className="mt-0.5 h-4 w-4 shrink-0" />
                    {example.englishEquivalent}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge variant={example.ruleKind === "sentence" ? "default" : "kana"}>
                    {example.ruleKind === "sentence" ? "Sentence rule" : "Word rule"}
                  </Badge>
                  <Link
                    to={`/rules/${example.ruleId}`}
                    className="text-sm font-medium text-primarylw hover:underline"
                  >
                    {example.ruleTitle}
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="mt-8">
        <Pagination
          page={loaderData.page}
          pages={loaderData.pages}
          makeHref={() => "/rules/examples"}
        />
      </div>
    </div>
  );
}
