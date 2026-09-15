import { chromium } from "@playwright/test";

import { E2E_BASE_URL } from "./test-config";

/**
 * Warms the dev server up before the suite runs.
 *
 * Two dev-server quirks would otherwise make the first tests flaky:
 *   1. Vite optimizes dependencies on the first request and can serve a stale
 *      module graph (an "Outdated Optimize Dep" 504), which delays hydration.
 *   2. The create pages are client-rendered — they render an "auth not
 *      configured" fallback during SSR and swap in the real form once the
 *      Convex client exists in the browser.
 *
 * So we pay those costs once here, and every spec starts from a hydrated app.
 *
 * Do NOT try to extend this into a route warm-up for the whole suite. It was
 * tried: walking every route here to prime Vite's transform cache made no
 * measurable difference to the specs it was meant to help (the header sweep
 * went 35.9s → 41.7s, and total wall time rose with it). The reason is that
 * this uses a separate browser context, so it warms the *server's* transform
 * cache but not the browser-side module re-fetch, and the latter is what
 * dominates a dev-server page load.
 */
export default async function globalSetup() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    // First hit triggers dependency optimization; ignore a transient failure.
    await page.goto(E2E_BASE_URL, { waitUntil: "networkidle" }).catch(() => {});

    await page.goto(`${E2E_BASE_URL}/lists/new`, { waitUntil: "networkidle" });
    await page
      .getByRole("button", { name: /Bulk import from JSON/ })
      .waitFor({ timeout: 90_000 });
  } finally {
    await browser.close();
  }
}
