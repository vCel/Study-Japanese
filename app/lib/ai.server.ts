/**
 * Multi-provider text generation with an ordered model fallback.
 *
 * The chain is walked in order; each attempt gets its own timeout and the walk
 * aborts early when the failure tells us every remaining model on a provider
 * would fail the same way.
 *
 * What "the same way" means is per-provider, and the difference is load
 * bearing. Gemini and GLM cap the *account* — a 429 there means the sibling
 * models will fail too, so the walk leaves the provider. The OpenAI-compatible
 * providers are usually the other kind: their free tiers are capped per
 * *model*, so a 429 there costs one row and says nothing about the provider's
 * other models. AIHubMix meters `xiaomi-mimo-v2.5-free` at 5 rpm / 100 rpd on
 * its own, OpenRouter forwards to a single upstream per free model, and Groq
 * publishes its limits per model. AIHubMix and OpenRouter each hold two rows
 * here, so this distinction has teeth: treating those as account-level is how
 * you silently lose a healthy fallback — the same shape of bug as the GLM
 * `1305` mix-up documented in `classifyGlm`.
 *
 * OpenCode Zen is the one provider with an extra requirement: its free tier
 * refuses a request without the `x-opencode-session` header (a per-conversation
 * UUID) and a `User-Agent` — regardless of which key, or none, is sent. With
 * the header all three rows answer: MiMo over chat-completions, the two Muse
 * Spark rows over the Responses API (see the MODEL_CHAIN note).
 *
 * Runs in the Worker (`env` from `cloudflare:workers`), never in the browser —
 * the keys must not reach the client bundle.
 */

import { env } from "cloudflare:workers";

import type { GenerationAttempt, Provider } from "./quiz-types";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** One entry in the fallback chain. */
interface ModelSpec {
  model: string;
  provider: Provider;
  /**
   * Extra fields merged into the request body, for OpenAI-compatible
   * providers only (Gemini builds its own body and ignores this).
   *
   * Exists for one reason: controlling how much a model thinks. See the
   * `xiaomi-mimo-v2.5-free` and `gpt-5-nano` entries below.
   */
  extraBody?: Record<string, unknown>;
  /**
   * Wire format, for the OpenAI-compatible providers only. Defaults to
   * chat-completions; `"responses"` routes the row to the OpenAI Responses API
   * instead — the Muse Spark rows on OpenCode Zen live there.
   */
  endpoint?: "responses";
}

/**
 * Ordered as specified: OpenCode's three free models first — MiMo speaks
 * chat-completions, the two Muse Spark rows speak the Responses API — then the
 * AIHubMix free model, then Gemini newest-first down to 3.5, then OpenRouter's
 * Gemma, then the Groq Qwen row, then the two remaining fallbacks, with
 * Comet's `gpt-5-nano` last.
 *
 * Two pairs of rows are commented out, not deleted — GLM's two and NVIDIA's two.
 * Both notes are at their old positions and say what has to change before they
 * come back. Everything shares the same interface so the walk below stays one
 * loop.
 */
