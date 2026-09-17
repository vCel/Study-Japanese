import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

import {
  enforceRateLimit,
  getClientIp,
  type RateLimitResult,
} from "./ratelimit.server";

export interface ConvexUser {
  id: string;
  email: string | null;
  name: string | null;
}

export function isConvexConfigured(): boolean {
  return Boolean(import.meta.env.VITE_CONVEX_URL);
}

/** A Convex HTTP call that either produced a value or failed. */
type ConvexCall<T> = { ok: true; value: T } | { ok: false; reachable: boolean };

/**
 * Runs a Convex HTTP call and reports whether the deployment answered at all.
 *
 * `ConvexHttpClient` collapses "no response" and "answered with an error" into
 * one thrown `Error`, but the two mean opposite things here: a token Convex
 * refuses is a signed-out viewer, while a deployment that never answered is an
 * outage. The status recorded by the fetch wrapper is the only place that
 * difference is visible.
 */
async function callConvex<T>(
  token: string | null,
  run: (client: ConvexHttpClient) => Promise<T>
): Promise<ConvexCall<T>> {
  const url = import.meta.env.VITE_CONVEX_URL as string;
  let status: number | null = null;
  const client = new ConvexHttpClient(url, {
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      status = response.status;
      return response;
    },
  });
  if (token) client.setAuth(token);

  try {
    return { ok: true, value: await run(client) };
  } catch {
    // Convex answers a token it refuses with 401 and a well-formed request it
    // cannot serve with 200 + `{status:"error"}`; measured against the
    // deployment, `InvalidAuthHeader` comes back as a 401. So only a 2xx, 401 or
    // 403 is an answer about the token. No response at all, a 5xx, or any other
    // 4xx (something in between the Worker and Convex) is the service being
    // unavailable, which is not the same claim.
    return {
      ok: false,
      reachable: status !== null && (status < 300 || status === 401 || status === 403),
    };
  }
}

/**
 * The result of verifying a Convex Auth token (sent by the browser) against the
 * Convex backend. Three outcomes rather than two, because callers have to tell
 * them apart: a refused token is a signed-out viewer, an unreachable deployment
 * is an outage, and reading the second as the first is what silently served a
 * signed-in user the device-scoped library.
 */
export type ConvexSession =
  | { status: "ok"; user: ConvexUser; isAdmin: boolean }
  | { status: "rejected" }
  | { status: "unreachable" };

export async function checkConvexSession(token: string | null): Promise<ConvexSession> {
  const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
  // No token is not an outage — the viewer simply is not signed in.
  if (!url || !token) return { status: "rejected" };

  const found = await callConvex(token, async (client) => {
    const user = await client.query(api.users.getAuthenticatedUser, {});
    if (!user) return null;

    let isAdmin = false;
    try {
      isAdmin = await client.query(api.users.isCurrentUserAdmin, {});
    } catch {
      // Older deployments without the admin query — treat as non-admin.
      isAdmin = false;
    }
    return { user, isAdmin };
  });

  if (!found.ok) return found.reachable ? { status: "rejected" } : { status: "unreachable" };
  if (!found.value) return { status: "rejected" };
  return { status: "ok", user: found.value.user, isAdmin: found.value.isAdmin };
}

export type RefreshOutcome =
  | { status: "ok"; tokens: { token: string; refreshToken: string } }
  | { status: "rejected" }
  | { status: "unreachable" };

/**
 * Exchange a refresh token for a fresh JWT — the same call the browser makes on
 * mount (`auth:signIn` with no provider). `rejected` when the refresh token has
 * been spent, revoked, or has aged out.
 *
 * The rotated refresh token that comes back is deliberately dropped: Convex Auth
 * treats a replay of one outside a 10s window as theft and revokes the whole
 * chain, and the browser's in-memory copy keeps presenting the one in its
 * cookie. Persisting the rotation here would fork that chain and sign the user
 * out.
 */
export async function refreshConvexTokens(refreshToken: string): Promise<RefreshOutcome> {
  const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
  if (!url) return { status: "rejected" };

  const result = await callConvex(null, async (client) => {
    const value = (await client.action(api.auth.signIn, { refreshToken })) as {
      tokens?: { token: string; refreshToken: string } | null;
    } | null;
    return value?.tokens ?? null;
  });

  if (!result.ok) return result.reachable ? { status: "rejected" } : { status: "unreachable" };
  return result.value ? { status: "ok", tokens: result.value } : { status: "rejected" };
}

export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
}

/**
 * Convex token as posted by a React Router `<Form>` (the `convexToken` hidden
 * input every form carries). Form posts don't set an `Authorization` header, so
 * this is how actions authenticate.
 */
export function readFormToken(form: FormData): string | null {
  const token = form.get("convexToken");
  return typeof token === "string" && token.length > 0 ? token : null;
}

function jsonResponse(body: unknown, status: number, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers });
}

/**
 * 503 rather than 401 when the auth service could not be reached: a 401 tells
 * the caller to throw away a token that may well be fine, and it hides an outage
 * behind "you are not signed in".
 */
function unavailableResponse(): Response {
  return jsonResponse(
    {
      error:
        "Could not verify your session — the authentication service is unreachable. Please try again.",
    },
    503,
    { "Retry-After": "5" }
  );
}

/**
 * Combined guard for the JSON API: per-IP rate limit (API_LIMITER) followed by
 * authentication. Returns either the authenticated user or a ready-to-return
 * 401/429 JSON response.
 */
