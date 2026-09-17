#!/usr/bin/env node
/**
 * Checks how `resolveOwnerFromRequest` classifies the viewer, in the two cases
 * that used to be indistinguishable from "signed out".
 *
 * **A stale JWT.** The JWT Convex Auth issues lasts an hour; the cookie carrying
 * it lasts thirty days. A tab left open therefore presents a token the browser
 * can renew but the server cannot validate, and reading that as "signed out"
 * served the device-scoped library to a signed-in user until the next reload.
 *
 * **An unreachable Convex.** A refused token and a deployment that never answered
 * are opposite things — one is a signed-out viewer, the other is an outage — and
 * `ConvexHttpClient` collapses both into one thrown Error. Resolving the second
 * as the first shows a signed-in user a library that is not theirs, and lets them
 * add to it under the device owner.
 *
 * It cannot be a Playwright spec. The owner is resolved on the *server* (root
 * middleware), and the suite's `stubConvex` is a browser route — a server-side
 * `ConvexHttpClient` call never passes through it, so no spec can hand the
 * resolver a stale token or an outage. Instead this bundles
 * `app/lib/owner.server.ts` with esbuild and answers Convex's HTTP API from a
 * stub, so the shipped module runs unmodified.
 *
 * The fallback cases are the control: they require the device owner when the
 * session genuinely cannot be recovered, so a stub that answered "account" for
 * everything — or a resolver that threw on every failure — cannot pass.
 *
 * Usage:  node scripts/owner-refresh-guard.mjs
 */

import { createRequire } from "node:module";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Never the real deployment: `validateDeploymentUrl` only checks the shape, and
// the point of the stub is that no request leaves this process.
const FAKE_URL = "https://owner-refresh-guard.convex.cloud";

const USER = {
  id: "user_1",
  email: "owner@example.test",
  name: null,
  username: "owner",
};

const GOOD_JWT = "header.payload.good";
const STALE_JWT = "header.payload.stale";
const GOOD_REFRESH = "refresh-token-live";
const DEAD_REFRESH = "refresh-token-spent";
const FRESH_JWT = "header.payload.renewed";

// ---------------------------------------------------------------- the stub
//
// Convex's HTTP API: POST /api/query and /api/action with `{ path, args }`, the
// token in `Authorization: Bearer`. Answers are `{ status, value }`.
//
// `mode` forces the two shapes an outage takes, which the client collapses into
// one thrown Error: `offline` never gets a response at all, `broken` answers 5xx.
let refreshCalls = 0;
let mode = "normal";

function convexResponse(value) {
  return new Response(JSON.stringify({ status: "success", value }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function convexError(message) {
  return new Response(JSON.stringify({ status: "error", errorMessage: message }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

globalThis.fetch = async (url, init) => {
  if (mode === "offline") throw new TypeError("fetch failed");
  if (mode === "broken") return new Response("upstream unavailable", { status: 503 });

  const path = new URL(url).pathname;
  const body = JSON.parse(init.body);
  const token = (init.headers.Authorization ?? "").replace(/^Bearer\s+/, "");

  if (path === "/api/action") {
    if (body.path !== "auth:signIn") return convexError(`unexpected action ${body.path}`);
    const presented = body.args[0]?.refreshToken;
    if (presented !== GOOD_REFRESH) return convexError("Invalid refresh token");
    refreshCalls += 1;
    return convexResponse({ tokens: { token: FRESH_JWT, refreshToken: "refresh-token-rotated" } });
  }

  if (path !== "/api/query") return convexError(`unexpected endpoint ${path}`);

  // A real deployment rejects a bad signature, which is what a stale JWT is.
  if (token !== GOOD_JWT && token !== FRESH_JWT) return convexError("Invalid JWT");

  if (body.path === "users:getAuthenticatedUser") return convexResponse(USER);
  if (body.path === "users:isCurrentUserAdmin") return convexResponse(true);
  return convexError(`unexpected query ${body.path}`);
};

// ---------------------------------------------------------------- the bundle
const { build } = createRequire(join(ROOT, "package.json"))("esbuild");
const OUT_DIR = join(tmpdir(), "owner-refresh-guard");
mkdirSync(OUT_DIR, { recursive: true });

const result = await build({
  stdin: {
    contents: `export * from ${JSON.stringify(join(ROOT, "app/lib/owner.server.ts"))};`,
    resolveDir: ROOT,
    loader: "ts",
    sourcefile: "guard-entry.ts",
  },
  bundle: true,
  format: "esm",
  platform: "neutral",
  write: false,
  logLevel: "warning",
  // `ratelimit.server.ts` reaches for the Workers binding; the resolver never
  // touches it, so an empty env is enough.
  plugins: [
    {
      name: "worker-stubs",
      setup(b) {
        b.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: "stub", namespace: "stub" }));
        b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
          contents: "export const env = {};",
          loader: "js",
        }));
        // Vite's `~` alias points at `app/`. esbuild treats a resolved path as
        // final, so the extension has to be probed here.
        b.onResolve({ filter: /^~\// }, (args) => {
          const base = join(ROOT, "app", args.path.slice(2));
          for (const candidate of [base, `${base}.ts`, `${base}.tsx`]) {
            try {
              if (statSync(candidate).isFile()) return { path: candidate };
            } catch {
              // try the next candidate
            }
          }
          return { errors: [{ text: `cannot resolve ${args.path}` }] };
        });
      },
    },
  ],
  define: { "import.meta.env": JSON.stringify({ VITE_CONVEX_URL: FAKE_URL }) },
});