export const MODEL_CHAIN: ModelSpec[] = [
  // --- OpenCode Zen. First, as specified. ---
  //
  // The free tier is reachable from any client, but only with the session
  // header. Without `x-opencode-session` (a per-conversation UUID) and a
  // `User-Agent`, every free model is refused — verified live 2026-09-16 with
  // no key, the `public` sentinel, and the real key alike:
  //
  //   400 {"type":"error","error":{"type":"MissingSessionID","message":
  //        "Error from provider (Console): OpenCode's free tier can only be
  //        used in OpenCode"}}
  //
  // The header is the fix: the Zen docs' OpenAI-SDK snippet carries exactly
  // `x-opencode-session` + `User-Agent`. `generateWithFallback` makes one
  // session UUID per generation and the OpenCode rows send it, so
  // `mimo-v2.5-free` answers in about a second.
  //
  // `deepseek-v4-flash-free` was removed at the owner's request: its promo has
  // ended and the relay answers `400 "Model is unavailable"`.
  { model: "mimo-v2.5-free", provider: "opencode" },
  // Muse Spark lives on the OpenAI Responses API: the docs route the GPT /
  // Grok / Muse-Spark family to `/responses`, and chat/completions answers
  // `500 Internal server error` even with the session header. These rows carry
  // `endpoint: "responses"` so `callOpenAiCompatible` speaks Responses to them.
  { model: "muse-spark-1.3-contributor-free", provider: "opencode", endpoint: "responses" },
  { model: "muse-spark-1.2-contributor-free", provider: "opencode", endpoint: "responses" },
  // NVIDIA's `deepseek-v4-flash-0731` and `moonshotai/kimi-k3` were specified
  // for the top of the chain, ahead of `xiaomi-mimo-v2.5-free`, and are
  // commented out at the owner's request.
  //
  // Measured 2026-09-15 on a trivial one-item request: both returned nothing at
  // all within 90s, and again within 150s on a second attempt. `kimi-k3` never
  // answered. `deepseek-v4-flash-0731` answered exactly once, at 115s, and only
  // with `reasoning_effort: "low"` — which is *not* a fix, since 115s is still
  // four and a half times the ceiling below. Against `ATTEMPT_TIMEOUT_MS` these
  // are a guaranteed wasted timeout on every generation, and `deepseek` sits
  // first, so it would spend 25s of the 95s budget before the walk reached a
  // model that can actually answer.
  //
  // Restore only with a measurement showing they fit the ceiling.
  // { model: "deepseek-ai/deepseek-v4-flash-0731", provider: "nvidia" },
  // { model: "moonshotai/kimi-k3", provider: "nvidia" },
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
  { model: "qwen/qwen3.8-27b", provider: "groq" },
  { model: "google/gemma-4-26b-a4b-it:free", provider: "openrouter", },
  // `glm-4.5-flash` are hybrid reasoning models with dynamic thinking on by
  // default, and the rows never switched it off. Leaving them in the chain
  // while that is unresolved spends a 25s timeout to learn nothing. Restore
  // them (and re-add `glm` to the header's provider list) once their thinking
  // is either disabled like `xiaomi-mimo-v2.5-free` or measured to fit.
  // { model: "glm-4.7-flash", provider: "glm" },
  // { model: "glm-4.5-flash", provider: "glm" },
  { model: "hy3-free", provider: "aihubmix" },
  { model: "inclusionai/ling-3.0-flash-vl:free", provider: "openrouter" },
  {
    model: "nvidia/nemotron-3-ultra-550b-a55b",
    provider: "nvidia",
    // Second last, as specified. The one NVIDIA row that needed nothing: 3.6s
    // and 191 reasoning characters unforced, comfortably inside the ceiling. No
    // `reasoning_effort` — it was never shown to need it, and sending an
    // unverified param is how you turn a healthy row into a 400.
  },
  {
    model: "gpt-5-nano",
    provider: "comet",
    // Also a reasoning model, and the slowest of the four new rows without
    // help: 7.1s and 779 completion tokens for one trivial item, versus 3.7s
    // and 160 at `reasoning_effort: "low"`.
    extraBody: { reasoning_effort: "low" },
  },
];

/** Per-attempt ceiling. Long enough for a full question set, short enough that
 * the chain can't outlive the request. */
const ATTEMPT_TIMEOUT_MS = 25_000;

/**
 * Ceiling for the whole walk — every pass together, not each pass, so the
 * request still returns a response when a slow cascade fails everywhere.
 *
 * This is what decides whether the second pass happens at all, and it is why the
 * pass is only reachable when the first one failed *fast*: the fifteen rows that
 * each burn the full 25s ceiling need 375s on their own, whereas a 429/503 storm
 * is over in a couple of seconds and leaves the budget almost untouched. Raising
 * this is a product decision, not a bug fix — see `AI.md`.
 *
 * The OpenCode group at the top is cheap either way: `mimo-v2.5-free` answers
 * in about a second, and the two Muse Spark rows, when reached, stay inside a
 * fraction of it.
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
 * The OpenAI-compatible providers, which all document the same status ladder.
 *
 * A 429 is deliberately **model**-scoped here. AIHubMix meters each free model
 * on its own (`xiaomi-mimo-v2.5-free`: 5 rpm / 100 rpd), OpenRouter forwards to
 * a single upstream provider per free model, and Groq publishes its RPM/TPM/RPD
 * per model — so none of their 429s tell us the account is out. Escalating it
 * would let a rate limit on the *first* row skip a sibling rows later, which
 * now matters for four providers: AIHubMix holds two rows, Comet two, Groq two,
 * NVIDIA two.
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
// What to tell the user
// ---------------------------------------------------------------------------

/**
 * A failed provider call, in one line a person can act on.
 *
 * The attempt list is the only place a user sees *why* generation failed, and
 * `HTTP 429: {"error":{"code":429,"message":"You exceeded your current quota..."}}`
 * does not answer the question they are actually asking — is this me, or is
 * this them? Known signatures get a sentence; anything unrecognised keeps a
 * trimmed snippet, because for a novel failure the raw text is the only useful
 * thing there is.
 */
