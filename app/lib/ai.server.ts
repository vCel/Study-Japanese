/**
 * Multi-provider text generation with an ordered model fallback.
 *
 * The chain is walked in order; each attempt gets its own timeout and the walk
 * aborts early when the failure tells us every remaining model on a provider
 * would fail the same way.
 *
 * What "the same way" means is per-provider, and the difference is load
 * bearing. Gemini and GLM cap the *account* — a 429 there means the sibling
 * models will fail too, so the walk leaves the provider. AIHubMix and
 * OpenRouter are aggregators whose free tiers are capped per *model*
 * (AIHubMix meters `xiaomi-mimo-v2.5-free` at 5 rpm / 100 rpd on its own), so
 * a 429 there costs one row and says nothing about the provider's other
 * models. Treating both as account-level is how you silently lose a healthy
 * fallback — the same shape of bug as the GLM `1305` mix-up documented in
 * `classifyGlm`.
 *
 * Runs in the Worker (`env` from `cloudflare:workers`), never in the browser —
 * the keys must not reach the client bundle.
 */

import { env } from "cloudflare:workers";

import type { GenerationAttempt } from "./quiz-types";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

type Provider = "gemini" | "glm" | "aihubmix" | "openrouter";

/** One entry in the fallback chain. */
interface ModelSpec {
  model: string;
  provider: Provider;
  /**
   * Extra fields merged into the request body, for OpenAI-compatible
   * providers only (Gemini builds its own body and ignores this).
   *
   * Exists for one reason: switching off a model's thinking mode. See the
   * `xiaomi-mimo-v2.5-free` entry below.
   */
  extraBody?: Record<string, unknown>;
}

/**
 * Ordered exactly as specified: the AIHubMix free model first, then Gemini
 * newest-first down to 3.5, then GLM, then the two remaining fallbacks.
 * Everything shares the same interface so the walk below stays one loop.
 */
export const MODEL_CHAIN: ModelSpec[] = [
  {
    model: "xiaomi-mimo-v2.5-free",
    provider: "aihubmix",
    // Thinking is on by default here, and on a realistic 3-question request
    // this model spends ~1900-3700 reasoning tokens on top of a ~470-character
    // answer. Measured 2026-09-15: 42s and 78s on two runs — i.e. every attempt
    // would blow the 25s ceiling and hand the chain nothing but a wasted
    // timeout. With thinking off the same request answers in ~8.5s with
    // `reasoning_tokens: 0` and valid JSON.
    //
    // `thinking.type` is the documented switch. The chat-completions face has
    // no `reasoning.effort` (that is responses-API only), and the two
    // undocumented spellings that also worked — `chat_template_kwargs` and a
    // top-level `enable_thinking` — are not worth depending on.
    extraBody: { thinking: { type: "disabled" } },
  },
  { model: "gemini-3.8-flash", provider: "gemini" },
  { model: "gemini-3.7-flash", provider: "gemini" },
  { model: "gemini-3.6-flash", provider: "gemini" },
  { model: "gemini-3.5-flash", provider: "gemini" },
  { model: "glm-4.7-flash", provider: "glm" },
  { model: "glm-4.5-flash", provider: "glm" },
  { model: "hy3-free", provider: "aihubmix" },
  { model: "inclusionai/ling-3.0-flash-vl:free", provider: "openrouter" },
];

/** Per-attempt ceiling. Long enough for a full question set, short enough that
 * the chain can't outlive the request. */
const ATTEMPT_TIMEOUT_MS = 25_000;

/**
 * Ceiling for the whole walk — every pass together, not each pass, so the
 * request still returns a response when a slow cascade fails everywhere.
 *
 * This is what decides whether the second pass happens at all, and it is why the
 * pass is only reachable when the first one failed *fast*: nine rows that each
 * burn the full 25s ceiling need 225s on their own, whereas a 429/503 storm is
 * over in a couple of seconds and leaves the budget almost untouched. Raising
 * this is a product decision, not a bug fix — see `AI.md`.
 */
const TOTAL_BUDGET_MS = 95_000;

