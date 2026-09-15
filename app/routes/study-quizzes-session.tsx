import { Link } from "react-router";
import type { Route } from "./+types/study-quizzes-session";
import { countRules, countWordsInLists, listAllListIds, listIdsByTags } from "~/lib/db.server";
import { ownerContext } from "~/lib/owner.server";
import { isValidPos } from "~/components/pos-filter";
import { PageHeader } from "~/components/page-header";
import { QuizRunner, type QuizRunConfig } from "~/components/quiz-runner";
import {
  QUIZ_DIFFICULTIES,
  QUIZ_QUESTION_TYPES,
  QUIZ_SOURCE_KINDS,
  QUIZ_SOURCE_KIND_LABELS,
  QUIZ_TYPE_LABELS,
  type QuizDifficulty,
  type QuizQuestionType,
  type QuizSourceKind,
} from "~/lib/quiz-types";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Quiz · 日本語Vocab" }];
}

/** "words and rules" / "words, phrases and rules". */
function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function parseIds(value: string | null): number[] {
  return (value ?? "")
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((id) => !Number.isNaN(id));
}

/**
 * The quiz session route.
 *
 * It resolves *what* the quiz is about (which library items are in scope, and
 * how many of them there are) but deliberately does not generate anything: the
 * AI call happens client-side after mount, so this page renders immediately and
 * the wait becomes a progress panel the user can read.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const owner = context.get(ownerContext);
  const ownerId = owner?.ownerId ?? "anonymous";

  const sources = (url.searchParams.get("sources") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part): part is QuizSourceKind => (QUIZ_SOURCE_KINDS as string[]).includes(part));
  // A quiz with nothing selected would have nothing to ask about.
  const resolvedSources: QuizSourceKind[] = sources.length > 0 ? sources : ["rules"];
  const wantsWords = resolvedSources.includes("words");
  const wantsPhrases = resolvedSources.includes("phrases");
  const wantsRules = resolvedSources.includes("rules");

  const countParam = Number.parseInt(url.searchParams.get("count") ?? "10", 10);
  const questionCount = Number.isNaN(countParam) ? 10 : Math.min(Math.max(countParam, 1), 50);

  // No `seconds` param at all means the timer is off.
  const secondsParam = url.searchParams.get("seconds");
  const parsedSeconds = secondsParam === null ? Number.NaN : Number.parseInt(secondsParam, 10);
  const timeLimitSeconds = Number.isNaN(parsedSeconds)
    ? null
    : Math.min(Math.max(parsedSeconds, 5), 300);

  const requestedTypes = (url.searchParams.get("types") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part): part is QuizQuestionType =>
      (QUIZ_QUESTION_TYPES as string[]).includes(part)
    );

  const difficultyParam = url.searchParams.get("difficulty");
  const difficulty: QuizDifficulty = (QUIZ_DIFFICULTIES as string[]).includes(
    difficultyParam ?? ""
  )
    ? (difficultyParam as QuizDifficulty)
    : "normal";

  const focusParam = url.searchParams.get("focus") ?? "all";
  const focus = ["all", "meaning", "reading", "kanji", "usage"].includes(focusParam)
    ? focusParam
    : "all";

  const ruleKindParam = url.searchParams.get("ruleKind");
  const ruleKind =
    wantsRules && (ruleKindParam === "word" || ruleKindParam === "sentence") ? ruleKindParam : null;

  const posParam = url.searchParams.get("pos");
  const pos = wantsWords && isValidPos(posParam) ? posParam : null;

  const starredIds = parseIds(url.searchParams.get("starredIds"));
  // "Only what I keep missing" narrows each source to the ids the user has
  // answered wrong before. Rule ids and word ids are separate sequences, so
  // they arrive (and are applied) separately. They win over a starred-only
  // scoping, since the builder sends one or the other.
  const missedWordIds = parseIds(url.searchParams.get("missedWordIds"));
  const missedRuleIds = parseIds(url.searchParams.get("missedRuleIds"));
  const retryMissed = missedWordIds.length > 0 || missedRuleIds.length > 0;
  /**
   * Starred scoping is opt-in, and the flag is what says so — not the presence
   * of starred ids. Inferring it from "this user has stars" is what used to
   * turn starring a single word into a hard scope with no way back.
   */
  const starredOnly =
    !retryMissed && url.searchParams.get("starred") === "1" && starredIds.length > 0;

  /**
   * An explicit rule selection. The param being *absent* means every rule; an
   * empty value is a deliberate "none" — so the two are kept apart rather than
   * both collapsing into "no filter".
   */
  const ruleIdsParam = url.searchParams.get("ruleIds");
  const ruleIds = ruleIdsParam === null ? null : parseIds(ruleIdsParam);

  const explicitLists = parseIds(url.searchParams.get("lists"));
  const tagNames = (url.searchParams.get("tags") ?? "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);

  /**
   * Misses win over stars. `null` means no id scoping at all; an empty list
   * means "nothing matched", which `cardIdClause` turns into a clause that
   * deliberately matches nothing.
   */
  const scopeFor = (missed: number[]): number[] | null => {
    if (retryMissed) return missed.length > 0 ? missed : [];
    return starredOnly ? starredIds : null;
  };

  /** Narrow a scope by an explicit id list; `null` leaves the scope alone. */
  const intersect = (scope: number[] | null, explicit: number[] | null): number[] | undefined => {
    if (explicit === null) return scope ?? undefined;
    if (scope === null) return explicit;
    return scope.filter((id) => explicit.includes(id));
  };

  // Explicit lists → lists matching tags → everything (mirrors the study route).
  let listIds: number[] = [];
  let totalAvailable = 0;

  if (wantsRules) {
    totalAvailable += await countRules(
      ownerId,
      ruleKind,
      intersect(scopeFor(missedRuleIds), ruleIds),
      tagNames
    );
  }

  if (wantsWords || wantsPhrases) {
    if (explicitLists.length > 0) {
      listIds = explicitLists;
    } else if (tagNames.length > 0) {
      listIds = await listIdsByTags(ownerId, tagNames);
    } else {
      listIds = await listAllListIds(ownerId);
    }

    // A quiz spanning words *and* phrases draws from the same lists but a
    // different card kind, so the two counts are added rather than merged.
    const filter = scopeFor(missedWordIds) ?? undefined;
    const kinds = [
      wantsWords ? ("words" as const) : null,
      wantsPhrases ? ("phrases" as const) : null,
    ].filter((kind): kind is "words" | "phrases" => kind !== null);
    const counts = await Promise.all(
      kinds.map((kind) => countWordsInLists(ownerId, listIds, pos, kind, filter))
    );
    totalAvailable += counts.reduce((sum, count) => sum + count, 0);
  }

  const config: QuizRunConfig = {
    sources: resolvedSources,
    questionCount,
    timeLimitSeconds,
    types: requestedTypes.length > 0 ? requestedTypes : ["multiple-choice"],
    difficulty,
    distribution: url.searchParams.get("distribution") === "random" ? "random" : "even",
    focus,
    ruleKind,
    ruleIds,
    pos,
    listIds,
    starredOnly,
    retryMissed,
    missedWordIds: retryMissed ? missedWordIds : [],
    missedRuleIds: retryMissed ? missedRuleIds : [],
  };

  return { config, totalAvailable, starredIds: retryMissed ? [] : starredIds };
}

