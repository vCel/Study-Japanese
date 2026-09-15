import type { Route } from "./+types/api.quiz-generate";

import {
  countRules,
  countWordsInLists,
  getRuleStudyDeck,
  getStudyDeck,
  listAllListIds,
  listIdsByTags,
  type RuleDetail,
  type RuleKind,
  type WordDetail,
} from "~/lib/db.server";
import { ownerContext } from "~/lib/owner.server";
import { enforceRateLimit, getClientIp } from "~/lib/ratelimit.server";
import { generateWithFallback, isAiConfigured } from "~/lib/ai.server";
import { buildQuizPrompt, type BuiltPrompt } from "~/lib/quiz-prompt";
import { parseQuizQuestions } from "~/lib/quiz-parse";
import { QUIZ_SOURCE_KINDS, type QuizConfig, type QuizSourceKind } from "~/lib/quiz-types";

/**
 * POST /api/quiz/generate — turn a quiz configuration into questions.
 *
 * The AI call is expensive compared to the rest of the JSON API, so this sits
 * behind its own rate limiter (AI_LIMITER) rather than sharing the general
 * 60/min budget, and requires a signed-in account: generation is the one
 * operation where an anonymous visitor could burn a meaningful amount of
 * someone else's quota.
 *
 * The provider fallback (Gemini → GLM) lives in `ai.server.ts`; this route only
 * decides *what* to ask about and validates what comes back.
 */

/** Questions are minted per session; this caps what one request may draw on. */
const MAX_SOURCE_ITEMS = 30;

interface GenerateBody {
  config?: unknown;
  /** Starred ids, so a starred-only quiz can be scoped server-side. */
  starredIds?: number[];
  /** Per-kind "retry my misses" ids — rule and word ids are separate sequences. */
  missedWordIds?: number[];
  missedRuleIds?: number[];
}

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

/** Narrow the posted config to the fields the prompt builder reads. */
function readConfig(raw: unknown): QuizConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const config = raw as Partial<QuizConfig>;

  const sources = Array.isArray(config.sources)
    ? config.sources.filter((kind): kind is QuizSourceKind =>
        (QUIZ_SOURCE_KINDS as string[]).includes(kind as string)
      )
    : [];
  if (sources.length === 0) return null;

  const types = Array.isArray(config.types)
    ? config.types.filter((type) =>
        ["multiple-choice", "input", "fill-blanks", "true-false"].includes(type as string)
      )
    : [];
  if (types.length === 0) return null;

  const questionCount = Math.min(Math.max(Math.round(Number(config.questionCount) || 10), 1), 50);

  return {
    sources,
    focus: (["all", "meaning", "reading", "kanji", "usage"] as const).includes(
      config.focus as never
    )
      ? (config.focus as QuizConfig["focus"])
      : "all",
    lists: Array.isArray(config.lists)
      ? config.lists.filter((id): id is number => typeof id === "number")
      : [],
    tags: Array.isArray(config.tags)
      ? config.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
    excludedTags: Array.isArray(config.excludedTags)
      ? config.excludedTags.filter((tag): tag is string => typeof tag === "string")
      : [],
    pos: typeof config.pos === "string" ? config.pos : "",
    ruleKind: config.ruleKind === "word" || config.ruleKind === "sentence" ? config.ruleKind : "",
    // `null` = every rule, an empty list = none. Only an explicit array counts
    // as a selection, so a missing field can never empty a quiz.
    ruleIds: Array.isArray(config.ruleIds)
      ? config.ruleIds.filter((id): id is number => typeof id === "number")
      : null,
    questionCount,
    timeLimitEnabled: config.timeLimitEnabled !== false,
    timeLimitSeconds: Number(config.timeLimitSeconds) || 30,
    // The ids themselves arrive separately (see `GenerateBody`), so the prompt
    // builder only needs to know the source is a narrowed set.
    retryMissed: config.retryMissed === true,
    // Opt-in, never inferred from `starredIds` being non-empty.
    starredOnly: config.starredOnly === true,
    types: types as QuizConfig["types"],
    distribution: config.distribution === "random" ? "random" : "even",
    difficulty:
      config.difficulty === "easy" || config.difficulty === "hard" ? config.difficulty : "normal",
  };
}

/** The ids to scope each kind to. */
interface SourceFilters {
  /** Whether the user actually asked for a starred-only scope. */
  starredOnly: boolean;
  starredIds: number[];
  missedWordIds: number[];
  missedRuleIds: number[];
}

