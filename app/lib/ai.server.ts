/**
 * Multi-provider text generation with an ordered model fallback.
 *
 * The chain is walked in order; each attempt gets its own timeout and the walk
 * aborts early when the failure tells us every remaining model on a provider
 * would fail the same way. Specifically: a Gemini **429** means the whole
 * Google account is out of quota, so all three Gemini models are skipped and
 * the walk jumps straight to GLM.
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

/** One entry in the fallback chain. */
interface ModelSpec {
  model: string;
  provider: "gemini" | "glm";
}

/**
 * Ordered exactly as specified: newest Gemini first, then GLM. Everything
 * shares the same interface so the walk below stays one loop.
 */
export const MODEL_CHAIN: ModelSpec[] = [
  { model: "gemini-3.8-flash", provider: "gemini" },
  { model: "gemini-3.7-flash", provider: "gemini" },
  { model: "gemini-3.6-flash", provider: "gemini" },
  { model: "glm-4.7-flash", provider: "glm" },
  { model: "glm-4.5-flash", provider: "glm" },
];

/** Per-attempt ceiling. Long enough for a full question set, short enough that
 * five attempts can't outlive the request. */
const ATTEMPT_TIMEOUT_MS = 25_000;

/** Ceiling for the whole walk, so a slow cascade still returns a response. */
const TOTAL_BUDGET_MS = 95_000;

/**
 * How a failed attempt should affect the walk.
 *  * `ratelimit`  → the account is out of quota; skip the rest of the provider
 *  * `overloaded` → transient provider-wide load; worth one retry
 *  * `timeout`    → this attempt stalled; try the next model
 *  * `error`      → anything else (bad request, bad key, bad output)
 */
type FailureKind = "ratelimit" | "overloaded" | "timeout" | "error";

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
   * Called when an attempt fails and a retry is about to happen, so the UI can
   * explain the pause rather than appearing stuck.
   */
  onRetry?: (info: { model: string; detail: string; retryInMs: number }) => void;
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
  if (status === 429) return "ratelimit";
  if (/RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(body)) return "ratelimit";
  if (status === 503 || /UNAVAILABLE|overloaded/i.test(body)) return "overloaded";
  return "error";
}

/**
 * GLM (Z.AI / BigModel) reports problems in a numeric `code` on an otherwise
 * 200 body, and the code arrives as a **string** — so it is compared as one.
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
  if (status === 429) return "ratelimit";
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
      return "ratelimit";
    case "1113":
    case "1001":
    case "1003":
    case "1005":
      return "ratelimit";
    case "1305":
      return "overloaded";
    default:
      if (status === 503) return "overloaded";
      if (/overload|busy|try again/i.test(body)) return "overloaded";
      return "error";
  }
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

/** True when at least one provider has a key, so the route can fail early. */
export function isAiConfigured(): boolean {
  return geminiKey().length > 0 || glmKey().length > 0;
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

/** GLM via the OpenAI-compatible chat-completions endpoint. */
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

function callModel(
  spec: ModelSpec,
  messages: ChatMessage[],
  signal: AbortSignal
): Promise<string> {
  return spec.provider === "gemini"
    ? callGemini(spec, messages, signal)
    : callGlm(spec, messages, signal);
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Try each model in `MODEL_CHAIN` until one answers.
 *
 * `ratelimit` failures skip the rest of that provider and continue with the
 * next one (so a Gemini 429 lands straight on GLM); `overloaded` failures get
 * one retry with a short backoff before the walk moves on.
 */
export async function generateWithFallback(
  messages: ChatMessage[],
  options: GenerateOptions = {}
): Promise<GenerateOutcome> {
  const attempts: GenerationAttempt[] = [];
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  /** Providers already known to be rate-limited this request. */
  const exhausted = new Set<string>();
  let lastDetail = "No model in the fallback chain answered.";

  for (let index = 0; index < MODEL_CHAIN.length; index++) {
    const spec = MODEL_CHAIN[index];

    // A 429 on one Gemini model means the account is out — don't spend the
    // other two attempts finding out.
    if (exhausted.has(spec.provider)) {
      attempts.push({
        model: spec.model,
        provider: spec.provider,
        outcome: "ratelimit",
        detail: `${spec.provider} account is rate limited — skipped.`,
        ms: 0,
      });
      continue;
    }

    if (Date.now() >= deadline) {
      lastDetail = "Ran out of time before any model answered.";
      break;
    }

    // Two passes on the same model: the second is the retry after a transient
    // overload. Only `overloaded` earns the retry.
    for (let pass = 0; pass < 2; pass++) {
      options.onAttempt?.({
        model: spec.model,
        provider: spec.provider,
        index,
        total: MODEL_CHAIN.length,
      });

      const started = Date.now();
      try {
        const text = await callModel(spec, messages, AbortSignal.timeout(ATTEMPT_TIMEOUT_MS));
        attempts.push({
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
          kind === "ratelimit"
            ? "ratelimit"
            : kind === "overloaded"
              ? "overloaded"
              : kind === "timeout"
                ? "timeout"
                : "error";
        attempts.push({ model: spec.model, provider: spec.provider, outcome, detail, ms });
        lastDetail = `${spec.model}: ${detail}`;

        if (kind === "ratelimit") {
          // Abandon the whole provider, not just this model.
          exhausted.add(spec.provider);
          break;
        }

        if (kind === "overloaded" && pass === 0) {
          const retryInMs = 1500;
          options.onRetry?.({ model: spec.model, detail, retryInMs });
          await sleep(retryInMs);
          continue; // one retry on the same model
        }

        break; // move to the next model
      }
    }
  }

  throw new GenerationError("error", lastDetail);
}

/** Exposed for the API route's error reporting. */
export { GenerationError };
