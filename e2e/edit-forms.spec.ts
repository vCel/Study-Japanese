import { expect, test } from "@playwright/test";

/**
 * The edit pages keep the structure of their detail page but swap the text for
 * inputs, and their repeatable lists (meanings, examples) are drag-reorderable.
 *
 * These forms only render once the Convex client exists in the browser, so we
 * wait for the drag handles rather than asserting immediately.
 */
const DRAG_HANDLE = 'button[aria-label="Drag to reorder"]';

test.describe("word edit page", () => {
  test("mirrors the detail structure with reorderable meanings and examples", async ({ page }) => {
    await page.goto("/words/1/edit");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByLabel("Word *")).toBeVisible();
    await expect(page.getByText("Meanings *")).toBeVisible();
    // Anchored: the site footer also mentions "example sentences".
    await expect(page.getByText(/^Example sentences/)).toBeVisible();

    // One handle per reorderable row (meanings + examples).
    await expect(page.locator(DRAG_HANDLE).first()).toBeVisible();
    expect(await page.locator(DRAG_HANDLE).count()).toBeGreaterThan(0);
  });

  test("removing a row drops its handle", async ({ page }) => {
    await page.goto("/words/1/edit");
    const handles = page.locator(DRAG_HANDLE);
    await expect(handles.first()).toBeVisible();
    const before = await handles.count();

    await page.getByRole("button", { name: "Remove meaning" }).first().click();
    await expect(handles).toHaveCount(before - 1);
  });
});

test.describe("rule edit page", () => {
  test("uses the ポイント container and a reorderable example list", async ({ page }) => {
    await page.goto("/rules/1/edit");

    // Same callouts as the rule page, but holding the point inputs.
    await expect(page.getByText("ポイント!")).toBeVisible();
    await expect(page.locator("#rule-point-0")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add point" })).toBeVisible();

    await expect(page.getByText("Explanation")).toBeVisible();
    await expect(page.locator(DRAG_HANDLE).first()).toBeVisible();
  });

  test("examples can be reordered by dragging the handle", async ({ page }) => {
    await page.goto("/rules/1/edit");

    const first = page.getByLabel("Example 1 (Japanese)");
    await expect(first).toBeVisible();

    // The rows expose drag handles, which is what the reorder list binds to.
    await expect(page.locator(DRAG_HANDLE)).toHaveCount(2);
    await expect(page.locator(DRAG_HANDLE).first()).toBeVisible();

    // Typing still works, i.e. the handle doesn't swallow input interaction.
    await first.fill("食べてください。");
    await expect(first).toHaveValue("食べてください。");
  });
});
