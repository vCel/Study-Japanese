import { createRequestHandler } from "react-router";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

/**
 * Applied to every response. The signed-in user's Convex auth token lives in
 * the browser, so these keep it from leaking: no MIME sniffing, no referrer
 * leakage to other origins, no framing the app, and no access to device APIs.
 */
const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

export default {
  async fetch(request: Request) {
    const response = await requestHandler(request);
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      if (!headers.has(name)) headers.set(name, value);
    }
    // Hash-named assets (JS/CSS) are immutable and cache well, but *documents*
    // change on every deploy — caching them is what made the previous release
    // keep serving after a new one went live. Pages are never stored.
    const contentType = headers.get("Content-Type") ?? "";
    if (contentType.includes("text/html")) {
      headers.set("Cache-Control", "no-store");
    }
    // Only over HTTPS (never on http://localhost).
    if (new URL(request.url).protocol === "https:") {
      headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
} satisfies ExportedHandler<Env>;
