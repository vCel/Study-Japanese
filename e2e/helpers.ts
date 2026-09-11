import { expect, type Page } from "@playwright/test";

const ACCORDION_TRIGGER = /Bulk import from JSON/;

/**
 * Wait until React has hydrated the server-rendered markup.
 *
 * React tags the host nodes it adopts with internal `__reactFiber$…` keys, so
 * their absence tells us the page is still static HTML. Clicks dispatched
 * before hydration completes are silently dropped, which makes otherwise
 * correct specs flaky.
 */
export async function waitForHydration(page: Page) {
  await page.waitForFunction(
    () => {
      const el = document.querySelector("main") ?? document.body;
      return Object.keys(el).some((key) => key.startsWith("__reactFiber$"));
    },
    undefined,
    { timeout: 30_000 }
  );
}

/**
 * Navigate to a page and wait until the app is hydrated.
 *
 * The create pages render an "auth not configured" fallback during SSR and only
 * swap in the real form once the Convex client is available in the browser, so
 * assertions must not run against the server-rendered markup alone.
 */
export async function gotoHydrated(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole("button", { name: ACCORDION_TRIGGER })).toBeVisible({
    timeout: 30_000,
  });
}

export { ACCORDION_TRIGGER };