/**
 * Fetch the library items a quiz is drawn from, owner-scoped.
 *
 * Reuses the study deck queries so a quiz over "list 3, verbs only" draws the
 * exact same slice of the library a flashcard session would. A quiz may span
 * several kinds at once, in which case each kind is fetched (and filtered) on
 * its own — a rule id and a word id can collide, so the id lists must not be
 * mixed together.
 */
async function loadSourceItems(
  ownerId: string,
  config: QuizConfig,
  filters: SourceFilters
): Promise<{ rules: RuleDetail[]; words: WordDetail[]; totalAvailable: number }> {
  const wantsWords = config.sources.includes("words");
  const wantsPhrases = config.sources.includes("phrases");
  const wantsRules = config.sources.includes("rules");

  // "Retry my misses" wins over a starred-only scope. An empty miss list for a
  // kind means "nothing matched", not "no filter" — `cardIdClause` turns it
  // into a clause that deliberately matches nothing. `null`, rather than an
  // empty array, is what says "no id scoping at all".
  const scopeFor = (missed: number[]): number[] | null => {
    if (config.retryMissed) return missed;
    return filters.starredOnly ? filters.starredIds : null;
  };

  /**
   * Narrow a scope by an explicit id list.
   *
   * `null` means the user asked for every id, so the scope stands as it is; an
   * empty list means they cleared the selection, which must match nothing. The
   * two are different questions and must not collapse into the same answer.
   */
  const intersect = (scope: number[] | null, explicit: number[] | null): number[] | undefined => {
    if (explicit === null) return scope ?? undefined;
    if (scope === null) return explicit;
    return scope.filter((id) => explicit.includes(id));
  };

  let totalAvailable = 0;
  let rules: RuleDetail[] = [];
  let words: WordDetail[] = [];

  if (wantsRules) {
    const ruleKind: RuleKind | null =
      config.ruleKind === "word" || config.ruleKind === "sentence" ? config.ruleKind : null;
    const filter = intersect(scopeFor(filters.missedRuleIds), config.ruleIds);
    const [count, deck] = await Promise.all([
      countRules(ownerId, ruleKind, filter, config.tags, config.excludedTags),
      getRuleStudyDeck(ownerId, MAX_SOURCE_ITEMS, ruleKind, filter, config.tags, config.excludedTags),
    ]);
    totalAvailable += count;
    rules = deck;
  }

  if (wantsWords || wantsPhrases) {
    // Explicit lists → lists matching the tags → everything.
    let listIds: number[];
    if (config.lists.length > 0) {
      listIds = config.lists;
    } else if (config.tags.length > 0 || config.excludedTags.length > 0) {
      // Exclusion counts on its own: "everything except #archived" is a filter,
      // so the all-lists fallback must not swallow it.
      listIds = await listIdsByTags(ownerId, config.tags, config.excludedTags);
    } else {
      listIds = await listAllListIds(ownerId);
    }

    const filter = scopeFor(filters.missedWordIds) ?? undefined;
    // The part-of-speech filter only applies to words; phrases are all
    // `pos = 'phrase'`.
    const pos = wantsWords && config.pos ? config.pos : null;

    const kinds = [
      wantsWords ? ("words" as const) : null,
      wantsPhrases ? ("phrases" as const) : null,
    ].filter((kind): kind is "words" | "phrases" => kind !== null);
    // Split the item budget so a mixed quiz still sees some of both kinds.
    const perKind = Math.max(1, Math.floor(MAX_SOURCE_ITEMS / kinds.length));

    const results = await Promise.all(
      kinds.map(async (kind) => {
        const [count, deck] = await Promise.all([
          countWordsInLists(ownerId, listIds, pos, kind, filter),
          getStudyDeck(ownerId, listIds, perKind, pos, kind, filter),
        ]);
        return { count, deck };
      })
    );

    for (const result of results) {
      totalAvailable += result.count;
      words = [...words, ...result.deck];
    }
  }

  return { rules, words, totalAvailable };
}

