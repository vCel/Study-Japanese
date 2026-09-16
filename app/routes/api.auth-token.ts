import type { Route } from "./+types/api.auth-token";

import {
  FETCH_TIME_COOKIE,
  JWT_COOKIE,
  MISC_COOKIE,
  REFRESH_COOKIE,
  TOKEN_COOKIE_MAX_AGE,
  VERIFIER_COOKIE,
} from "~/lib/token-cookies";

/**
 * Convex Auth token store.
 *
 * By default `ConvexAuthProvider` keeps the JWT / refresh token in
 * `localStorage`. This app instead routes them through this endpoint, which
 * sets them as `HttpOnly`, `SameSite=Lax` cookies (plus `Secure` over HTTPS),
 * so the credentials are never readable by page scripts. The client storage
 * shim in `convex-provider.tsx` calls this endpoint for get/set/delete.
 *
 * Only a small, fixed set of keys is used by Convex Auth, so each maps to a
 * dedicated cookie name (keeps every cookie well under the 4 KB limit).
 */
function cookieName(key: string): string {
  if (/Refresh/i.test(key)) return REFRESH_COOKIE;
  if (/JWT/i.test(key)) return JWT_COOKIE;
  if (/Verifier/i.test(key)) return VERIFIER_COOKIE;
  if (/FetchTime/i.test(key)) return FETCH_TIME_COOKIE;
  return MISC_COOKIE;
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return null;
}

function cookieAttributes(isHttps: boolean) {
  return [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    isHttps ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function setCookie(name: string, value: string, isHttps: boolean): string {
  return `${name}=${encodeURIComponent(value)}; ${cookieAttributes(isHttps)}; Max-Age=${TOKEN_COOKIE_MAX_AGE}`;
}

function clearCookie(name: string, isHttps: boolean): string {
  return `${name}=; ${cookieAttributes(isHttps)}; Max-Age=0`;
}

/** Reject cross-origin writes (CSRF) — the token cookies are same-origin only. */
function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

function noStore(headers: HeadersInit): HeadersInit {
  return { "Cache-Control": "no-store", ...headers };
}

/** Read one token (the browser fetches it for the in-memory Convex session). */
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  if (!key) {
    return Response.json({ error: "Missing key." }, { status: 400, headers: noStore({}) });
  }
  const value = readCookie(request.headers.get("Cookie"), cookieName(key));
  return Response.json({ value }, { headers: noStore({}) });
}

/** Write or clear one token. */
export async function action({ request }: Route.ActionArgs) {
  if (!isSameOrigin(request)) {
    return Response.json(
      { error: "Cross-origin writes are not allowed." },
      { status: 403, headers: noStore({}) }
    );
  }
  const url = new URL(request.url);
  const isHttps = url.protocol === "https:";

  if (request.method === "DELETE") {
    const key = url.searchParams.get("key");
    if (!key) {
      return Response.json({ error: "Missing key." }, { status: 400, headers: noStore({}) });
    }
    return new Response(null, {
      status: 204,
      headers: noStore({ "Set-Cookie": clearCookie(cookieName(key), isHttps) }),
    });
  }

  let body: { key?: unknown; value?: unknown };
  try {
    body = (await request.json()) as { key?: unknown; value?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400, headers: noStore({}) });
  }

  if (typeof body.key !== "string" || typeof body.value !== "string") {
    return Response.json(
      { error: "Both key and value are required." },
      { status: 400, headers: noStore({}) }
    );
  }

  return new Response(null, {
    status: 204,
    headers: noStore({ "Set-Cookie": setCookie(cookieName(body.key), body.value, isHttps) }),
  });
}
