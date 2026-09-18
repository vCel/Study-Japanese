import type { Route } from "./+types/study-flashcards";
import { countRulesByKind, listAllRuleTags, listAllTags, listStudyLists } from "~/lib/db.server";
import { ownerContext } from "~/lib/owner.server";
import { PageHeader } from "~/components/page-header";
import { StudySetup } from "~/components/study-setup";
import type { StudyKind } from "~/lib/study-prefs";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Flashcards · 日本語Vocab" }];
}

function parseKind(value: string | null): StudyKind {
  return value === "phrases" || value === "forms" ? value : "words";
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  // Deep links like /study/flashcards?lists=1,2 preselect those lists on the words tab.
  const listsParam = url.searchParams.get("lists") ?? "";
  const preselectedLists = listsParam
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((id) => !Number.isNaN(id));
  const owner = context.get(ownerContext);
  const ownerId = owner?.ownerId ?? "anonymous";

  // Four round-trips, not six: the three rule counts come from one grouped
  // query (`countRulesByKind`), and the rest run together.
  const [library, tags, ruleTags, ruleCounts] = await Promise.all([
    listStudyLists(ownerId),
    listAllTags(ownerId),
    listAllRuleTags(ownerId),
    countRulesByKind(ownerId),
  ]);

  return {
    wordLists: library.wordLists,
    phraseLists: library.phraseLists,
    tags,
    ruleTags,
    ruleCounts,
    preselectedLists,
    initialKind: parseKind(url.searchParams.get("kind")),
  };
}

export default function StudySetupPage({ loaderData }: Route.ComponentProps) {
  return (
    <div className="w-full">
      <PageHeader
        title="Build a study session"
        description="Words, phrases and grammar forms each get their own deck. Pick lists (optionally narrowed by tags), then start — the deck size and order sit in the options."
      />
      <StudySetup
        wordLists={loaderData.wordLists}
        phraseLists={loaderData.phraseLists}
        tags={loaderData.tags}
        ruleTags={loaderData.ruleTags}
        ruleCounts={loaderData.ruleCounts}
        preselectedLists={loaderData.preselectedLists}
        initialKind={loaderData.initialKind}
      />
    </div>
  );
}