export async function action({ request, context }: Route.ActionArgs): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  // Rate limit first — before parsing or any database work.
  const limited = await enforceRateLimit("AI_LIMITER", getClientIp(request), "ai");
  if (!limited.allowed) {
    return Response.json(
      { error: "Too many quiz generations. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds ?? 60) } }
    );
  }

  const owner = context.get(ownerContext);
  // Quiz generation is for signed-in users only (see the route doc comment).
  if (!owner || !owner.user) {
    return Response.json(
      { error: "Please sign in to generate a quiz — the AI generation is limited to accounts." },
      { status: 401 }
    );
  }
  const ownerId = owner.ownerId;

  if (!isAiConfigured()) {
    return Response.json(
      {
        error:
          "AI generation is not configured. Set any one of GEMINI_API_KEY, " +
          "AIHUBMIX_API_KEY, OPENROUTER_API_KEY, COMET_API_KEY, GROQ_API_KEY " +
          "or NVIDIA_API_KEY.",
      },
      { status: 503 }
    );
  }

  let body: GenerateBody;
  try {
    body = (await request.json()) as GenerateBody;
  } catch {
    return badRequest("Expected a JSON body.");
  }

  const config = readConfig(body.config);
  if (!config) {
    return badRequest("The quiz configuration was missing or malformed.");
  }

  const asIds = (value: unknown): number[] =>
    Array.isArray(value) ? value.filter((id): id is number => typeof id === "number") : [];

  const items = await loadSourceItems(ownerId, config, {
    starredOnly: config.starredOnly,
    starredIds: asIds(body.starredIds),
    missedWordIds: asIds(body.missedWordIds),
    missedRuleIds: asIds(body.missedRuleIds),
  });

  if (items.rules.length + items.words.length === 0) {
    const kinds = config.sources.map((kind) => kind);
    return Response.json(
      {
        error: `No ${kinds.join(" or ")} matched this selection — add some content or widen the filters.`,
      },
      { status: 422 }
    );
  }

  const prompt = buildQuizPrompt(config, items);

  return streamGeneration(config, prompt, items.totalAvailable);
}

/**
 * Run the fallback walk and stream what happens as newline-delimited JSON.
 *
 * The buffered version of this route could only report which model answered
 * *after* the fact, so the loading panel had to fake a model-by-model walk on a
 * timer — and would regularly name a model the server had already moved past.
 * Every event below is emitted from inside the walk, so the panel describes what
 * is actually happening.
 *
 * Failures raised *before* generation (rate limit, auth, bad config, "nothing
 * matched") are still plain JSON responses — only this part streams.
 */
function streamGeneration(
  config: QuizConfig,
  prompt: BuiltPrompt,
  totalAvailable: number
): Response {
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  /** A cancelled stream must not surface as an unhandled rejection. */
  const send = (event: unknown) => {
    writer.write(encoder.encode(`${JSON.stringify(event)}\n`)).catch(() => {});
  };

  void (async () => {
    try {
      const outcome = await generateWithFallback(prompt.messages, {
        onAttempt: (attempt) =>
          send({
            type: "attempt",
            model: attempt.model,
            index: attempt.index,
            total: attempt.total,
          }),
        onRound: (info) =>
          send({
            type: "round",
            round: info.round,
            totalRounds: info.totalRounds,
            detail: info.detail,
          }),
        onAttemptDone: (attempt) => send({ type: "attemptDone", attempt }),
        // The same parser the route runs below, as a gate: an answer we cannot
        // read is not an answer, so the walk should try the next model rather
        // than stop here. Parsing twice is cheap and keeps the format knowledge
        // in one place — `ai.server.ts` only sees a boolean.
        accept: (text) => {
          try {
            parseQuizQuestions(text, config.questionCount);
            return true;
          } catch {
            return false;
          }
        },
      });

      let parsed;
      try {
        parsed = parseQuizQuestions(outcome.text, config.questionCount);
      } catch (error) {
        // The model answered but produced nothing usable. Report which model,
        // so the message is actionable rather than generic.
        send({
          type: "error",
          error: `${outcome.model} returned questions we could not read (${
            error instanceof Error ? error.message : "unknown"
          }). Try again.`,
          attempts: outcome.attempts,
        });
        return;
      }

      // Answers without a source id still work; they just won't be logged
      // against a library item (the runner records stats only for questions
      // that have one).
      send({
        type: "result",
        questions: parsed.questions,
        model: outcome.model,
        attempts: outcome.attempts,
        dropped: parsed.dropped,
        topicSummary: prompt.topicSummary,
        totalAvailable,
      });
    } catch (error) {
      send({
        type: "error",
        error:
          error instanceof Error
            ? `Every model in the fallback chain failed. Last error — ${error.message}`
            : "Every model in the fallback chain failed.",
      });
    } finally {
      // Queued writes flush in order, so closing here cannot truncate them.
      void writer.close().catch(() => {});
    }
  })();

  return new Response(readable, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      // Ask intermediaries not to buffer the stream back into a single chunk.
      "x-accel-buffering": "no",
    },
  });
}
