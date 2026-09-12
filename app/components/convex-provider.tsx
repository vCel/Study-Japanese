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
const cookieStorage: TokenStorage = {
  getItem: async (key) => {
    const response = await fetch(`/api/auth-token?key=${encodeURIComponent(key)}`, {
      credentials: "same-origin",
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { value?: string | null };
    return data.value ?? null;
  },
  setItem: async (key, value) => {
    await fetch(`/api/auth-token?key=${encodeURIComponent(key)}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
  },
  removeItem: async (key) => {
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

export function isConvexClientConfigured(): boolean {
  return convex !== null;
}