import type { Route } from "./+types/api.sync";

import { hasContent, reownerContent } from "~/lib/db.server";
import { ownerContext } from "~/lib/owner.server";

/**
 * Sign-in sync: between the device-scoped library (saved while signed out) and
 * the account library (cross-device).
 *
 * GET  /api/sync — whether the current device holds content that is not yet
 *                  part of the signed-in account (so the client can offer to
 *                  merge it).
 * POST /api/sync — move the device's content into the signed-in account
 *                  (device rows are re-owned to the account). Requires a
 *                  signed-in session.
 */
export async function loader({ context }: Route.LoaderArgs): Promise<Response> {
  const owner = context.get(ownerContext);
  if (!owner || !owner.user) {
    return Response.json({ deviceHasContent: false, signedIn: false });
  }
  // Only meaningful when the device differs from the account.
  const deviceHasContent =
    owner.deviceId !== owner.ownerId && (await hasContent(owner.deviceId));
  return Response.json({ deviceHasContent, signedIn: true });
}

export async function action({ context }: Route.ActionArgs): Promise<Response> {
  const owner = context.get(ownerContext);
  if (!owner || !owner.user) {
    return Response.json({ error: "Please sign in to sync your library." }, { status: 401 });
  }
  if (owner.deviceId === owner.ownerId) {
    return Response.json({ moved: 0 });
  }
  const moved = await reownerContent(owner.deviceId, owner.ownerId);
  return Response.json({ moved });
}
