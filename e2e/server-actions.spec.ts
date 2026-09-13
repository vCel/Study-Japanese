import { expect, test } from "@playwright/test";

import { gotoHydrated } from "./helpers";

/**
 * Exercises the server actions without signing in. Signed-out users can now
 * create content — it is scoped to their device (a `jv_device` cookie) and is
 * private to them, so the writes below must succeed.
 */
test.describe("signed-out creation", () => {
  test("adding phrases works signed out", async ({ page }) => {
    await gotoHydrated(page, "/phrases/new");
    await page.getByRole("button", { name: "Add phrases", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(/added/i);
  });

  test("creating a word list works signed out", async ({ page }) => {
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
    await expect(page.getByRole("alert")).toContainText(/created/i);
  });
});
