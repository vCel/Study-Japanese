import type { Route } from "./+types/study-quizzes";
import { countRulesByKind, listAllRuleTags, listAllTags, listRuleChoices, listStudyLists } from "~/lib/db.server";
import { ownerContext } from "~/lib/owner.server";
import { isAiConfigured } from "~/lib/ai.server";
import { PageHeader } from "~/components/page-header";
import { QuizSetup } from "~/components/quiz-setup";
import { QUIZ_SOURCE_KINDS, type QuizSourceKind } from "~/lib/quiz-types";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Quizzes · 日本語Vocab" }];
}

/** `?kind=words,rules` preselects those sources; anything unrecognised is dropped. */
function parseSources(value: string | null): QuizSourceKind[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part): part is QuizSourceKind => (QUIZ_SOURCE_KINDS as string[]).includes(part));
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  // Deep links like /study/quizzes?lists=1,2 preselect those lists.
  const listsParam = url.searchParams.get("lists") ?? "";
  const preselectedLists = listsParam
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((id) => !Number.isNaN(id));

  const owner = context.get(ownerContext);
  const ownerId = owner?.ownerId ?? "anonymous";

  const [library, tags, ruleTags, ruleCounts, rules] = await Promise.all([
    listStudyLists(ownerId),
    listAllTags(ownerId),
    listAllRuleTags(ownerId),
    countRulesByKind(ownerId),
    // The rule picker needs every rule up front — it offers "all" as the
    // default and counts the selection, so it cannot be paged.
    listRuleChoices(ownerId),
  ]);

  return {
    wordLists: library.wordLists,
    phraseLists: library.phraseLists,
    tags,
    ruleTags,
    ruleCounts,
    rules,
    preselectedLists,
    initialSources: parseSources(url.searchParams.get("kind")),
    aiConfigured: isAiConfigured(),
  };
}

export default function QuizzesPage({ loaderData }: Route.ComponentProps) {
  return (
    <div className="w-full">
      <PageHeader
        title="Build a quiz"
        description="Pick what to be quizzed on — words, phrases, rules, or a mix — plus how many questions, whether they are timed and how hard they should be. Then let the AI write them."
      />

      {!loaderData.aiConfigured && (
        <div className="mb-6 rounded-[var(--radius)] border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-600 dark:text-amber-400">
          Quiz generation needs an AI key. Set <code>GEMINI_API_KEY</code>,{" "}
          <code>GLM_API_KEY</code>, <code>AIHUBMIX_API_KEY</code> or{" "}
          <code>OPENROUTER_API_KEY</code> (see <code>.env.example</code>) to enable it.
        </div>
      )}

      <QuizSetup
        wordLists={loaderData.wordLists}
        phraseLists={loaderData.phraseLists}
        tags={loaderData.tags}
        ruleTags={loaderData.ruleTags}
        ruleCounts={loaderData.ruleCounts}
        rules={loaderData.rules}
        preselectedLists={loaderData.preselectedLists}
        initialSources={loaderData.initialSources}
      />
    </div>
  );
}
