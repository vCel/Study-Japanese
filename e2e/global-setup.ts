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
