import * as React from "react";
import { ConvexAuthProvider, type TokenStorage } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";

/**
 * Convex auth client provider.
 * The Convex deployment URL comes from VITE_CONVEX_URL (see .env.example).
 * When it is not configured yet, auth features render their fallback states
 * and the rest of the app keeps working.
 */
const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
const convex =
  url && typeof window !== "undefined" ? new ConvexReactClient(url) : null;

/**
 * Token storage backed by httpOnly cookies.
 *
 * `ConvexAuthProvider` defaults to `localStorage`; this shim routes every read
 * and write through the same-origin `/api/auth-token` endpoint instead, so the
 * JWT and refresh token live in `HttpOnly` cookies that page scripts can never
 * read (see `app/routes/api.auth-token.ts`).
 */
/**
 * Token values are cached in memory for the life of the tab.
 *
 * Convex Auth reads the JWT on every auth check, and each edit form embeds it in
 * a hidden field — each of those reads used to be its own round-trip to
 * `/api/auth-token`. The cookies stay the source of truth (HttpOnly, so page
 * scripts still cannot read them); the cache only skips re-fetching a value this
 * tab already has, and is invalidated whenever this tab writes or clears it.
 */
const tokenCache = new Map<string, string | null>();

const cookieStorage: TokenStorage = {
  getItem: async (key) => {
    if (tokenCache.has(key)) return tokenCache.get(key) ?? null;
    const response = await fetch(`/api/auth-token?key=${encodeURIComponent(key)}`, {
      credentials: "same-origin",
    });
    // A failed read is not cached, so a transient error is retried next time.
    if (!response.ok) return null;
    const data = (await response.json()) as { value?: string | null };
    const value = data.value ?? null;
    tokenCache.set(key, value);
    return value;
  },
  setItem: async (key, value) => {
    tokenCache.set(key, value);
    await fetch(`/api/auth-token?key=${encodeURIComponent(key)}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
  },
  removeItem: async (key) => {
    tokenCache.delete(key);
    await fetch(`/api/auth-token?key=${encodeURIComponent(key)}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
  },
};

export function ConvexClientProvider({ children }: { children: React.ReactNode }) {
  if (convex) {
    return (
      <ConvexAuthProvider client={convex} storage={cookieStorage}>
        {children}
      </ConvexAuthProvider>
    );
  }
  return <>{children}</>;
}

/**
 * Whether auth is configured at all — it only reads the build-time env var, so
 * the server and the browser agree. Forms gate on this, which is what lets them
 * render the same HTML on both sides (gating them on the client instance made
 * the server render "auth is not configured" and the browser render the form,
 * so React threw the server tree away and re-rendered it).
 */
export function isAuthConfigured(): boolean {
  return Boolean(url);
}

/**
 * Whether this environment has a live Convex client — false during SSR, where
 * there is no browser. Anything that *calls Convex hooks* (`useQuery`,
 * `useMutation`, …) must be gated on this, because those hooks need the
 * provider that only exists in the browser.
 */
export function isConvexClientConfigured(): boolean {
  return convex !== null;
}