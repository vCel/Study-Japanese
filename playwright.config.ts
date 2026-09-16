import { defineConfig, devices } from "@playwright/test";

import { E2E_BASE_URL, E2E_PORT } from "./e2e/test-config";

/**
 * End-to-end tests for the 日本語Vocab app.
 *
 * Prerequisites (the same ones `npm run dev` needs):
 *   1. `.env.local` with `VITE_CONVEX_URL` / Convex vars.
 *   2. A local D1 database with migrations applied:
 *      `npx wrangler d1 migrations apply japanese-vocab-db --local`
 *      (the migrations seed the sample lists used by these tests).
 *
 * The suite boots its own dev server on a dedicated port so it never clashes
 * with a dev server you already have open.
 *
 * `npm run dev` normally uses the *live* Cloudflare D1 database
 * (`"remote": true` on the binding in `wrangler.jsonc`), but these specs
 * create, edit and delete rows — so the web server below is started with
 * `CLOUDFLARE_VITE_FORCE_LOCAL=true`, which forces every binding back to the
 * local miniflare copy and keeps production data untouched.
 *
 * On timeouts: these specs run against a dev server, so every `page.goto` pays
 * for Vite's unbundled module graph — a couple of seconds each even on an idle
 * machine, and noticeably more once several workers share one server and one
 * local D1. Specs that walk a dozen pages (the page-header layout sweep) need
 * the headroom, so the per-test budget is 60s rather than Playwright's 30s.
 *
 * On workers: the whole suite is bounded by how fast the dev server can render
 * pages — measured ~80ms each idle, ~7 pages/s aggregate under load, with the
 * browser's own cache worth only ~20% (the render, not the module graph, is the
 * cost). That ceiling is why the worker count is not the knob it looks like:
 * measured 3.0 loads/s at 4 workers and 4.6 at 8, and 12 workers ran the suite
 * *slower* (2.9m vs 2.5m) and timed out the page-header sweep. So the default
 * stays cpus/2; `PW_WORKERS` is there to experiment, not to tune for CI.
 */
const PORT = E2E_PORT;
const baseURL = E2E_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : process.env.PW_WORKERS ? Number(process.env.PW_WORKERS) : undefined,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    // Keep the specs off the live D1 database: this forces every Cloudflare
    // binding back to the local miniflare copy for this dev server only.
    env: { CLOUDFLARE_VITE_FORCE_LOCAL: "true" },
  },
});
