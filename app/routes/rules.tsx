import { Link, useSearchParams } from "react-router";
import { BookMarked, BookOpenText, Plus, Sparkles } from "lucide-react";

import type { Route } from "./+types/rules";
import { listAllRuleTags, listRules } from "~/lib/db.server";
import { isConvexClientConfigured } from "~/components/convex-provider";
import { AdminOnly } from "~/components/admin-only";
import { PageHeader } from "~/components/page-header";
import { ActiveTagFilter, SearchBar } from "~/components/search-bar";
import { Badge } from "~/components/lightswind/badge";
import { Card, CardContent } from "~/components/lightswind/card";
import { Pagination } from "~/components/lightswind/pagination";
import { RulePoint } from "~/components/rule-point";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Rules & forms · 日本語Vocab" }];
}

/** How many tags a card shows before the rest collapse into "+x". */
const MAX_VISIBLE_TAGS = 2;

interface RuleFilters {
  kind?: string;
  q?: string;
  tag?: string;
  page?: number;
}

/** Build a /rules URL, preserving whichever filters are active. */
function rulesHref({ kind, q, tag, page }: RuleFilters): string {
  const qs = new URLSearchParams();
  if (kind) qs.set("kind", kind);
  if (q) qs.set("q", q);
  if (tag) qs.set("tag", tag);
  if (page && page > 1) qs.set("page", String(page));
  const s = qs.toString();
  return s ? `/rules?${s}` : "/rules";
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const kindParam = url.searchParams.get("kind");
  const kind = kindParam === "word" || kindParam === "sentence" ? kindParam : null;
  const search = url.searchParams.get("q")?.trim() || null;
  const tag = url.searchParams.get("tag")?.trim() || null;
  const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1;

  const [rules, tags] = await Promise.all([
    listRules(kind, Number.isNaN(page) ? 1 : page, search, tag),
    listAllRuleTags(),
  ]);
  return { rules, tags, kind, search, tag };
}

const KIND_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "word", label: "Word rules" },
  { value: "sentence", label: "Sentence rules" },
];

export default function Rules({ loaderData }: Route.ComponentProps) {
  const [searchParams] = useSearchParams();
  const kind = searchParams.get("kind") ?? "";
  const q = searchParams.get("q") ?? "";
  const tag = searchParams.get("tag") ?? "";
  const configured = isConvexClientConfigured();

  return (
    <div className="w-full">
      <PageHeader
        title="Rules & forms"
        icon={Sparkles}
        description={`${loaderData.rules.total} grammar rule${loaderData.rules.total === 1 ? "" : "s"} with example sentences and their English equivalents`}
        actions={
          <>
            {configured && (
              <AdminOnly>
                <Link
                  to="/rules/new"
                  className="inline-flex h-10 items-center gap-2 rounded-full bg-primarylw px-6 text-sm font-medium text-white shadow transition-colors hover:bg-primarylw-2"
                >
                  <Plus className="h-4 w-4" /> Add rule
                </Link>
              </AdminOnly>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {KIND_FILTERS.map((filter) => {
          const active = kind === filter.value;
          return (
            <Link
              key={filter.value || "all"}
              to={rulesHref({ kind: filter.value, q, tag })}
              className={
                active
                  ? "rounded-full bg-primarylw px-4 py-1.5 text-sm font-medium text-white"
                  : "rounded-full border border-border px-4 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted"
              }
            >
              {filter.label}
            </Link>
          );
        })}
      </div>

      {/* Free-text search across title / explanation / points, plus a tag filter */}
      <SearchBar
        paramName="q"
        placeholder="Search rules… (title, explanation or points)"
        activeValue={q || null}
        clearTo={rulesHref({ kind, tag })}
        tags={loaderData.tags}
        tagHref={(name) => rulesHref({ kind, q, tag: name })}
        selectedTag={tag || null}
      />

      {tag && <ActiveTagFilter tag={tag} clearTo={rulesHref({ kind, q })} />}

      {loaderData.rules.items.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            No rules found{q ? ` for “${q}”` : ""}
            {tag ? ` tagged #${tag}` : ""}. Admins can add the first one.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {loaderData.rules.items.map((rule) => (
            <Card
              key={rule.id}
              data-slot="rule-card"
              className="relative transition-transform hover:-translate-y-0.5"
            >
              <CardContent className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link to={`/rules/${rule.id}`} className="min-w-0 after:absolute after:inset-0">
                    <h2 className="text-lg font-semibold hover:text-primarylw">{rule.title}</h2>
                  </Link>
                  <Badge variant={rule.kind === "sentence" ? "default" : "kana"}>
                    {rule.kind === "sentence" ? "Sentence rule" : "Word rule"}
                  </Badge>
                </div>

                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                  {rule.explanation}
                </p>

                {rule.points.length > 0 && (
                  <div className="mt-5 space-y-3">
                    {rule.points.map((point, index) => (
                      <RulePoint key={index} pattern={point} />
                    ))}
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <BookMarked className="h-3.5 w-3.5" />
                    {rule.exampleCount} example{rule.exampleCount === 1 ? "" : "s"}
                  </span>

                  {rule.tags.length > 0 && (
                    <div className="relative z-10 flex flex-wrap items-center gap-1.5">
                      {rule.tags.slice(0, MAX_VISIBLE_TAGS).map((t) => (
                        <Link
                          key={t}
                          to={rulesHref({ kind, q, tag: t })}
                          className="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primarylw/40 hover:text-foreground"
                        >
                          #{t}
                        </Link>
                      ))}
                      {rule.tags.length > MAX_VISIBLE_TAGS && (
                        <span
                          title={rule.tags
                            .slice(MAX_VISIBLE_TAGS)
                            .map((t) => `#${t}`)
                            .join(", ")}
                          className="rounded-full border border-dashed border-border px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
                        >
                          +{rule.tags.length - MAX_VISIBLE_TAGS}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="mt-8">
        <Pagination
          page={loaderData.rules.page}
          pages={loaderData.rules.pages}
          makeHref={() => rulesHref({ kind, q, tag })}
        />
      </div>
    </div>
  );
}