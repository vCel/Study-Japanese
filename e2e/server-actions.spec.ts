import { expect, test } from "@playwright/test";

import { gotoHydrated } from "./helpers";

/**
 * Exercises the server actions end-to-end without signing in. Every request is
 * rejected before any write, so the seeded data is never mutated.
 */
test.describe("signed-out guards", () => {
  test("adding phrases is rejected", async ({ page }) => {
    await gotoHydrated(page, "/phrases/new");
    await page.getByRole("button", { name: "Add phrases", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(/signed in/i);
  });

  test("creating a word list is rejected", async ({ page }) => {
    await gotoHydrated(page, "/lists/new");
    // Filling from JSON never writes — the write only happens on submit.
    await page.locator("#title").fill("e2e temporary list");
    await page.getByRole("button", { name: /Bulk import from JSON/ }).click();
    await page
      .locator("[data-slot='json-import-textarea']")
      .fill('[{"word":"猫","kana":"ねこ","meanings":["cat"]}]');
    await page.getByRole("button", { name: "Fill form from JSON", exact: true }).click();
    await expect(page).toHaveURL(/\/lists\/new$/);

    await page.getByRole("button", { name: "Create word list", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(/signed in/i);
  });
});
