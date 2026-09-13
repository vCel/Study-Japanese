import { Link, useNavigate } from "react-router";
import { useAuthActions } from "@convex-dev/auth/react";
import { useState } from "react";
import { UserPlus } from "lucide-react";

import { isConvexClientConfigured } from "~/components/convex-provider";
import { Button } from "~/components/lightswind/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/lightswind/card";
import { Input, Label } from "~/components/lightswind/input";

export default function Signup() {
  const actions = useAuthActions() as
    | { signIn?: (provider: string, args: Record<string, unknown>) => Promise<unknown> }
    | null;
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!isConvexClientConfigured()) {
    return (
      <div className="mx-auto max-w-md">
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Auth is not configured yet. Set <code>VITE_CONVEX_URL</code> in your environment
            (see README) to enable sign-up.
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
        flow: "signUp",
        email,
        username,
        password,
      });
      navigate("/lists/new");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the account.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Create an account</CardTitle>
          <CardDescription>
            Free to join. Accounts let you upload vocabulary to the collection.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                required
                minLength={3}
                maxLength={32}
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="e.g. your username (used to sign in)"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 8 characters"
              />
            </div>
            {error && (
              <p className="rounded-[var(--radius)] border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              <UserPlus /> {busy ? "Creating account…" : "Sign up"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Already have an account?{" "}
              <Link to="/login" className="text-primarylw hover:underline">
                Sign in
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}