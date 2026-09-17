import { createContext } from "react-router";

import { checkConvexSession, refreshConvexTokens, type ConvexUser } from "~/lib/auth.server";
import { JWT_COOKIE, REFRESH_COOKIE } from "~/lib/token-cookies";

/**
 * Thrown when the request presented a token but Convex could not be reached, so
 * the viewer is genuinely unknown. Middleware turns this into a 503 rather than
 * rendering the device-scoped library, which would show a signed-in user content
 * that is not theirs — and, worse, let them add to it under the device owner.
 */
export class AuthUnavailableError extends Error {
  constructor() {
    super("Could not verify your session — the authentication service is unreachable.");
  }
}

/**
 * The resolved viewer identity for one request. The owner scopes every content
 * query in D1:
 *   * signed-in users → `ownerId` = Convex user id (account-scoped, cross-device)
 *   * signed-out users → `ownerId` = device cookie id (device-scoped, private)
 *
 * Middleware (see `app/root.tsx`) resolves this once per request and stores it
 * in `ownerContext`; loaders and actions read it with `context.get(...)`.
 */
export interface OwnerInfo {
  /** Convex user id when signed in, otherwise the device id. */
  ownerId: string;
  /** The device cookie value — always present (created when missing). */
  deviceId: string;
  /** The signed-in user, or null. */
  user: ConvexUser | null;
  isAdmin: boolean;
  /** True when the device cookie had to be created for this request. */
  deviceIsNew: boolean;
}

export const ownerContext = createContext<OwnerInfo | null>(null);

const DEVICE_COOKIE = "jv_device";
const DEVICE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export function readCookie(header: string | null, name: string): string | null {
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

/**
 * Resolve the viewer: device id from the cookie, user from the JWT cookie.
 *
 * The JWT lasts an hour while the cookie holding it lasts thirty days, so a tab
 * left open — or opened again after lunch — presents a token the browser can
 * still renew but this side cannot validate. Reading that as "signed out" served
 * the device-scoped library to a signed-in user until the next reload, which is
 * why the refresh below exists: the browser makes the same call on mount, and
 * making it here too means the *first* request after expiry is already right.
 *
 * The renewed token is used for this request only. The browser is the sole
 * writer of the token cookies (it renews within a second of the first load), and
 * a second writer here would race the sign-out path — which clears the cookie
 * precisely while a request that read it is still in flight.
 *
 * Throws `AuthUnavailableError` when a token was presented but Convex never
 * answered. A viewer we could not identify is not a signed-out viewer, and a
 * request with no token at all is unaffected — so the blast radius is signed-in
 * requests during an outage, not the site.
 */
export async function resolveOwnerFromRequest(request: Request): Promise<OwnerInfo> {
  const cookies = request.headers.get("Cookie");
  let deviceId = readCookie(cookies, DEVICE_COOKIE);
  const deviceIsNew = !deviceId;
  if (!deviceId) deviceId = crypto.randomUUID();

  const jwt = readCookie(cookies, JWT_COOKIE);
  let session = await checkConvexSession(jwt);
  if (session.status === "unreachable") throw new AuthUnavailableError();

  if (session.status === "rejected") {
    const refreshToken = readCookie(cookies, REFRESH_COOKIE);
    if (refreshToken) {
      const renewed = await refreshConvexTokens(refreshToken);
      if (renewed.status === "unreachable") throw new AuthUnavailableError();
      if (renewed.status === "ok") {
        // Verified like any other token before it is trusted.
        session = await checkConvexSession(renewed.tokens.token);
        if (session.status === "unreachable") throw new AuthUnavailableError();
      }
    }
  }

  const user = session.status === "ok" ? session.user : null;
  return {
    ownerId: user?.id ?? deviceId,
    deviceId,
    user,
    isAdmin: session.status === "ok" ? session.isAdmin : false,
    deviceIsNew,
  };
}

/** Set-Cookie header that persists a freshly created device id. */
export function deviceCookieHeader(deviceId: string, isHttps: boolean): string {
  const attributes = [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    isHttps ? "Secure" : "",
    `Max-Age=${DEVICE_MAX_AGE}`,
  ]
    .filter(Boolean)
    .join("; ");
  return `${DEVICE_COOKIE}=${encodeURIComponent(deviceId)}; ${attributes}`;
}
