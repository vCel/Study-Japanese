import * as React from "react";
import { useConvexAuth } from "@convex-dev/auth/react";

import { isConvexClientConfigured } from "~/components/convex-provider";

/**
 * Renders children only when Convex is configured and the user is signed in.
 * Must be mounted conditionally by the parent (only when
 * `isConvexClientConfigured()` is true) since it uses Convex hooks.
 */
export function SignedInOnly({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  if (!isConvexClientConfigured() || isLoading || !isAuthenticated) return null;
  return <>{children}</>;
}

/**
 * Same as `SignedInOnly`, but safe to render unconditionally: it renders
 * nothing on the server *and* on the first client render, so it can be passed
 * straight into a slot (e.g. `PageHeader`'s `actions`) without hydration
 * noticing that the browser gained a wrapper element.
 */
export function SignedInOnlyClient({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  if (!mounted || !isConvexClientConfigured()) return null;
  return <SignedInOnly>{children}</SignedInOnly>;
}