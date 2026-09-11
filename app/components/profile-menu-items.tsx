import * as React from "react";
import { Link } from "react-router";
import { useConvexAuth } from "@convex-dev/auth/react";
import { LogIn, LogOut, Settings, UserPlus } from "lucide-react";

import { isConvexClientConfigured } from "~/components/convex-provider";

/**
 * The dock's Profile popover items. Rendered only while the popover is open, so
 * the Convex hooks never run during SSR. Signed-out visitors get sign-in links
 * — and crucially *not* a sign-out link.
 */

const ITEM_CLASS =
  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

export function ProfileMenuItems() {
  // The server can't know whether a Convex client exists, so start from the
  // signed-out set (identical on both renders) and refine after mount.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const configured = isConvexClientConfigured();
  if (!mounted || !configured) return <SignedOutItems />;
  return <ProfileMenuItemsLive />;
}

function SignedOutItems() {
  return (
    <>
      <Link to="/login" role="menuitem" className={ITEM_CLASS}>
        <LogIn className="h-4 w-4" /> Sign in
      </Link>
      <Link to="/signup" role="menuitem" className={ITEM_CLASS}>
        <UserPlus className="h-4 w-4" /> Sign up
      </Link>
    </>
  );
}

function ProfileMenuItemsLive() {
  const authState = useConvexAuth() as
    | { isLoading: boolean; isAuthenticated: boolean }
    | undefined;
  const isLoading = authState?.isLoading ?? false;
  const isAuthenticated = authState?.isAuthenticated ?? false;

  if (isLoading) {
    return <p className="px-3 py-2 text-sm text-muted-foreground">Checking session…</p>;
  }

  if (!isAuthenticated) return <SignedOutItems />;

  return (
    <>
      <Link to="/settings" role="menuitem" className={ITEM_CLASS}>
        <Settings className="h-4 w-4" /> Settings
      </Link>
      <Link to="/logout" role="menuitem" className={ITEM_CLASS}>
        <LogOut className="h-4 w-4" /> Sign out
      </Link>
    </>
  );
}
