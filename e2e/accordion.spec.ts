import { expect, test } from "@playwright/test";

import { ACCORDION_TRIGGER as TRIGGER, gotoHydrated } from "./helpers";

/**
 * The collapsible panel itself (the trigger also carries `data-state`). The JSON
 * textarea is never submitted, so it has no `name` — it is found by slot.
 */
const PANEL = "[data-slot='accordion-content']";
const JSON_TEXTAREA = "[data-slot='json-import-textarea']";

test.describe("JSON bulk-import accordion", () => {
  test("is collapsed and inert until opened", async ({ page }) => {
    await gotoHydrated(page, "/lists/new");

    const panel = page.locator(PANEL);
    await expect(panel).toHaveCount(1);
    await expect(panel).toHaveAttribute("data-state", "closed");
    await expect(panel).toHaveAttribute("inert", "");

    // The textarea is in the DOM…
    await expect(page.locator(JSON_TEXTAREA)).toHaveCount(1);

    // …but it cannot take focus while collapsed, so keyboard users skip the
    // hidden import UI instead of tabbing into clipped content.
    const canFocus = await page.locator(JSON_TEXTAREA).evaluate((el) => {
      (el as HTMLElement).focus();
      return document.activeElement === el;
    });
    expect(canFocus).toBe(false);
  });

  test("expands, exposes the textarea and accepts sample JSON", async ({ page }) => {
    await gotoHydrated(page, "/lists/new");
    await page.getByRole("button", { name: TRIGGER }).click();

    const panel = page.locator(PANEL);
    await expect(panel).toHaveAttribute("data-state", "open");
    await expect(panel).not.toHaveAttribute("inert", "");

    const textarea = page.locator(JSON_TEXTAREA);
    await expect(textarea).toBeVisible();

    const canFocus = await textarea.evaluate((el) => {
      (el as HTMLElement).focus();
      return document.activeElement === el;
    });
    expect(canFocus).toBe(true);

    await page.getByRole("button", { name: "Insert sample" }).click();
    await expect(textarea).toHaveValue(/図書館/);
  });

  test("works the same on all three create pages", async ({ page }) => {
    for (const path of ["/lists/new", "/rules/new", "/phrases/new"]) {
      await gotoHydrated(page, path);
      await expect(page.getByRole("button", { name: TRIGGER })).toHaveCount(1);

      await page.getByRole("button", { name: TRIGGER }).click();
      // The JSON panel is the first accordion on the page (the rules page adds
      // one panel per rule below it).
      await expect(page.locator(PANEL).first()).toHaveAttribute("data-state", "open");
      await expect(page.getByRole("button", { name: "Insert sample" })).toBeVisible();
    }
  });
});