/**
 * How a failed attempt should affect the walk.
 *  * `ratelimit`          → *this model* is out of quota; siblings may be fine
 *  * `provider-ratelimit` → the *account* is out; skip the provider's siblings
 *  * `overloaded`         → transient provider-wide load; the next model is
 *                           tried, and the second pass is the retry
 *  * `timeout`            → this attempt stalled; try the next model
 *  * `error`              → anything else (bad request, bad key, bad output)
 *
 * The two rate-limit kinds exist because only some providers can answer the
 * question "are your siblings out too?" — see the file header.
 */
type FailureKind = "ratelimit" | "provider-ratelimit" | "overloaded" | "timeout" | "error";

class GenerationError extends Error {
  constructor(
    readonly kind: FailureKind,
    message: string
  ) {
    super(message);
    this.name = "GenerationError";
  }
}

export interface GenerateOptions {
  /**
   * Called before each attempt, so the UI can say which model is being tried
   * and show a loading bar.
   */
  onAttempt?: (attempt: { model: string; provider: string; index: number; total: number }) => void;
  /**
   * Called when the walk has been round the whole chain without an answer and is
   * about to start again. The UI needs this because the progress bar jumps back
   * to the first model, which otherwise looks like a glitch.
   */
  onRound?: (info: { round: number; totalRounds: number; detail: string }) => void;
  /**
   * Called whenever an attempt settles — succeeded, failed, or skipped because
   * its provider was already known to be rate limited.
   *
   * This is what lets a streaming caller report the walk *as it happens*. The
   * whole chain is also returned in `GenerateOutcome.attempts`, but only once
   * it is over, which is too late for a progress panel.
   */
  onAttemptDone?: (attempt: GenerationAttempt) => void;
  /**
   * Decide whether an answer is usable, so a model that returns HTTP 200 with
   * output the caller cannot read doesn't end the walk.
   *
   * This is not hypothetical: AIHubMix answers a free request from an account
   * that has used up its trials with **200** and the plain text "Sorry, to
   * prevent abuse of free resources, accounts that have not been recharged can
   * only try 10 times." Returning that would stop the chain on its first row
   * and take every Gemini fallback down with it.
   *
   * A predicate rather than a parser: the caller owns the format, so
   * `ai.server.ts` stays ignorant of quizzes.
   */
  accept?: (text: string) => boolean;
}

