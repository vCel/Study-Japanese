import * as React from "react";
import { useConvexAuth } from "@convex-dev/auth/react";
import { Link } from "react-router";
import { Settings } from "lucide-react";
import { useQuery } from "convex/react";

import { isConvexClientConfigured } from "~/components/convex-provider";
import { Tooltip } from "~/components/lightswind/tooltip";
import { api } from "../../convex/_generated/api";

/** Neutral placeholder used while the Convex session is still unknown. */
function AuthSkeleton() {
  return <div className="h-9 w-24 animate-pulse rounded-full bg-muted" aria-hidden="true" />;
}

/**
 * `sidebar` stacks the auth area under the nav (name left, cog right);
 * `header` keeps it inline and shrink-wrapped so the top bar's logo never
 * gets squeezed onto a second line.
 */
type AuthLayout = "sidebar" | "header";

/** Signed-out fallback — no Convex hooks at this level so SSR stays safe. */
function AuthFallback({ layout = "sidebar" }: { layout?: AuthLayout }) {
  return (
    <Link
      to="/login"
      className={
        layout === "header"
          ? "shrink-0 rounded-full px-3 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground hover:text-foreground"
          : "rounded-full px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
      }
    >
      Sign in
    </Link>
  );
}

/**
 * Convex-aware auth area. Lives in its own component so the parent never
 * calls Convex hooks during SSR (where no provider is mounted).
 */
function AuthButtonsLive({ layout = "sidebar" }: { layout?: AuthLayout }) {
  const authState = useConvexAuth() as
    | { isLoading: boolean; isAuthenticated: boolean }
    | undefined;
  const isLoading = authState?.isLoading ?? false;
  const isAuthenticated = authState?.isAuthenticated ?? false;
  const user = useQuery(api.users.getAuthenticatedUser, {});

  if (isLoading) {
    return <AuthSkeleton />;
  }

  if (isAuthenticated) {
    const displayName = user?.username ?? user?.name ?? user?.email ?? "Account";
    const cog = (
      <Tooltip content="Settings">
        <Link
          to="/settings"
          aria-label="Settings"
          className="shrink-0 rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Settings className="h-5 w-5" />
        </Link>
      </Tooltip>
    );

    if (layout === "header") {
      return (
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip content={user?.email ?? displayName}>
            <span className="max-w-[6rem] truncate text-sm font-medium text-foreground">
              {displayName}
            </span>
          </Tooltip>
          {cog}
        </div>
      );
    }

    // Sidebar, signed in: the name and cog share a pill at the foot of the nav.
    return (
      <div className="flex w-full items-center justify-between gap-2 rounded-full border border-border/60 bg-card p-1.5">
        <Tooltip content={user?.email ?? displayName}>
          <span className="min-w-0 truncate pl-2 text-sm font-medium text-foreground">
            {displayName}
          </span>
        </Tooltip>
        {cog}
      </div>
    );
  }

  if (layout === "header") {
    return (
      <div className="flex shrink-0 items-center gap-1">
        <Link
          to="/login"
          className="rounded-full px-3 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Sign in
        </Link>
        <Link
          to="/signup"
          className="inline-flex h-9 items-center justify-center rounded-full bg-primarylw px-4 text-sm font-medium whitespace-nowrap text-white shadow transition-colors hover:bg-primarylw-2"
        >
          Sign up
        </Link>
      </div>
    );
  }

  // Sidebar: the two buttons share one row of equal halves, so they sit inside
  // the nav column instead of overflowing the pill container when stacked.
  return (
    <div className="flex w-full items-center gap-2">
      <Link
        to="/login"
        className="inline-flex h-10 flex-1 items-center justify-center rounded-full border border-border px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:border-primarylw/40 hover:bg-muted hover:text-foreground"
      >
        Sign in
      </Link>
      <Link
        to="/signup"
        className="inline-flex h-10 flex-1 items-center justify-center rounded-full bg-primarylw px-3 text-sm font-medium whitespace-nowrap text-white shadow transition-colors hover:bg-primarylw-2"
      >
        Sign up
      </Link>
    </div>
  );
}

/**
 * Auth area — reflects the Convex Auth session on the client. Signed-in users
 * see their name next to a cog button linking to /settings.
 */
export function AuthButtons({ layout = "sidebar" }: { layout?: AuthLayout } = {}) {
  // The server cannot know whether a Convex client exists, so the first client
  // render must be identical to the server-rendered one: a neutral placeholder.
  // Rendering a different branch here (e.g. a "Sign in" link) makes hydration
  // mismatch, and React then throws the whole tree away and re-renders it.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  if (!mounted) return <AuthSkeleton />;
  if (!isConvexClientConfigured()) return <AuthFallback layout={layout} />;
  return <AuthButtonsLive layout={layout} />;
}