const outfile = join(OUT_DIR, "owner.server.mjs");
writeFileSync(outfile, result.outputFiles[0].text);
const { resolveOwnerFromRequest, AuthUnavailableError } = await import(pathToFileURL(outfile).href);

// ---------------------------------------------------------------- the checks
const DEVICE = "device-1";

function requestWith(cookies) {
  const header = [`jv_device=${DEVICE}`, ...cookies].join("; ");
  return new Request("https://app.test/", { headers: { Cookie: header } });
}

/** Resolve one request and report what it saw. */
async function resolve(cookies, requestedMode = "normal") {
  refreshCalls = 0;
  mode = requestedMode;
  try {
    const owner = await resolveOwnerFromRequest(requestWith(cookies));
    return { owner, outage: false };
  } catch (error) {
    // An unidentified viewer must be reported as an outage, never resolved.
    if (error instanceof AuthUnavailableError) return { owner: null, outage: true };
    throw error;
  } finally {
    mode = "normal";
  }
}

const cases = [
  {
    name: "a live JWT resolves the account",
    cookies: [`jv_jwt=${GOOD_JWT}`],
    expect: { ownerId: USER.id, user: USER.id, isAdmin: true, refreshes: 0, outage: false },
  },
  {
    name: "a stale JWT with a live refresh token still resolves the account",
    cookies: [`jv_jwt=${STALE_JWT}`, `jv_refresh=${GOOD_REFRESH}`],
    expect: { ownerId: USER.id, user: USER.id, isAdmin: true, refreshes: 1, outage: false },
  },
  {
    name: "no JWT but a live refresh token resolves the account",
    cookies: [`jv_refresh=${GOOD_REFRESH}`],
    expect: { ownerId: USER.id, user: USER.id, isAdmin: true, refreshes: 1, outage: false },
  },
  {
    name: "a stale JWT and a spent refresh token falls back to the device",
    cookies: [`jv_jwt=${STALE_JWT}`, `jv_refresh=${DEAD_REFRESH}`],
    expect: { ownerId: DEVICE, user: null, isAdmin: false, refreshes: 0, outage: false },
  },
  {
    name: "a stale JWT with no refresh token cookie falls back to the device",
    cookies: [`jv_jwt=${STALE_JWT}`],
    expect: { ownerId: DEVICE, user: null, isAdmin: false, refreshes: 0, outage: false },
  },
  {
    name: "no tokens at all falls back to the device",
    cookies: [],
    expect: { ownerId: DEVICE, user: null, isAdmin: false, refreshes: 0, outage: false },
  },
  {
    name: "an unreachable Convex with a token is an outage, not a sign-out",
    cookies: [`jv_jwt=${GOOD_JWT}`],
    mode: "offline",
    expect: { ownerId: null, user: null, isAdmin: false, refreshes: 0, outage: true },
  },
  {
    name: "an unreachable Convex mid-refresh is an outage too",
    cookies: [`jv_jwt=${STALE_JWT}`, `jv_refresh=${GOOD_REFRESH}`],
    mode: "offline",
    expect: { ownerId: null, user: null, isAdmin: false, refreshes: 0, outage: true },
  },
  {
    name: "a 5xx from Convex reads as an outage, not a refused token",
    cookies: [`jv_jwt=${GOOD_JWT}`],
    mode: "broken",
    expect: { ownerId: null, user: null, isAdmin: false, refreshes: 0, outage: true },
  },
  {
    name: "an outage with no token still resolves the device (blast radius)",
    cookies: [],
    mode: "offline",
    expect: { ownerId: DEVICE, user: null, isAdmin: false, refreshes: 0, outage: false },
  },
];

let failures = 0;

for (const { name, cookies, mode: requestedMode, expect } of cases) {
  const { owner, outage } = await resolve(cookies, requestedMode);
  const actual = {
    ownerId: owner?.ownerId ?? null,
    user: owner?.user?.id ?? null,
    isAdmin: owner?.isAdmin ?? false,
    refreshes: refreshCalls,
    outage,
  };
  const wrong = Object.keys(expect).filter((key) => actual[key] !== expect[key]);
  if (wrong.length > 0) failures += 1;
  console.log(
    `${wrong.length === 0 ? "ok  " : "FAIL"} ${name}` +
      (wrong.length === 0
        ? ""
        : `\n       ${wrong.map((key) => `${key}: expected ${expect[key]}, got ${actual[key]}`).join("\n       ")}`),
  );
}

if (failures > 0) {
  console.log(
    `\n${failures} of ${cases.length} failed. A "still resolves the account" case failing means a ` +
      `signed-in viewer is served the device-scoped library until the next reload — check that ` +
      `resolveOwnerFromRequest still refreshes when the JWT does not validate. An "outage" case ` +
      `failing means an unreachable Convex is being read as a signed-out viewer.`,
  );
}
process.exit(failures > 0 ? 1 : 0);