export interface GenerateOutcome {
  text: string;
  model: string;
  attempts: GenerationAttempt[];
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/**
 * Gemini signals an exhausted account with HTTP 429 (or `RESOURCE_EXHAUSTED` /
 * `QUOTA` in the body). That is the case the caller's fallback rule cares
 * about — it means every Gemini model will fail, so we leave the provider.
 */
function classifyGemini(status: number, body: string): FailureKind {
  if (status === 429) return "provider-ratelimit";
  if (/RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(body)) return "provider-ratelimit";
  if (status === 503 || /UNAVAILABLE|overloaded/i.test(body)) return "overloaded";
  return "error";
}

/**
 * GLM (Z.AI / BigModel) reports problems in a numeric `code`, which arrives as a
 * **string** — so it is compared as one. The code rides either a 200 body or a
 * 429, which is why it has to be read *before* the status is considered.
 *
 *   1302           account concurrency limit  → provider-level, skip ahead
 *   1305           platform overload          → transient, worth a retry
 *   1308/1310/1316-1321 usage/plan caps        → out until reset, skip ahead
 *   1113           arrears                     → won't recover, skip the provider
 *   1001/1003/1005 auth                        → won't recover
 *   1211           model not found             → this model only
 *   1301           content safety block        → this attempt only
 */
function classifyGlm(status: number, code: string | undefined, body: string): FailureKind {
  // The code is the more specific signal, so it wins over the status. Checking
  // `status === 429` first made the `1305` case below unreachable — Z.AI sends
  // 1305 *with* a 429, and a blanket 429 → ratelimit marks the whole provider
  // exhausted, skipping a model that would have answered. Observed 2026-09-15:
  // 3/3 probes of `glm-4.7-flash` returned 429/1305 while `glm-4.5-flash`
  // returned 200 from the same key at the same moment.
  switch (code) {
    case "1302":
    case "1308":
    case "1310":
    case "1316":
    case "1317":
    case "1318":
    case "1319":
    case "1320":
    case "1321":
    case "1113":
    case "1001":
    case "1003":
    case "1005":
      return "provider-ratelimit";
    case "1305":
      return "overloaded";
  }

  if (status === 429) return "provider-ratelimit";
  if (status === 503) return "overloaded";
  if (/overload|busy|try again/i.test(body)) return "overloaded";
  return "error";
}

/**
 * AIHubMix and OpenRouter, which both document the same status ladder.
 *
 * A 429 is deliberately **model**-scoped here. AIHubMix meters each free model
 * on its own (`xiaomi-mimo-v2.5-free`: 5 rpm / 100 rpd) and OpenRouter forwards
 * to a single upstream provider per free model, so neither 429 tells us the
 * account is out. Escalating it would let a rate limit on the *first* row skip
 * `hy3-free` seven rows later.
 */
function classifyOpenAiCompatible(status: number, body: string): FailureKind {
  if (status === 429) return "ratelimit";
  // OpenRouter: no credits left. Account-wide, so the provider is done.
  if (status === 402) return "provider-ratelimit";
  // AIHubMix: `insufficient_user_quota` on the key, or a suspended account.
  if (status === 403 && /quota|suspend/i.test(body)) return "provider-ratelimit";
  // 503 is AIHubMix's "no channel can serve this / upstream is throttling" and
  // OpenRouter's "upstream is down". Both are worth the single retry.
  if (status >= 500) return "overloaded";
  if (/overload|try again|temporarily/i.test(body)) return "overloaded";
  // 400 and 404 land here, which is what we want for AIHubMix's
  // `no_available_channel`: it means *this model* has no upstream right now, so
  // the walk should move on rather than abandon the provider.
  return "error";
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

function geminiKey(): string {
  return (env.GEMINI_API_KEY ?? "").trim();
}

function glmKey(): string {
  return (env.GLM_API_KEY ?? "").trim();
}

function aihubmixKey(): string {
  return (env.AIHUBMIX_API_KEY ?? "").trim();
}

function openrouterKey(): string {
  return (env.OPENROUTER_API_KEY ?? "").trim();
}

/** True when at least one provider has a key, so the route can fail early. */
export function isAiConfigured(): boolean {
  return (
    geminiKey().length > 0 ||
    glmKey().length > 0 ||
    aihubmixKey().length > 0 ||
    openrouterKey().length > 0
  );
}

/**
 * Gemini `generateContent`. `messages[0]` (if it is a system message) becomes
 * `systemInstruction`; the rest are collapsed into one user turn, which is all
 * a single-shot generation needs.
 */
async function callGemini(
  spec: ModelSpec,
  messages: ChatMessage[],
  signal: AbortSignal
): Promise<string> {
  const key = geminiKey();
  if (!key) throw new GenerationError("error", "GEMINI_API_KEY is not set.");

  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const user = messages
    .filter((message) => message.role !== "system")
    .map((message) => message.content)
    .join("\n\n");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${spec.model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: user }] }],
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        generationConfig: { temperature: 0.9, responseMimeType: "application/json" },
      }),
      signal,
    }
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new GenerationError(
      classifyGemini(response.status, body),
      `HTTP ${response.status}: ${body.slice(0, 200)}`
    );
  }

  const json = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    promptFeedback?: { blockReason?: string };
  };

  const blocked = json.promptFeedback?.blockReason;
  if (blocked) {
    throw new GenerationError("error", `Gemini refused the prompt (${blocked}).`);
  }

  // A response can be split across several parts — join them all.
  const text = (json.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();

  if (!text) throw new GenerationError("error", "Gemini returned an empty response.");
  return text;
}

/** GLM via the Z.AI OpenAI-compatible chat-completions endpoint. */
async function callGlm(
  spec: ModelSpec,
  messages: ChatMessage[],
  signal: AbortSignal
): Promise<string> {
  const key = glmKey();
  if (!key) throw new GenerationError("error", "GLM_API_KEY is not set.");

  const response = await fetch("https://api.z.ai/api/paas/v4/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: spec.model,
      messages,
      temperature: 0.9,
      max_tokens: 8000,
      stream: false,
    }),
    signal,
  });

  const body = await response.text();

  if (!response.ok) {
    throw new GenerationError(
      classifyGlm(response.status, extractGlmCode(body), body),
      `HTTP ${response.status}: ${body.slice(0, 200)}`
    );
  }

  let json: {
    choices?: { message?: { content?: string } }[];
    error?: { code?: string | number; message?: string };
  };
  try {
    json = JSON.parse(body) as typeof json;
  } catch {
    throw new GenerationError("error", "GLM returned a non-JSON response.");
  }

  // Errors can also ride a 200 body.
  if (json.error) {
    const code = json.error.code === undefined ? undefined : String(json.error.code);
    throw new GenerationError(
      classifyGlm(response.status, code, json.error.message ?? body),
      json.error.message ?? `GLM error ${code}`
    );
  }

  const text = json.choices?.[0]?.message?.content?.trim();
  if (!text) throw new GenerationError("error", "GLM returned an empty response.");
  return text;
}

