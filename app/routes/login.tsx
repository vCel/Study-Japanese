import { Link, useNavigate } from "react-router";
import { useAuthActions } from "@convex-dev/auth/react";
import { useState } from "react";
import { LogIn } from "lucide-react";

import { isAuthConfigured } from "~/components/convex-provider";
import { Button } from "~/components/lightswind/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/lightswind/card";
import { Input, Label } from "~/components/lightswind/input";

export default function Login() {
  const actions = useAuthActions() as
    | { signIn?: (provider: string, args: Record<string, unknown>) => Promise<unknown> }
    | null;
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showReset, setShowReset] = useState(false);

  if (!isAuthConfigured()) {
    return (
      <div className="mx-auto max-w-md">
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Auth is not configured yet. Set <code>VITE_CONVEX_URL</code> in your environment
            (see README) to enable sign-in.
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await actions?.signIn?.("password", {
        flow: "signIn",
        identifier: identifier.trim(),
        password,
      });
      navigate("/lists/new");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid credentials.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Welcome back</CardTitle>
          <CardDescription>
            Sign in with your username or email to upload your own word lists.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="identifier">Email or username</Label>
              <Input
                id="identifier"
                required
                autoComplete="username"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder="you@example.com or username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
              />
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                className="cursor-pointer text-xs font-medium text-primarylw hover:underline"
                onClick={() => setShowReset((visible) => !visible)}
              >
                {showReset ? "Hide password help" : "Forgot password?"}
              </button>
            </div>
            {showReset && (
              <div className="rounded-[var(--radius)] border border-border bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
                Password reset isn&apos;t set up on this site yet. Please contact the site owner
                if you&apos;ve forgotten your password.
              </div>
            )}
            {error && (
              <p className="rounded-[var(--radius)] border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              <LogIn /> {busy ? "Signing in…" : "Sign in"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              No account yet?{" "}
              <Link to="/signup" className="text-primarylw hover:underline">
                Sign up
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}