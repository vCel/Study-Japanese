import { expect, test } from "@playwright/test";

import { gotoHydrated } from "./helpers";

/**
 * The form-UX pass: custom Lightswind selects, full-width edit pages,
 * right-aligned primary buttons, destructive admin actions and toasts.
 *
 * The create pages render a fallback until the Convex client is available, so
 * they use `gotoHydrated`. The edit pages have no accordion to wait for, so the
 * assertions themselves wait for the hydrated markup.
 */

test.describe("custom select fields", () => {
  test("rule type is a custom select wired to the form", async ({ page }) => {
    await gotoHydrated(page, "/rules/new");

    const trigger = page.getByRole("button", { name: "Rule type" });
    await expect(trigger).toContainText("Word rule / form");

    await trigger.click();
    const listbox = page.getByRole("listbox");
    await expect(listbox).toBeVisible();
    await expect(listbox.getByRole("option")).toHaveCount(2);

    await listbox.getByRole("option", { name: "Sentence rule" }).click();
    await expect(page.getByRole("button", { name: "Rule type" })).toContainText("Sentence rule");

    // No native <select> survives on the page.
    await expect(page.locator("select")).toHaveCount(0);
  });

  test("part of speech uses the same component", async ({ page }) => {
    await page.goto("/words/1/edit");

    const trigger = page.getByRole("button", { name: "Part of speech" });
    await expect(trigger).toBeVisible();
    await trigger.click();

    await page.getByRole("listbox").getByRole("option", { name: "Verb", exact: true }).click();
    await expect(page.locator('input[name="pos"]')).toHaveValue("verb");
  });
});

test.describe("edit pages match the create page width", () => {
  for (const path of ["/words/1/edit", "/lists/1/edit", "/rules/1/edit"]) {
    test(`${path} is no longer column-capped`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(path);

      const container = page.locator("main > div").first();
      await expect(container).toBeVisible();

      const box = await container.boundingBox();
      expect(box).not.toBeNull();
      // Full width of the content area (viewport minus the 16rem sidebar).
      expect(box!.width).toBeGreaterThan(900);
    });
  }
});

test.describe("primary buttons align right", () => {
  test("the create button hugs the right edge of the form", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoHydrated(page, "/rules/new");

    const button = page.getByRole("button", { name: "Create rule", exact: true });
    const container = page.locator("main > div").first();
    const buttonBox = await button.boundingBox();
    const containerBox = await container.boundingBox();

    expect(buttonBox).not.toBeNull();
    expect(containerBox).not.toBeNull();
    const rightGap = containerBox!.x + containerBox!.width - (buttonBox!.x + buttonBox!.width);
    expect(rightGap).toBeLessThan(16);
  });
});

test.describe("admin delete on edit pages", () => {
  for (const { path, label } of [
    { path: "/rules/1/edit", label: "rule" },
    { path: "/words/1/edit", label: "word" },
    { path: "/lists/1/edit", label: "word list" },
  ]) {
    test(`${path} offers a delete button next to save, confirmed by an alert dialog`, async ({
      page,
    }) => {
      await page.goto(path);

      const remove = page.getByRole("button", { name: `Delete ${label}` });
      await expect(remove).toBeVisible();

      // Sits in the same action row as the submit button.
      const save = page.getByRole("button", { name: /Save changes/ });
      const removeBox = await remove.boundingBox();
      const saveBox = await save.boundingBox();
      expect(removeBox).not.toBeNull();
      expect(saveBox).not.toBeNull();
      expect(Math.abs(removeBox!.y - saveBox!.y)).toBeLessThan(24);

      // Deleting asks first, through the Lightswind alert dialog.
      await remove.click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("heading", { name: `Delete this ${label}?` })).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Yes, delete" })).toHaveAttribute(
        "name",
        "action"
      );
      // …and it submits the edit form itself, from outside the form element.
      await expect(dialog.getByRole("button", { name: "Yes, delete" })).toHaveAttribute(
        "form",
        /-form$/
      );

      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await expect(remove).toBeVisible();
    });
  }
});

test.describe("toasts", () => {
  test("a rejected save surfaces an error toast", async ({ page }) => {
    await page.goto("/words/1/edit");

    // The edit form is pre-filled and valid, so this reaches the server action,
    // which rejects it because the test browser has no auth token.
    await page.getByRole("button", { name: "Save changes" }).click();

    const toast = page.locator('[data-slot="toast"]');
    await expect(toast).toBeVisible();
    await expect(toast).toHaveAttribute("data-variant", "error");
  });
});