function extractGlmCode(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error?: { code?: string | number }; code?: string | number };
    const code = parsed.error?.code ?? parsed.code;
    return code === undefined ? undefined : String(code);
  } catch {
    return undefined;
  }
}

/** Where each aggregator's OpenAI-compatible chat-completions endpoint lives. */
const AGGREGATOR_ENDPOINTS: Record<"aihubmix" | "openrouter", string> = {
  aihubmix: "https://aihubmix.com/v1/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
};

/**
 * Chat-completions transport for AIHubMix and OpenRouter, which share a wire
 * format and a status ladder.
 *
 * No `response_format`: the prompt already asks for JSON and the parser is
 * tolerant, and asking anyway is not free — OpenRouter answers a
 * `json_object` request for `ling-3.0-flash-vl` with
 * `400 ... does not support feature: structured-outputs`. A 400 there would
 * kill an otherwise healthy attempt, so the request stays as plain as GLM's.
 *
 * `callGlm` above is a near-copy of this on purpose: its classifier reads a
 * numeric `code` no other provider sends, and that path is verified against
 * live Z.AI behaviour, so it is left alone rather than generalised into here.
 */
async function callOpenAiCompatible(
  spec: ModelSpec,
  messages: ChatMessage[],
  signal: AbortSignal
): Promise<string> {
  const provider = spec.provider as "aihubmix" | "openrouter";
  const key = provider === "aihubmix" ? aihubmixKey() : openrouterKey();
  if (!key) {
    throw new GenerationError("error", `${provider.toUpperCase()}_API_KEY is not set.`);
  }

  const response = await fetch(AGGREGATOR_ENDPOINTS[provider], {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: spec.model,
      messages,
      temperature: 0.9,
      max_tokens: 8000,
      stream: false,
      ...spec.extraBody,
    }),
    signal,
  });

  const body = await response.text();

  if (!response.ok) {
    throw new GenerationError(
      classifyOpenAiCompatible(response.status, body),
      `HTTP ${response.status}: ${body.slice(0, 200)}`
    );
  }

  let json: {
    choices?: { message?: { content?: string } }[];
    error?: { code?: string | number; message?: string };
  };
  try {
    json = JSON.parse(body) as typeof json;
  } catch {
    throw new GenerationError("error", `${provider} returned a non-JSON response.`);
  }

  // OpenRouter in particular can ride an error on an otherwise 200 body.
  if (json.error) {
    throw new GenerationError(
      classifyOpenAiCompatible(response.status, json.error.message ?? body),
      json.error.message ?? `${provider} error`
    );
  }

  const text = json.choices?.[0]?.message?.content?.trim();
  if (!text) throw new GenerationError("error", `${provider} returned an empty response.`);
  return text;
}

