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
 * Like {@link waitForHydration}, but fails with a readable message instead of
 * a bare timeout.
 *
 * "Debugging by hydration" is miserable when the page looks perfectly fine in a
 * screenshot: the served HTML is complete, so a stalled hydration shows up only
 * as every locator mysteriously resolving to zero elements.
 */
export async function expectHydrated(page: Page) {
  try {
    await waitForHydration(page);
  } catch {
    const framings = await page.evaluate(() =>
      Array.from(document.querySelectorAll("main, main *"))
        .flatMap((el) => Object.keys(el))
        .filter((key) => key.startsWith("__reactContainer") || key.startsWith("__reactFiber"))
        .length
    );
    throw new Error(
      `React never hydrated ${page.url()} (found ${framings} React-internal keys). ` +
        `The most common cause is a client-only provider blocking on the network — ` +
        `was stubConvex() installed before goto()?`,
    );
  }
}

/**
 * Neutralise Convex for this page.
 *
 * The app wraps everything in `ConvexClientProvider` whenever `VITE_CONVEX_URL`
 * is set, which it is in `.env.local`. `ConvexAuthProvider` performs its
 * initial auth handshake during hydration, and when that handshake has to go
 * out to convex.cloud a couple of things can go wrong:
 *
 *   1. The request may not resolve in this environment (proxy / offline /
 *      sandbox), and React's hydration never commits — the page stays static
 *      HTML and every locator finds nothing.
 *   2. Even when it does resolve, it makes the suite depend on a live backend
 *      and on the network, which is exactly what an e2e suite should not do.
 *
 * So every Convex HTTP endpoint is answered locally with an empty, signed-out
 * response. The app already treats "signed out" as a first-class state (empty
 * stars, empty quiz log), so the UI under test renders its normal signed-out
 * shape and hydration completes synchronously.
 *
 * Returns a getter for the number of stubbed calls, which spec authors can use
 * to assert that an action actually reached Convex.
 */
export async function stubConvex(page: Page) {
  let calls = 0;

  // `.convex.cloud` carries the HTTP API + websocket; `.convex.site` carries
  // the HTTP router. Both are needed, and the pattern is host-agnostic so it
  // works against whoever's deployment `.env.local` points at.
  await page.route(/(^|\.)convex\.(cloud|site)$/, async (route) => {
    calls += 1;
    const url = new URL(route.request().url());
    // The websocket sync endpoint must be abandoned, not fulfilled — a
    // fulfilled non-101 response is what makes the client retry forever.
    if (url.pathname.startsWith("/api/sync")) {
      await route.abort();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      // Empty by design: no auth session, no query results. The app renders
      // its signed-out state, which is what these specs assert against.
      body: "{}",
    });
  });

  return () => calls;
}

/**
 * Give this browser's owner a copy of the starter pack.
 *
 * Content is owner-scoped: the seeded rows in D1 have `owner_id IS NULL` and
 * are invisible until an owner opts into copying them (see
 * `copyStarterPack` in app/lib/db.server.ts). A fresh browser context therefore
 * starts with a genuinely *empty* library — the home page shows the onboarding
 * card, and any spec that needs real words or rules must accept it first.
 *
 * This is the difference between a spec that passes and one that quietly
 * depends on a developer's pre-populated local database: the owner here is the
 * per-context `jv_device` cookie, so it is created fresh for every test.
 */
export async function seedStarterPack(page: Page) {
  await page.goto("/");
  const button = page.getByRole("button", { name: "Start with the starter pack" });
  // The card only renders when the owner has no content and has not chosen yet.
  if ((await button.count()) === 0) return;
  await button.click();
  await expect(button).toHaveCount(0, { timeout: 15_000 });
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
