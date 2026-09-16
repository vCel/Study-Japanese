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

/**
 * Verifies a Convex Auth token (sent by the browser) against the Convex
 * backend and returns the authenticated user plus their admin status,
 * or null if unauthenticated.
 */
export async function getConvexSession(
  token: string | null
): Promise<{ user: ConvexUser; isAdmin: boolean } | null> {
  const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
  if (!url || !token) return null;

  const client = new ConvexHttpClient(url);
  try {
    client.setAuth(token);
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
  } catch {
    // Invalid/expired token or Convex not reachable — treat as unauthenticated.
    return null;
  }
}

/** Convenience wrapper that ignores the admin flag. */
export async function getConvexUserFromToken(token: string | null): Promise<ConvexUser | null> {
  const session = await getConvexSession(token);
  return session?.user ?? null;
}

/**
 * Exchange a refresh token for a fresh JWT — the same call the browser makes on
 * mount (`auth:signIn` with no provider). Null when the refresh token has been
 * spent, revoked, or has aged out.
 *
 * The rotated refresh token that comes back is deliberately dropped: Convex Auth
 * treats a replay of one outside a 10s window as theft and revokes the whole
 * chain, and the browser's in-memory copy keeps presenting the one in its
 * cookie. Persisting the rotation here would fork that chain and sign the user
 * out.
 */
export async function refreshConvexTokens(
  refreshToken: string
): Promise<{ token: string; refreshToken: string } | null> {
  const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
  if (!url) return null;

  try {
    const result = (await new ConvexHttpClient(url).action(api.auth.signIn, {
      refreshToken,
    })) as { tokens?: { token: string; refreshToken: string } | null } | null;
    return result?.tokens ?? null;
  } catch {
    // Spent/revoked refresh token, or Convex unreachable — either way there is
    // no session to recover.
    return null;
  }
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

  const user = await getConvexUserFromToken(extractBearerToken(request));
  if (!user) {
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

  return { ok: true, user };
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

  const session = await getConvexSession(token ?? extractBearerToken(request));
  if (!session) {
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

  const session = await getConvexSession(token ?? extractBearerToken(request));
  if (!session) {
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