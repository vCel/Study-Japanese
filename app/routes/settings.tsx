import { Link, useNavigate } from "react-router";
import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { useState } from "react";
import { LogOut, RotateCcw, Settings as SettingsIcon } from "lucide-react";

import type { Route } from "./+types/settings";
import { isConvexClientConfigured } from "~/components/convex-provider";
import { PageHeader } from "~/components/page-header";
import { api } from "../../convex/_generated/api";
import { Button } from "~/components/lightswind/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/lightswind/card";
import { cn } from "~/lib/utils";
import {
  loadPreference,
  REPETITION_KEY,
  savePreference,
} from "~/lib/study-prefs";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Settings · 日本語Vocab" }];
}

export default function Settings() {
  // No Convex hooks here — during SSR no provider is mounted, so the live
  // component below (which uses useConvexAuth/useQuery) only mounts client-side.
  if (!isConvexClientConfigured()) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <PageHeader
          title="Settings"
          icon={SettingsIcon}
          className="mb-0"
          description="Your account and study preferences"
        />
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Auth is not configured yet. Set <code>VITE_CONVEX_URL</code> in your environment
            (see README) to enable settings.
          </CardContent>
        </Card>
      </div>
    );
  }
  return <SettingsLive />;
}

function SettingsLive() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const authActions = useAuthActions() as
    | { signOut?: () => Promise<void> }
    | null
    | undefined;
  const signOut = authActions?.signOut;
  const navigate = useNavigate();
  const user = useQuery(api.users.getAuthenticatedUser, {});
  const [repetition, setRepetition] = useState(
    () => loadPreference(REPETITION_KEY, "1", ["1", "0"]) === "1"
  );

  const toggleRepetition = () => {
    const next = !repetition;
    setRepetition(next);
    savePreference(REPETITION_KEY, next ? "1" : "0");
  };

  const signedOut = (
    <Card>
      <CardContent className="p-8 text-center text-sm text-muted-foreground">
        You are signed out.{" "}
        <Link to="/login" className="text-primarylw hover:underline">
          Sign in
        </Link>{" "}
        to manage your account.
      </CardContent>
    </Card>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Settings"
        icon={SettingsIcon}
        className="mb-0"
        description="Your account and study preferences"
      />

      {/* Account */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Account</CardTitle>
          <CardDescription>Your sign-in details.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {isLoading ? (
            <div className="h-5 w-48 animate-pulse rounded bg-muted" />
          ) : isAuthenticated && user ? (
            <>
              <p>
                <span className="text-muted-foreground">Username: </span>
                <span className="font-medium">{user.username ?? "—"}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Email: </span>
                <span className="font-medium">{user.email ?? "—"}</span>
              </p>
            </>
          ) : (
            signedOut
          )}
        </CardContent>
      </Card>

      {/* Preferences */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Preferences</CardTitle>
          <CardDescription>
            Study behaviour defaults. More settings will be added over time.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <button
            type="button"
            onClick={toggleRepetition}
            aria-pressed={repetition}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
              repetition
                ? "border-primarylw/50 bg-primarylw/15 text-primarylw"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
            title="Spaced repetition: words you struggle with come back more often, at growing intervals"
          >
            <RotateCcw className="h-4 w-4" />
            Spaced repetition {repetition ? "on" : "off"}
          </button>
          <p className="mt-2 text-xs text-muted-foreground">
            Applies to new study sessions. Words you answer "Again" on are rescheduled at
            growing intervals.
          </p>
        </CardContent>
      </Card>

      {/* Sign out */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Session</CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            variant="destructive"
            disabled={!isAuthenticated}
            onClick={() => {
              void signOut?.().then(() => navigate("/"));
            }}
          >
            <LogOut /> Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}