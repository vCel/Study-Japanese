import * as React from "react";
import { useConvexAuth } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";

import { api } from "../../convex/_generated/api";
import { isConvexClientConfigured } from "~/components/convex-provider";
import { toast } from "~/components/lightswind/toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/lightswind/alert-dialog";

/** Remember "keep on device" per account + browser, so the prompt is not an
 *  every-page nag. */
const DISMISS_KEY = (userId: string) => `jv:sync:dismissed:${userId}`;

type SyncState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "offer" }
  | { status: "busy" }
  | { status: "done" };

/**
 * After a sign-in, if the device holds content that is not part of the account
 * (it was created while signed out), offer to move it into the account so it
 * becomes accessible from any device. The user chooses: merge, or keep the
 * content on this device only.
 */
export function DeviceSyncPrompt() {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  // The live component calls Convex hooks, so it must not render during SSR
  // (where no provider is mounted) or on the first client render.
  if (!mounted || !isConvexClientConfigured()) return null;
  return <DeviceSyncPromptLive />;
}

function DeviceSyncPromptLive() {
  const auth = useConvexAuth() as
    | { isLoading: boolean; isAuthenticated: boolean }
    | undefined;
  const user = useQuery(api.users.getAuthenticatedUser, {});
  const [state, setState] = React.useState<SyncState>({ status: "idle" });
  const offeredRef = React.useRef(false);

  const isAuthenticated = auth?.isAuthenticated ?? false;
  const userId = user?.id ?? null;

  React.useEffect(() => {
    if (!isAuthenticated || !userId) return;
    if (offeredRef.current) return;

    // Ask at most once per signed-in session (per browser).
    offeredRef.current = true;
    try {
      if (window.localStorage.getItem(DISMISS_KEY(userId))) return;
    } catch {
      // ignore
    }

    let cancelled = false;
    setState({ status: "checking" });
    fetch("/api/sync", { credentials: "same-origin" })
      .then((response) => response.json() as Promise<{ deviceHasContent?: boolean; signedIn?: boolean }>)
      .then((data) => {
        if (cancelled) return;
        if (data.signedIn && data.deviceHasContent) {
          setState({ status: "offer" });
        } else {
          setState({ status: "idle" });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: "idle" });
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, userId]);

  if (state.status !== "offer" && state.status !== "busy") return null;

  const keepOnDevice = () => {
    if (userId) {
      try {
        window.localStorage.setItem(DISMISS_KEY(userId), "1");
      } catch {
        // ignore
      }
    }
    setState({ status: "done" });
  };

  const moveToAccount = async () => {
    setState({ status: "busy" });
    try {
      const response = await fetch("/api/sync", {
        method: "POST",
        credentials: "same-origin",
      });
      const data = (await response.json()) as { moved?: number; error?: string };
      if (!response.ok || data.error) {
        setState({ status: "offer" });
        toast({ title: data.error ?? "Could not sync your library.", variant: "error" });
        return;
      }
      if (userId) {
        try {
          window.localStorage.setItem(DISMISS_KEY(userId), "1");
        } catch {
          // ignore
        }
      }
      setState({ status: "done" });
      toast({
        title: data.moved && data.moved > 0
          ? `Moved ${data.moved} item${data.moved === 1 ? "" : "s"} to your account.`
          : "Your library is already in sync.",
        variant: "success",
      });
    } catch {
      setState({ status: "offer" });
      toast({ title: "Could not sync your library right now.", variant: "error" });
    }
  };

  return (
    <AlertDialog open onOpenChange={(open) => !open && keepOnDevice()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Move this device's words to your account?</AlertDialogTitle>
          <AlertDialogDescription>
            You created content on this device before signing in. Moving it into
            your account makes it available on every device you sign in to.
            Keeping it here leaves it on this device only.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={state.status === "busy"} onClick={keepOnDevice}>
            Keep on this device
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={state.status === "busy"}
            onClick={(event) => {
              event.preventDefault();
              void moveToAccount();
            }}
          >
            {state.status === "busy" ? "Moving…" : "Move to my account"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
