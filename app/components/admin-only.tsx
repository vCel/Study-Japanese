import type * as React from "react";
import { useConvexAuth } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";

import { isConvexClientConfigured } from "~/components/convex-provider";
import { api } from "../../convex/_generated/api";

/**
 * Renders children only when the current viewer is an admin (Convex
 * ADMIN_EMAILS allow-list). Renders nothing for anonymous visitors, when
 * Convex is not configured, or while the state is loading.
 *
 * Must be mounted conditionally by the parent (only when
 * `isConvexClientConfigured()` is true) since it uses Convex hooks.
 */
export function AdminOnly({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const isAdmin = useQuery(api.users.isCurrentUserAdmin, {});

  if (!isConvexClientConfigured() || isLoading || !isAuthenticated) return null;
  if (isAdmin !== true) return null;

  return <>{children}</>;
}