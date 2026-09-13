import type { Route } from "./+types/api.words";

import { guardApiRequest } from "~/lib/auth.server";
import { listWords } from "~/lib/db.server";

/**
 * GET /api/words?q=<search>&page=<n> — JSON vocabulary list.
 * Restricted to registered users; rate limited per IP (60/min).
 */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  const guard = await guardApiRequest(request);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const search = url.searchParams.get("q")?.trim() || null;
  const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1;

  const result = await listWords(guard.user.id, search, Number.isNaN(page) ? 1 : page);
  return Response.json({ requestedBy: guard.user.id, ...result });
}