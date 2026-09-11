import * as React from "react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
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

export function ConvexClientProvider({ children }: { children: React.ReactNode }) {
  if (convex) {
    return <ConvexAuthProvider client={convex}>{children}</ConvexAuthProvider>;
  }
  return <>{children}</>;
}

export function isConvexClientConfigured(): boolean {
  return convex !== null;
}