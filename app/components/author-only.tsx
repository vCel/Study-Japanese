import type * as React from "react";
import { useConvexAuth } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";

import { isConvexClientConfigured } from "~/components/convex-provider";
import { api } from "../../convex/_generated/api";

/**
 * Renders children only when the current viewer is the given author
 * (Convex user id). Renders nothing for anonymous visitors, when Convex is
 * not configured, or while the auth state is loading.
 *
 * Must be mounted conditionally by the parent (only when
 * `isConvexClientConfigured()` is true) since it uses Convex hooks.
 */
export function AuthorOnly({
  authorIds,
  children,
}: {
  /** Any of these ids grants access (e.g. word creator + list author). */
  authorIds: (string | null | undefined)[];
  children: React.ReactNode;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const user = useQuery(api.users.getAuthenticatedUser, {});

  if (!isConvexClientConfigured() || isLoading || !isAuthenticated) return null;
  // Query still loading → don't flash the button.
  if (user === undefined) return null;
  if (!user || !authorIds.includes(user.id)) return null;

  return <>{children}</>;
}

/**
 * Renders children when the current viewer may edit the item: they are an
 * admin, or they are one of the listed owners (creator / list author).
 * Must be mounted conditionally by the parent (only when
 * `isConvexClientConfigured()` is true) since it uses Convex hooks.
 */
export function CanEdit({
  ownerIds,
  children,
}: {
  ownerIds: (string | null | undefined)[];
  children: React.ReactNode;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const user = useQuery(api.users.getAuthenticatedUser, {});
  const isAdmin = useQuery(api.users.isCurrentUserAdmin, {});

  if (!isConvexClientConfigured() || isLoading || !isAuthenticated) return null;
  if (user === undefined || isAdmin === undefined) return null;
  if (isAdmin === true) return <>{children}</>;
  if (!user || !ownerIds.includes(user.id)) return null;

  return <>{children}</>;
}