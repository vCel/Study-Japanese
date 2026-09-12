import { Link, useNavigate } from "react-router";
import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { useAction, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { LogOut, Settings as SettingsIcon } from "lucide-react";

import type { Route } from "./+types/settings";
import { PageHeader } from "~/components/page-header";
import { SettingLabel } from "~/components/setting-label";
import { api } from "../../convex/_generated/api";
import { Button } from "~/components/lightswind/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/lightswind/card";
import { Input, Label } from "~/components/lightswind/input";
import { Switch } from "~/components/lightswind/switch";
import {
  loadPreference,
  REPETITION_KEY,
  savePreference,
} from "~/lib/study-prefs";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Settings · 日本語Vocab" }];
}

/** Keep the local part recognisable, hide the rest. */
function censorEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain || local.length === 0) return "•••";
  const head = local.slice(0, 1);
  const hidden = "•".repeat(Math.max(local.length - 1, 2));
  return `${head}${hidden}@${domain}`;
}

/** Neutral loading skeleton rendered on the server *and* the first client
 *  render so hydration never mismatches; the live component mounts afterwards. */
function SettingsSkeleton() {
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
          <div className="mx-auto h-5 w-40 animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>
    </div>
  );
}

export default function Settings() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // The server and the first client render both produce the skeleton;
  // the live component (which calls Convex hooks) only mounts after hydration.
  if (!mounted) return <SettingsSkeleton />;
  return <SettingsLive />;
}

/** Inline success / error note shown under a settings form. */
function FormNote({ error, done }: { error: string | null; done: string | null }) {
  if (!error && !done) return null;
  return (
    <p
      role="status"
      className={
        "rounded-[var(--radius)] border px-3 py-2 text-sm " +
        (error
          ? "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400"
          : "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400")
      }
    >
      {error ?? done}
    </p>
  );
}

/** Change the signed-in user's email — requires the current password. */
function ChangeEmailForm() {
  const changeEmail = useAction(api.account.changeEmail);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      const result = await changeEmail({ currentPassword: password, newEmail: email });
      setDone(`Email updated to ${result.email}.`);
      setEmail("");
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update your email.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm font-semibold">Change email</p>
      <div className="space-y-2">
        <Label htmlFor="new-email">New email</Label>
        <Input
          id="new-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email-password">Current password</Label>
        <Input
          id="email-password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="••••••••"
        />
      </div>
      <FormNote error={error} done={done} />
      <Button type="submit" disabled={busy}>
        {busy ? "Updating…" : "Update email"}
      </Button>
    </form>
  );
}

/** Change the signed-in user's password — requires the current one. */
function ChangePasswordForm() {
  const changePassword = useAction(api.account.changePassword);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setDone(null);
    if (next !== confirm) {
      setError("The new passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await changePassword({ currentPassword: current, newPassword: next });
      setDone("Password updated.");
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update your password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm font-semibold">Change password</p>
      <div className="space-y-2">
        <Label htmlFor="current-password">Current password</Label>
        <Input
          id="current-password"
          type="password"
          required
          autoComplete="current-password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          placeholder="••••••••"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="new-password">New password</Label>
        <Input
          id="new-password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={next}
          onChange={(event) => setNext(event.target.value)}
          placeholder="At least 8 characters"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm-password">Confirm new password</Label>
        <Input
          id="confirm-password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          placeholder="Repeat the new password"
        />
      </div>
      <FormNote error={error} done={done} />
      <Button type="submit" disabled={busy}>
        {busy ? "Updating…" : "Update password"}
      </Button>
    </form>
  );
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
  // Start from the default (true); sync the saved preference in an effect so
  // the initial render is deterministic and never mismatches hydration.
  const [repetition, setRepetition] = useState(true);

  useEffect(() => {
    setRepetition(loadPreference(REPETITION_KEY, "1", ["1", "0"]) === "1");
  }, []);

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
                <span className="font-medium">{user.email ? censorEmail(user.email) : "—"}</span>
              </p>
              <div className="mt-4 space-y-6 border-t border-border pt-4">
                <ChangeEmailForm />
                <ChangePasswordForm />
              </div>
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
          <div className="flex items-center justify-between gap-4">
            <SettingLabel
              label="Spaced repetition"
              hint={`Applies to new study sessions. Cards you answer "Again" on come back more often, at growing intervals.`}
            />
            <Switch
              checked={repetition}
              onCheckedChange={toggleRepetition}
              aria-label="Spaced repetition"
            />
          </div>
        </CardContent>
      </Card>

      {/* Sign out — the button sits on the "Session" line rather than below it */}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
          <CardTitle className="text-lg">Session</CardTitle>
          <Button
            variant="destructive"
            disabled={!isAuthenticated}
            onClick={() => {
              void signOut?.().then(() => navigate("/"));
            }}
          >
            <LogOut /> Sign out
          </Button>
        </CardHeader>
      </Card>
    </div>
  );
}