function describeFailure(status: number, body: string): string {
  if (/insufficient|no resource package|arrears|balance/.test(body)) {
    return "no credit left on the account";
  }
  if (/exceeded your current quota|resource_exhausted|quota/i.test(body)) {
    return "quota exhausted";
  }
  if (/no_available_channel/i.test(body)) return "this model has no upstream right now";
  if (/overload|busy|try again|unavailable/i.test(body)) return "provider is overloaded";
  if (status === 402) return "no credit left on the account";
  if (status === 429) return "rate limited";
  if (status >= 500) return `provider unavailable (${status})`;
  const snippet = body.replace(/\s+/g, " ").trim().slice(0, 120);
  return snippet ? `HTTP ${status}: ${snippet}` : `HTTP ${status}`;
}

/**
 * The aggregators answer a **200 with a plain-text notice** instead of a
 * completion when the account cannot be used at all. AIHubMix's free tier says
 * so in as many words: "accounts that have not been recharged can only try 10
 * times."
 *
 * Left to the generic paths this surfaced as "returned a non-JSON response",
 * which tells the user nothing, and classified as a model-scoped `error` — so
 * the walk went on to try the provider's *other* row against an account that is
 * dead for both. It is an account-level failure and is reported as one.
 *
 * Returns null when the body is not a notice, so the caller can carry on.
 */
function accountNotice(body: string): string | null {
  const notice =
    /prevent abuse|recharged|insufficient[_ ]?(user[_ ])?(balance|quota)|no resource package|arrears/i.test(
      body
    );
  if (!notice) return null;
  if (/recharged|prevent abuse|free resources/i.test(body)) {
    return "free-trial allowance used up — the account needs a top-up";
  }
  return "no credit left on the account";
}

/**
 * OpenCode Zen refuses its free tier to requests that omit the session header,
 * with a structured error naming the missing session:
 *
 *   400 {"type":"error","error":{"type":"MissingSessionID","message":
 *        "Error from provider (Console): OpenCode's free tier can only be used
 *        in OpenCode"}}
 *
 * `callOpenAiCompatible` now sends the header (a per-conversation UUID plus a
 * `User-Agent`), so a healthy call never lands here. This classifier stays as
 * the safety net: if the relay changes its mind and the refusal reappears, it
 * must be account-scoped rather than model-scoped, or every OpenCode row would
 * be walked on both passes — six wasted round-trips per generation.
 *
 * Deliberately *not* folded into `accountNotice`. That function is about credit
 * and quota notices and returns a sentence about topping up; this is a different
 * species — nothing to do with billing, and no action available to the user.
 * Keeping them apart keeps both messages honest.
 *
 * Matched on the message rather than on the provider because the phrase is
 * unique to OpenCode and the classifier has no provider in hand.
 *
 * Returns the reason to show, or null when this is not the gate.
 */
function opencodeTierGate(body: string): string | null {
  if (!/free tier can only be used in OpenCode/i.test(body)) return null;
  return "OpenCode's free tier only works inside OpenCode's own client";
}

/**
 * The aggregator pair: `classifyOpenAiCompatible` plus the one signal that
 * ladder structurally cannot see — an account-level **notice in the body**.
 *
 * AIHubMix and OpenRouter are the only providers that can answer `200` with a
 * notice instead of a completion. The ladder above is written against statuses,
 * so it cannot catch a `200` carrying "accounts that have not been recharged can
 * only try 10 times". It also cannot catch a `429` whose body says the balance is
 * gone — it reads the status and calls that a model-scoped rate limit, which is
 * the wrong reading of a dead account.
 *
 * A notice is more specific than a status, so it wins. Both cases are
 * account-level: the walk should stop spending this provider's other rows on it.
 *
 * The OpenCode tier gate is checked here for that same reason. It arrives as a
 * 400, which the ladder reads as model-scoped, so leaving it out would spend
 * every OpenCode row per pass learning one account-level fact.
 */