export default function QuizSession({ loaderData }: Route.ComponentProps) {
  const { config, totalAvailable, starredIds } = loaderData;

  const kindNames = config.sources.map((kind) => QUIZ_SOURCE_KIND_LABELS[kind].toLowerCase());
  const wantsRules = config.sources.includes("rules");
  const wantsLists = config.sources.includes("words") || config.sources.includes("phrases");
  const setupHref = `/study/quizzes?kind=${config.sources.join(",")}`;

  const scope = config.retryMissed
    ? `${totalAvailable} ${totalAvailable === 1 ? "item" : "items"} you have missed before`
    : wantsRules && !wantsLists
      ? `${starredOnly(config.starredOnly)}${totalAvailable} ${config.ruleKind ? `${config.ruleKind} ` : ""}rules`
      : !wantsRules && wantsLists
        ? `${config.listIds.length} list${config.listIds.length === 1 ? "" : "s"}${config.pos ? ` · ${config.pos} only` : ""} · ${starredOnly(config.starredOnly)}${totalAvailable} available`
        : `${totalAvailable} item${totalAvailable === 1 ? "" : "s"} in scope`;

  return (
    <div className="w-full">
      <PageHeader
        title={
          config.sources.length === 1
            ? `Quiz · ${QUIZ_SOURCE_KIND_LABELS[config.sources[0]]}`
            : "Quiz · Mixed"
        }
        breadcrumbs={[{ label: "Quizzes", to: setupHref }]}
        description={`${scope} · ${config.questionCount} question${config.questionCount === 1 ? "" : "s"} · ${config.timeLimitSeconds === null ? "untimed" : `${config.timeLimitSeconds}s each`} · ${config.difficulty} · ${config.types.map((type) => QUIZ_TYPE_LABELS[type as QuizQuestionType]).join(", ")}`}
      />

      {totalAvailable === 0 ? (
        <div className="rounded-[var(--radius)] border border-border p-10 text-center text-muted-foreground">
          <p className="font-medium text-foreground">Nothing matched this quiz’s filters.</p>
          <p className="mt-2 text-sm">
            No {config.pos ? `${config.pos} ` : ""}
            {listWords(kindNames)} were found to draw on.{" "}
            {config.retryMissed
              ? "This quiz is limited to the items you have missed before, and none are in scope."
              : config.starredOnly
                ? "This quiz is limited to your starred items — turn “Starred items only” off to use the whole library."
                : "Try widening the list, rule or tag selection."}
          </p>
          <Link to={setupHref} className="mt-4 inline-block text-primarylw hover:underline">
            Adjust the setup
          </Link>
        </div>
      ) : (
        <QuizRunner config={config} starredIds={starredIds} />
      )}
    </div>
  );
}

function starredOnly(value: boolean): string {
  return value ? "★ " : "";
}
