import type { Route } from "./+types/api.examples";

import { guardApiRequest } from "~/lib/auth.server";
import { listExamples } from "~/lib/db.server";

/**
 * GET /api/examples?page=<n> — JSON example sentences with their source word.
 * Restricted to registered users; rate limited per IP (60/min).
 */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  const guard = await guardApiRequest(request);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1;

  const result = await listExamples(guard.user.id, Number.isNaN(page) ? 1 : page);
  return Response.json({ requestedBy: guard.user.id, ...result });
}