function classifyAggregator(status: number, body: string): FailureKind {
  if (opencodeTierGate(body) || accountNotice(body)) return "provider-ratelimit";
  return classifyOpenAiCompatible(status, body);
}

/** The matching one-line reason, notice first for the same reason as above. */
function describeAggregator(status: number, body: string): string {
  return opencodeTierGate(body) ?? accountNotice(body) ?? describeFailure(status, body);
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

function geminiKey(): string {
  return (env.GEMINI_API_KEY ?? "").trim();
}

/**
 * Backup Gemini key, tried when the primary's failure is key- or account-level
 * (401/403, or 429/quota exhaustion). Without it `callGemini` behaves exactly
 * as before. Read from `GEMINI_FALLBACK_API_KEY`; a deployment holding only
 * the backup can still generate.
 */
function geminiFallbackKey(): string {
  return (env.GEMINI_FALLBACK_API_KEY ?? "").trim();
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

function cometKey(): string {
  return (env.COMET_API_KEY ?? "").trim();
}

function groqKey(): string {
  return (env.GROQ_API_KEY ?? "").trim();
}

function nvidiaKey(): string {
  return (env.NVIDIA_API_KEY ?? "").trim();
}

function opencodeKey(): string {
  return (env.OPENCODE_API_KEY ?? "").trim();
}

/**
 * True when at least one provider has a key, so the route can fail early.
 */
export function isAiConfigured(): boolean {
  return (
    geminiKey().length > 0 ||
    geminiFallbackKey().length > 0 ||
    glmKey().length > 0 ||
    aihubmixKey().length > 0 ||
    openrouterKey().length > 0 ||
    cometKey().length > 0 ||
    groqKey().length > 0 ||
    nvidiaKey().length > 0 ||
    opencodeKey().length > 0
  );
}

/**
 * Gemini `generateContent`. `messages[0]` (if it is a system message) becomes
 * `systemInstruction`; the rest are collapsed into one user turn, which is all
 * a single-shot generation needs.
 *
 * Tries `GEMINI_API_KEY` first, then `GEMINI_FALLBACK_API_KEY` when the
 * primary fails on key/account grounds (401/403, or 429/quota exhaustion) —
 * the owner's setup is two keys, the second standing by. A timeout or an
 * overloaded 503 does not switch keys, because the key is not the problem
 * there. The retry is invisible to the walk: it costs no extra attempt event.
 */
async function callGemini(
  spec: ModelSpec,
  messages: ChatMessage[],
  signal: AbortSignal
): Promise<string> {
  const primary = geminiKey();
  const fallback = geminiFallbackKey();
  if (!primary) {
    // A deployment holding only the backup key can still generate; without
    // either there is nothing to say but the original message.
    if (!fallback) throw new GenerationError("error", "GEMINI_API_KEY is not set.");
    return callGeminiWithKey(spec, messages, signal, fallback, "GEMINI_FALLBACK_API_KEY");
  }
  try {
    return await callGeminiWithKey(spec, messages, signal, primary, "GEMINI_API_KEY");
  } catch (error) {
    // Switch keys only for the failure the backup actually covers. 429/quota
    // is account-scoped per `classifyGemini`; 401/403 land in `error` with a
    // message that names the key.
    const keyProblem =
      (error instanceof GenerationError && error.kind === "provider-ratelimit") ||
      (error instanceof GenerationError &&
        error.kind === "error" &&
        /401|403|api[ _-]?key|invalid|unauthori[sz]ed|forbidden/i.test(error.message));
    if (keyProblem && fallback) {
      return callGeminiWithKey(spec, messages, signal, fallback, "GEMINI_FALLBACK_API_KEY");
    }
    throw error;
  }
}

/** One Gemini call with a specific key; shared by the primary and the backup. */
async function callGeminiWithKey(
  spec: ModelSpec,
  messages: ChatMessage[],
  signal: AbortSignal,
  key: string,
  envName: string
): Promise<string> {
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
    // Name the key that failed in the message, so the attempt list says which
    // of the two is out when generation does eventually give up.
    throw new GenerationError(
      classifyGemini(response.status, body),
      `${envName}: ${describeFailure(response.status, body)}`
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
      describeFailure(response.status, body)
    );
  }

  let json: {
    choices?: { message?: { content?: string } }[];
    error?: { code?: string | number; message?: string };
  };
  try {
    json = JSON.parse(body) as typeof json;
  } catch {
    // Z.AI's account-level codes (1113, 1001, 1003, 1005) are read by
    // `classifyGlm` from a *JSON* body, so there is no notice to look for here
    // the way there is for the aggregators. Keep the raw body in the message
    // instead of dropping it: a non-JSON 200 is otherwise unexplainable.
    throw new GenerationError("error", describeFailure(response.status, body));
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

/** The providers that speak OpenAI's chat-completions wire format. */
type OpenAiCompatibleProvider = Exclude<Provider, "gemini" | "glm">;

/** Where each OpenAI-compatible provider's chat-completions endpoint lives. */
const AGGREGATOR_ENDPOINTS: Record<OpenAiCompatibleProvider, string> = {
  aihubmix: "https://aihubmix.com/v1/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  comet: "https://api.cometapi.com/v1/chat/completions",
  // Groq's OpenAI-compatible face lives under a path prefix, unlike the others.
  groq: "https://api.groq.com/openai/v1/chat/completions",
  nvidia: "https://integrate.api.nvidia.com/v1/chat/completions",
  // OpenCode Zen's docs row reads exactly this: bare model id, this path,
  // `@ai-sdk/openai-compatible`. The Muse Spark rows swap the path suffix for
  // `/responses` — see `callOpenAiCompatibleResponses`.
  opencode: "https://opencode.ai/zen/v1/chat/completions",
};

/** The key each of those reads. Thunks, so the env is read per attempt. */
const AGGREGATOR_KEYS: Record<OpenAiCompatibleProvider, () => string> = {
  aihubmix: aihubmixKey,
  openrouter: openrouterKey,
  comet: cometKey,
  groq: groqKey,
  nvidia: nvidiaKey,
  opencode: opencodeKey,
};

/**
 * Chat-completions transport for AIHubMix, OpenRouter, Comet, Groq, NVIDIA and
 * OpenCode, which share a wire format and a status ladder.
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
  signal: AbortSignal,
  opencodeSessionId: string
): Promise<string> {
  const provider = spec.provider as OpenAiCompatibleProvider;
  const key = AGGREGATOR_KEYS[provider]();
  if (!key) {
    throw new GenerationError("error", `${provider.toUpperCase()}_API_KEY is not set.`);
  }

  // The Muse Spark rows speak the OpenAI Responses API, everything else speaks
  // chat-completions. Same provider, same key, different wire format.
  if (spec.endpoint === "responses") {
    return callOpenAiCompatibleResponses(spec, messages, signal, key, opencodeSessionId);
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
  if (provider === "opencode") {
    // Zen's free tier is refused without these two — a per-conversation UUID
    // and a User-Agent. The rest of the block (`x-opencode-client` /
    // `-project` / `-request`, plus the CLI User-Agent) is the fingerprint
    // their own client sends, added at the owner's request to try to keep the
    // free tier usable from the Worker. Measured 2026-09-16 from a residential
    // IP the extra headers change nothing — every variant (with and without
    // them, even with no Authorization at all) returns 200 — and there is no
    // evidence they beat the per-IP limits on Cloudflare's shared egress. The
    // provider states its free tier is only for its own client, so this is
    // client-identity emulation, owner-requested, with the ToS/key risk that
    // implies. See `opencodeTierGate` and the MODEL_CHAIN note.
    headers["x-opencode-session"] = opencodeSessionId;
    headers["x-opencode-project"] = opencodeSessionId;
    headers["x-opencode-request"] = crypto.randomUUID();
    headers["x-opencode-client"] = "cli";
    headers["User-Agent"] = "opencode/latest/1.3.15/cli";
  }

  const response = await fetch(AGGREGATOR_ENDPOINTS[provider], {
    method: "POST",
    headers,
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
      classifyAggregator(response.status, body),
      describeAggregator(response.status, body)
    );
  }

  let json: {
    choices?: { message?: { content?: string } }[];
    error?: { code?: string | number; message?: string };
  };
  try {
    json = JSON.parse(body) as typeof json;
  } catch {
    // Read the notice *before* falling through to the generic message: this is
    // the AIHubMix shape, a 200 whose body is a plain-text account notice. It
    // must not be reported as a model-scoped parse failure, or the walk carries
    // on to `hy3-free` against an account that is dead for both rows.
    const notice = accountNotice(body);
    if (notice) throw new GenerationError("provider-ratelimit", notice);
    throw new GenerationError("error", describeFailure(response.status, body));
  }

  // OpenRouter in particular can ride an error on an otherwise 200 body.
  if (json.error) {
    // The provider's own message is already a sentence, so only a notice
    // replaces it — `HTTP 200: insufficient balance` would read as noise. The
    // notice is still worth looking for: `classifyOpenAiCompatible` reads the
    // status, and a 200 tells it nothing, so an account-wide message here would
    // otherwise be filed as a model-scoped `error`.
    const notice = accountNotice(body);
    throw new GenerationError(
      notice ? "provider-ratelimit" : classifyOpenAiCompatible(response.status, json.error.message ?? body),
      notice ?? json.error.message ?? `${provider} error`
    );
  }

  const text = json.choices?.[0]?.message?.content?.trim();
  if (!text) throw new GenerationError("error", `${provider} returned an empty response.`);
  return text;
}

/**
 * The OpenAI Responses-API transport, used by the Muse Spark rows on OpenCode
 * Zen — the docs route the GPT / Grok / Muse-Spark family to `/responses`, and
 * chat-completions answers `500 Internal server error` there. Verified live
 * 2026-09-16: both Muse Spark rows answer `/responses` with the session header
 * in 1.5-5.6s.
 *
 * The body is Responses-shaped: `input` instead of `messages` (the same
 * role/content array works), no `temperature`/`max_tokens` (that is
 * `max_output_tokens`), and the answer is assembled from the `output` items
 * rather than `choices[0].message.content`.
 *
 * Errors ride the same `error` JSON shape as chat-completions, so the shared
 * `classifyAggregator` / `describeAggregator` pair applies unchanged.
 */
async function callOpenAiCompatibleResponses(
  spec: ModelSpec,
  messages: ChatMessage[],
  signal: AbortSignal,
  key: string,
  opencodeSessionId: string
): Promise<string> {
  const provider = spec.provider as OpenAiCompatibleProvider;

  const response = await fetch(
    AGGREGATOR_ENDPOINTS[provider].replace("/chat/completions", "/responses"),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        "x-opencode-session": opencodeSessionId,
        "x-opencode-project": opencodeSessionId,
        "x-opencode-request": crypto.randomUUID(),
        "x-opencode-client": "cli",
        "User-Agent": "opencode/latest/1.3.15/cli",
      },
      body: JSON.stringify({
        model: spec.model,
        input: messages,
        ...spec.extraBody,
      }),
      signal,
    }
  );

  const body = await response.text();

  if (!response.ok) {
    throw new GenerationError(
      classifyAggregator(response.status, body),
      describeAggregator(response.status, body)
    );
  }

  let json: {
    output?: { content?: { type?: string; text?: string }[] }[];
    error?: { code?: string | number; message?: string };
  };
  try {
    json = JSON.parse(body) as typeof json;
  } catch {
    throw new GenerationError("error", describeFailure(response.status, body));
  }

  if (json.error) {
    throw new GenerationError(
      classifyAggregator(response.status, json.error.message ?? body),
      json.error.message ?? `${provider} error`
    );
  }

  const text = (json.output ?? [])
    .flatMap((item) => item.content ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!text) throw new GenerationError("error", `${provider} returned an empty response.`);
  return text;
}

function callModel(
  spec: ModelSpec,
  messages: ChatMessage[],
  signal: AbortSignal,
  opencodeSessionId: string
): Promise<string> {
  switch (spec.provider) {
    case "gemini":
      return callGemini(spec, messages, signal);
    case "glm":
      return callGlm(spec, messages, signal);
    default:
      return callOpenAiCompatible(spec, messages, signal, opencodeSessionId);
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
  // One OpenCode Zen session per generation: the free tier keys prompt caching
  // off this UUID, and a fresh one per attempt would throw that away for zero
  // benefit — the messages are identical every time a row is retried.
  const opencodeSessionId = crypto.randomUUID();
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

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
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
        // Clamped to what is left, so the last attempt cannot run past the
        // deadline. Without it an attempt could start with 1ms remaining and
        // still take its full ceiling, which made the budget a floor — measured
        // at 100.0s against 95s. Clamped rather than skipped, because most rows
        // answer in about a second, so a small remainder is still worth trying.
        const text = await callModel(
          spec,
          messages,
          AbortSignal.timeout(Math.min(ATTEMPT_TIMEOUT_MS, remaining)),
          opencodeSessionId
        );

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
