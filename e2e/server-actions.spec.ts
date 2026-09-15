import { expect, test } from "@playwright/test";

import { gotoHydrated, stubConvex } from "./helpers";

/**
 * Exercises the server actions without signing in. Signed-out users can create
 * content — it is scoped to their device (a `jv_device` cookie) and is private
 * to them, so the writes below must succeed.
 *
 * Success is asserted through the write's outcome, not through
 * `getByRole("alert")`: `FormMessage` only sets that role for its *error* tone,
 * so an alert can only ever mean the write failed, and both create forms
 * redirect on success anyway. The old assertions were therefore unfalsifiable.
 */
test.describe("signed-out creation", () => {
  test("adding phrases works signed out", async ({ page }) => {
    await stubConvex(page);
    await gotoHydrated(page, "/phrases/new");

    // The form starts with one empty row, and the action requires phrase, kana
    // and meaning — so the row has to be filled in for this to be a write test.
    // `exact` matters: the labels are "Phrase 1", "Phrase 1 (kana)",
    // "Phrase 1 meaning 1", … so a substring match is ambiguous.
    await page.getByLabel("Phrase 1", { exact: true }).fill("おはよう");
    await page.getByLabel("Phrase 1 (kana)", { exact: true }).fill("おはよう");
    await page.getByLabel("Phrase 1 meaning 1", { exact: true }).fill("Good morning");

    await page.getByRole("button", { name: "Add phrases", exact: true }).click();

    // Success sends the reader to the phrases list (the form's `returnTo`), so
    // the proof of the write is the new phrase there. Asserting the inline
    // success message would be a race against that navigation — it is on screen
    // only for the moment between the action resolving and the redirect.
    await expect(page).toHaveURL(/\/phrases$/);
    await expect(
      page.locator("main").getByRole("heading", { name: "おはよう" }),
    ).toBeVisible();
  });

  test("creating a word list works signed out", async ({ page }) => {
    await stubConvex(page);
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

    // This form sends the reader back to where they came from once the list is
    // created, so the proof of the write is the new list on the home page — not
    // a message on the form they just left.
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.locator("main").getByRole("heading", { name: "e2e temporary list" }),
    ).toBeVisible();
  });
});
