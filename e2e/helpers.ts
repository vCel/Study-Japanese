import { expect, type Page } from "@playwright/test";

const ACCORDION_TRIGGER = /Bulk import from JSON/;

/**
 * The word list the seed migration ships (`migrations/0003_word_lists.sql`).
 * Its presence on the home page is the proof that a starter-pack copy landed.
 */
export const STARTER_WORD_LIST = "JLPT N5 Starter";

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

  // Wait for the content, not for the button to go away.
  //
  // The submit button is labelled "Loading…" while the action is in flight, so
  // `expect(button).toHaveCount(0)` matches *during* the copy as well as after
  // it. That resolved the wait early and sent specs off to browse a library
  // that was still being written — rare on an idle machine, routine once the
  // suite runs in parallel and the action takes longer to land.
  //
  // A seeded list title is the thing every caller actually depends on, so it is
  // also the honest completion signal. (`goto` may have been a full navigation
  // if the click landed before hydration — either way this waits for the DOM
  // that proves the copy finished.)
  await expect(page.getByRole("heading", { name: STARTER_WORD_LIST })).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * Wait until the webfont has settled.
 *
 * Text metrics decide element heights and positions, so a spec that measures
 * geometry has to wait for this — otherwise it can measure a fallback font and
 * compare numbers that were never comparable. Cheap after the first page: the
 * font is cached for the rest of the browser context.
 *
 * This replaces `waitForLoadState("networkidle")` in those specs. The content
 * being measured is server-rendered, so the network going quiet buys nothing;
 * `goto` has already resolved on `load`, which includes the stylesheets.
 */
export async function waitForFonts(page: Page) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

/**
 * Budget for resolving an id off a listing page. The resolver has to load a
 * page first, and a dev-server page load is a couple of seconds before the
 * suite's workers start competing for the same server, so this is deliberately
 * far larger than the default assertion timeout.
 */
const ID_RESOLVE_TIMEOUT = 30_000;

function readId(href: string | null, pattern: RegExp, what: string): number {
  const match = href?.match(pattern);
  if (!match) {
    throw new Error(
      `Could not resolve the id of ${what} from href "${href}". Did seedStarterPack() run ` +
        `first? Content is owner-scoped, so an unseeded browser has nothing to link to.`,
    );
  }
  return Number(match[1]);
}

/**
 * Resolve a rule's id from its title.
 *
 * These specs used to navigate straight to `/rules/1`. That worked while the
 * seeded rows were global, but content is owner-scoped now: ids 1-3 belong to
 * rows with `owner_id IS NULL`, which no owner can see, and `seedStarterPack`
 * copies them into *new* rows with new ids. So the old hard-coded ids 404 for
 * every owner.
 *
 * Reading the id off the list page is both correct and closer to what a user
 * does — find the rule in the collection, then open it.
 */
export async function ruleIdByTitle(page: Page, title: string): Promise<number> {
  await page.goto("/rules");
  const link = page
    .locator("main [data-slot='rule-card']")
    .filter({ hasText: title })
    .first()
    .locator("a[href^='/rules/']")
    .first();
  await expect(link).toBeVisible({ timeout: ID_RESOLVE_TIMEOUT });
  return readId(await link.getAttribute("href"), /\/rules\/(\d+)/, `rule "${title}"`);
}

/** Resolve a word's id from its headword. See {@link ruleIdByTitle}. */
export async function wordIdByTitle(page: Page, word: string): Promise<number> {
  await page.goto("/words");
  const link = page
    .locator("main [data-slot='word-card']")
    .filter({ hasText: word })
    .first()
    .locator("a[href^='/words/']")
    .first();
  await expect(link).toBeVisible({ timeout: ID_RESOLVE_TIMEOUT });
  return readId(await link.getAttribute("href"), /\/words\/(\d+)/, `word "${word}"`);
}

/**
 * Resolve a word list's id from its title. See {@link ruleIdByTitle}.
 *
 * `listPath` defaults to the home page (word lists). Pass `/phrases/lists` for
 * a phrase list.
 */
export async function listIdByTitle(
  page: Page,
  title: string,
  listPath = "/",
): Promise<number> {
  await page.goto(listPath);
  const link = page
    .locator("main a[href^='/lists/']")
    .filter({ hasText: title })
    .first();
  await expect(link).toBeVisible({ timeout: ID_RESOLVE_TIMEOUT });
  return readId(await link.getAttribute("href"), /\/lists\/(\d+)/, `list "${title}" on ${listPath}`);
}

/**
 * Navigate to a create page and wait until it is safe to interact with.
 *
 * Waiting for the accordion trigger to be *visible* is not enough on its own:
 * the trigger is in the server-rendered HTML, so visibility is satisfied long
 * before React is listening. A click dispatched in that window is dropped, and
 * the accordion stays `data-state="closed"` — which then surfaces much later as
 * a mysterious "… intercepts pointer events" on the collapsed content. So this
 * waits for the trigger *and* for hydration.
 */
export async function gotoHydrated(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole("button", { name: ACCORDION_TRIGGER })).toBeVisible({
    timeout: 30_000,
  });
  await expectHydrated(page);
}

export { ACCORDION_TRIGGER };
