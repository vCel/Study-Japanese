import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useAuthActions } from "@convex-dev/auth/react";

/** Sign-out helper route — clears the Convex Auth session, then redirects home. */
export default function Logout() {
  const actions = useAuthActions() as { signOut?: () => Promise<void> } | null;
  const navigate = useNavigate();

  useEffect(() => {
    void actions?.signOut?.().then(() => navigate("/", { replace: true }));
  }, [actions, navigate]);

  return (
    <p className="py-16 text-center text-sm text-muted-foreground">Signing you out…</p>
  );
}