import type { Route } from "./+types/api.docs";

import { enforceRateLimit, getClientIp } from "~/lib/ratelimit.server";

/**
 * GET /api — public metadata about the JSON API (no data).
 * Rate limited per IP like every other API endpoint.
 */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  const limit = await enforceRateLimit("API_LIMITER", getClientIp(request), "api");
  if (!limit.allowed) {
    return Response.json(
      { error: "Rate limit exceeded. Please slow down." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds ?? 60) } }
    );
  }

  return Response.json({
    name: "日本語Vocab API",
    version: 1,
    authentication: {
      required: true,
      description:
        "The JSON API is limited to registered users. Sign in via the website, then pass your Convex auth token as an 'Authorization: Bearer <token>' header.",
    },
    rateLimit: {
      apiReads: "60 requests per minute per IP",
      uploads: "10 requests per minute per user",
    },
    endpoints: {
      "GET /api/lists": "Paginated word lists with tags and word counts (?page=<n>) · auth required",
      "GET /api/words": "Paginated vocabulary (?q=<search>&page=<n>) · auth required",
      "GET /api/words/:id": "Word detail with meanings, examples and list info · auth required",
      "GET /api/examples": "Paginated example sentences (?page=<n>) · auth required",
    },
  });
}