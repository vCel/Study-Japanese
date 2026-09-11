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
 */
const PORT = E2E_PORT;
const baseURL = E2E_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
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
  },
});