function callModel(
  spec: ModelSpec,
  messages: ChatMessage[],
  signal: AbortSignal
): Promise<string> {
  switch (spec.provider) {
    case "gemini":
      return callGemini(spec, messages, signal);
    case "glm":
      return callGlm(spec, messages, signal);
    default:
      return callOpenAiCompatible(spec, messages, signal);
  }
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

/**
 * How many times the whole chain is walked. The first pass gives every model one
 * shot; the second exists because the failures worth repeating — a 429/503
 * storm, an answer we could not read — come back in well under a second, so a
 * repeat walk is cheap exactly when it is useful. A model that burned its whole
 * 25s timeout is not retried at all, which is the point: one slow model must not
 * get two turns while eight others wait.
 */
const WALK_PASSES = 2;

/**
 * Try each model in `MODEL_CHAIN` until one answers, then walk the whole chain
 * once more if none did.
 *
 * A rate-limit failure skips ahead — how far depends on its scope: an
 * account-level one abandons the provider (so a Gemini 429 lands straight on
 * GLM), a model-level one costs only that row. Everything else moves straight on
 * to the next model rather than retrying itself; the second pass is the retry.
 */
export async function generateWithFallback(
  messages: ChatMessage[],
  options: GenerateOptions = {}
): Promise<GenerateOutcome> {
  const attempts: GenerationAttempt[] = [];
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  /**
   * Providers whose *account* is already known to be rate limited.
   *
   * Deliberately not reset between passes: an exhausted account does not come
   * back inside the seconds a pass takes, so re-walking its rows would only
   * spend budget to be told the same thing again.
   */
  const exhausted = new Set<string>();
  let lastDetail = "No model in the fallback chain answered.";

  /** Keep the collected list and any live listener in step. */
  const record = (attempt: GenerationAttempt) => {
    attempts.push(attempt);
    options.onAttemptDone?.(attempt);
  };

  for (let pass = 0; pass < WALK_PASSES; pass++) {
    // The progress bar is about to jump back to the first model, so say why.
    if (pass > 0) {
      options.onRound?.({ round: pass + 1, totalRounds: WALK_PASSES, detail: lastDetail });
    }

    for (let index = 0; index < MODEL_CHAIN.length; index++) {
      const spec = MODEL_CHAIN[index];

      // A 429 on one Gemini model means the account is out — don't spend the
      // other three attempts finding out.
      if (exhausted.has(spec.provider)) {
        // Reported on the pass that discovered it, once. A skip is a fact about
        // the provider rather than about each pass, and repeating it would fill
        // the attempt list with identical rows.
        if (pass === 0) {
          record({
            model: spec.model,
            provider: spec.provider,
            outcome: "ratelimit",
            detail: `${spec.provider} is out of quota — skipped.`,
            ms: 0,
          });
        }
        continue;
      }

      if (Date.now() >= deadline) {
        lastDetail = "Ran out of time before any model answered.";
        break;
      }

      options.onAttempt?.({
        model: spec.model,
        provider: spec.provider,
        index,
        total: MODEL_CHAIN.length,
      });

      const started = Date.now();
      try {
        const text = await callModel(spec, messages, AbortSignal.timeout(ATTEMPT_TIMEOUT_MS));

        // A 200 is not proof of a usable answer — see `accept` in
        // GenerateOptions. Treat an unusable one as a failed attempt, because
        // returning it would end the walk on a model that has nothing to say.
        if (options.accept && !options.accept(text)) {
          const detail = "answered with output we could not use";
          record({
            model: spec.model,
            provider: spec.provider,
            outcome: "error",
            detail,
            ms: Date.now() - started,
          });
          lastDetail = `${spec.model}: ${detail}`;
          continue; // next model — every row gets one shot per pass
        }

        record({
          model: spec.model,
          provider: spec.provider,
          outcome: "ok",
          ms: Date.now() - started,
        });
        return { text, model: spec.model, attempts };
      } catch (error) {
        const ms = Date.now() - started;
        const kind: FailureKind =
          error instanceof GenerationError
            ? error.kind
            : error instanceof DOMException && error.name === "TimeoutError"
              ? "timeout"
              : "timeout";
        const detail =
          error instanceof Error ? error.message : "Unknown error";

        const outcome: GenerationAttempt["outcome"] =
          kind === "ratelimit" || kind === "provider-ratelimit"
            ? "ratelimit"
            : kind === "overloaded"
              ? "overloaded"
              : kind === "timeout"
                ? "timeout"
                : "error";
        record({ model: spec.model, provider: spec.provider, outcome, detail, ms });
        lastDetail = `${spec.model}: ${detail}`;

        if (kind === "ratelimit" || kind === "provider-ratelimit") {
          // Only an account-level cap says anything about the sibling models.
          // A per-model one (the aggregators) leaves the rest of the provider
          // in play, which matters because AIHubMix holds two rows.
          if (kind === "provider-ratelimit") exhausted.add(spec.provider);
        }
        // No retry here on purpose: the pass moves on to the next model, and
        // the second pass is the retry.
      }
    }

    // Out of time mid-pass. Another pass cannot fit, so stop rather than
    // re-walking rows only to break on the same deadline again.
    if (Date.now() >= deadline) break;
  }

  throw new GenerationError("error", lastDetail);
}

/** Exposed for the API route's error reporting. */
export { GenerationError };