export async function guardApiRequest(
  request: Request
): Promise<{ ok: true; user: ConvexUser } | { ok: false; response: Response }> {
  // 1. Rate limit by client IP before doing anything expensive.
  const limited: RateLimitResult = await enforceRateLimit(
    "API_LIMITER",
    getClientIp(request),
    "api"
  );
  if (!limited.allowed) {
    return {
      ok: false,
      response: jsonResponse(
        { error: "Rate limit exceeded. Please slow down." },
        429,
        { "Retry-After": String(limited.retryAfterSeconds ?? 60) }
      ),
    };
  }

  // 2. The API is restricted to registered users.
  if (!isConvexConfigured()) {
    return {
      ok: false,
      response: jsonResponse(
        { error: "API is not configured yet. Set VITE_CONVEX_URL to enable it." },
        503
      ),
    };
  }

  const check = await checkConvexSession(extractBearerToken(request));
  if (check.status === "unreachable") {
    return { ok: false, response: unavailableResponse() };
  }
  if (check.status === "rejected") {
    return {
      ok: false,
      response: jsonResponse(
        {
          error:
            "Unauthorized. The JSON API is limited to registered users — sign in and pass your Convex auth token as an 'Authorization: Bearer <token>' header.",
        },
        401,
        { "WWW-Authenticate": "Bearer" }
      ),
    };
  }

  return { ok: true, user: check.user };
}

/**
 * Same checks as guardAdminRequest, but returns a plain message — suited for
 * React Router form actions that render inline error text.
 */
export async function guardAdminAction(
  request: Request,
  token?: string | null
): Promise<{ ok: true; user: ConvexUser } | { ok: false; status: number; message: string }> {
  const result = await guardAdminRequest(request, token);
  if (result.ok) return result;

  const response = result.response;
  let message = "You are not allowed to do that.";
  try {
    const body = (await response.json()) as { error?: string };
    if (body.error) message = body.error;
  } catch {
    // keep default message
  }
  return { ok: false, status: response.status, message };
}

/**
 * Guard for admin-only operations (rules management): rate limit, then token
 * verification, then the Convex admin allow-list check.
 *
 * The token normally arrives in the `Authorization` header (JSON API), but
 * React Router `<Form>` posts carry it in the body as `convexToken` — pass that
 * here so signed-in admins aren't rejected with a 401.
 */
export async function guardAdminRequest(
  request: Request,
  token?: string | null
): Promise<
  | { ok: true; user: ConvexUser }
  | { ok: false; response: Response }
> {
  const limited: RateLimitResult = await enforceRateLimit(
    "API_LIMITER",
    getClientIp(request),
    "api"
  );
  if (!limited.allowed) {
    return {
      ok: false,
      response: jsonResponse(
        { error: "Rate limit exceeded. Please slow down." },
        429,
        { "Retry-After": String(limited.retryAfterSeconds ?? 60) }
      ),
    };
  }

  if (!isConvexConfigured()) {
    return {
      ok: false,
      response: jsonResponse(
        { error: "Not configured yet. Set VITE_CONVEX_URL to enable rules management." },
        503
      ),
    };
  }

  const session = await checkConvexSession(token ?? extractBearerToken(request));
  if (session.status === "unreachable") {
    return { ok: false, response: unavailableResponse() };
  }
  if (session.status === "rejected") {
    return {
      ok: false,
      response: jsonResponse(
        { error: "Unauthorized. Only signed-in admins can manage rules." },
        401,
        { "WWW-Authenticate": "Bearer" }
      ),
    };
  }

  if (!session.isAdmin) {
    return {
      ok: false,
      response: jsonResponse(
        { error: "Forbidden. Only admins can add or edit rules." },
        403
      ),
    };
  }

  return { ok: true, user: session.user };
}

/**
 * Guard for operations any *registered* user may perform (starring a card as
 * important): rate limit, then token verification. Unlike
 * `guardAdminRequest` there is no admin allow-list check.
 */
export async function guardUserRequest(
  request: Request,
  token?: string | null
): Promise<{ ok: true; user: ConvexUser } | { ok: false; response: Response }> {
  const limited: RateLimitResult = await enforceRateLimit(
    "API_LIMITER",
    getClientIp(request),
    "api"
  );
  if (!limited.allowed) {
    return {
      ok: false,
      response: jsonResponse(
        { error: "Rate limit exceeded. Please slow down." },
        429,
        { "Retry-After": String(limited.retryAfterSeconds ?? 60) }
      ),
    };
  }

  if (!isConvexConfigured()) {
    return {
      ok: false,
      response: jsonResponse(
        { error: "Not configured yet. Set VITE_CONVEX_URL to enable signing in." },
        503
      ),
    };
  }

  const session = await checkConvexSession(token ?? extractBearerToken(request));
  if (session.status === "unreachable") {
    return { ok: false, response: unavailableResponse() };
  }
  if (session.status === "rejected") {
    return {
      ok: false,
      response: jsonResponse({ error: "Please sign in to do that." }, 401, {
        "WWW-Authenticate": "Bearer",
      }),
    };
  }

  return { ok: true, user: session.user };
}

/** Message-shaped variant of `guardUserRequest`, for React Router form actions. */
export async function guardUserAction(
  request: Request,
  token?: string | null
): Promise<{ ok: true; user: ConvexUser } | { ok: false; status: number; message: string }> {
  const result = await guardUserRequest(request, token);
  if (result.ok) return result;

  let message = "You are not allowed to do that.";
  try {
    const body = (await result.response.json()) as { error?: string };
    if (body.error) message = body.error;
  } catch {
    // keep the default message
  }
  return { ok: false, status: result.response.status, message };
}