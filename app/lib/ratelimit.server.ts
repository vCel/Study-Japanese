import { env } from "cloudflare:workers";

/**
 * Rate limiting helpers.
 *
 * Uses the native Workers Rate Limiting bindings (API_LIMITER / UPLOAD_LIMITER,
 * see wrangler.jsonc). If the bindings are not provisioned in the current
 * runtime, falls back to a per-isolate in-memory limiter so local development
 * still enforces sane limits.
 */

export const LIMITS = {
  /** JSON API reads: 60 requests per minute per key. */
  api: { fallbackLimit: 60, windowMs: 60_000 },
  /** Uploads (writes): 10 requests per minute per key. */
  upload: { fallbackLimit: 10, windowMs: 60_000 },
} as const;

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the caller may retry (only set when not allowed). */
  retryAfterSeconds?: number;
}

export function getClientIp(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

interface MemoryBucket {
  count: number;
  resetAt: number;
}

const memoryBuckets = new Map<string, MemoryBucket>();

function memoryLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const bucket = memoryBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    memoryBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }
  return { allowed: true };
}

/**
 * Enforce a rate limit. `binding` selects which Workers rate limiter to use;
 * pass `null` to always use the in-memory fallback.
 */
export async function enforceRateLimit(
  binding: "API_LIMITER" | "UPLOAD_LIMITER" | null,
  key: string,
  limitName: keyof typeof LIMITS
): Promise<RateLimitResult> {
  const { fallbackLimit, windowMs } = LIMITS[limitName];

  const limiter: { limit: (args: { key: string }) => Promise<{ success: boolean }> } | null =
    binding === "API_LIMITER"
      ? env.API_LIMITER
      : binding === "UPLOAD_LIMITER"
        ? env.UPLOAD_LIMITER
        : null;

  if (limiter && typeof limiter.limit === "function") {
    try {
      const result = await limiter.limit({ key });
      if (result.success) return { allowed: true };
      return { allowed: false, retryAfterSeconds: Math.ceil(windowMs / 1000) };
    } catch {
      // Binding unavailable/error — fall through to the in-memory limiter.
    }
  }

  return memoryLimit(`${binding ?? limitName}:${key}`, fallbackLimit, windowMs);
}