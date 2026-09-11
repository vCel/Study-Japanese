import type { Route } from "./+types/api.word";

import { guardApiRequest } from "~/lib/auth.server";
import { getWord } from "~/lib/db.server";

/**
 * GET /api/words/:id — JSON word detail (meanings + examples).
 * Restricted to registered users; rate limited per IP (60/min).
 */
export async function loader({ request, params }: Route.LoaderArgs): Promise<Response> {
  const guard = await guardApiRequest(request);
  if (!guard.ok) return guard.response;

  const id = Number.parseInt(params.id ?? "", 10);
  if (Number.isNaN(id)) {
    return Response.json({ error: "Invalid word id." }, { status: 400 });
  }

  const word = await getWord(id);
  if (!word) {
    return Response.json({ error: "Word not found." }, { status: 404 });
  }

  return Response.json({ requestedBy: guard.user.id, word });
}