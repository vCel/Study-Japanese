import { expect, test } from "@playwright/test";

import { ACCORDION_TRIGGER, gotoHydrated } from "./helpers";

/**
 * Every create page should look the same: a heading, one collapsible JSON
 * accordion above the button row, and — inside a single form — the primary
 * create button plus *Fill form from JSON*.
 *
 * None of the pages write on import: filling populates the form's own fields so
 * they can be reviewed first.
 */
const CREATE_PAGES = [
  {
    path: "/lists/new",
    heading: "Add word list",
    manualSubmit: "Create word list",
  },
  {
    path: "/rules/new",
    heading: "Add rule",
    manualSubmit: "Create rule",
  },
  {
    path: "/phrases/new",
    heading: "Add phrases",
    manualSubmit: "Add phrases",
  },
];

const JSON_TEXTAREA = "[data-slot='json-import-textarea']";
const FILL_BUTTON = "Fill form from JSON";

test.describe("create pages share one layout", () => {
  for (const { path, heading, manualSubmit } of CREATE_PAGES) {
    test(`${path} renders the manual form + JSON accordion`, async ({ page }) => {
      await gotoHydrated(page, path);

      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();

      // Exactly one bulk-import accordion, with a large JSON textarea in it.
      await expect(page.getByRole("button", { name: ACCORDION_TRIGGER })).toHaveCount(1);
      await expect(page.locator(JSON_TEXTAREA)).toHaveCount(1);

      // The create button and the fill-from-JSON action…
      await expect(page.getByRole("button", { name: manualSubmit, exact: true })).toHaveCount(1);
      await page.getByRole("button", { name: ACCORDION_TRIGGER }).click();
      await expect(page.getByRole("button", { name: FILL_BUTTON, exact: true })).toHaveCount(1);

      // …in one form, with the JSON accordion above the create button.
      const trigger = await page.getByRole("button", { name: ACCORDION_TRIGGER }).boundingBox();
      const submit = await page
        .getByRole("button", { name: manualSubmit, exact: true })
        .boundingBox();
      expect(trigger).not.toBeNull();
      expect(submit).not.toBeNull();
      expect(trigger!.y).toBeLessThan(submit!.y);

      // The JSON import reuses the page's own title/tags fields instead of
      // asking for them a second time, and the textarea is never submitted.
      await expect(page.locator("#json-title")).toHaveCount(0);
      await expect(page.locator("#json-tags")).toHaveCount(0);
      await expect(page.locator(`${JSON_TEXTAREA}[name]`)).toHaveCount(0);
      await expect(page.locator("form")).toHaveCount(1);
    });
  }

  test("all three pages share the same header shape", async ({ page }) => {
    const heights: number[] = [];

    for (const { path, heading } of CREATE_PAGES) {
      await gotoHydrated(page, path);
      await expect(page.locator("main h1")).toHaveText(new RegExp(heading));
      // PageHeader always renders the breadcrumb row and the subtitle line, so
      // the top of the page is the same shape on every page.
      await expect(page.locator("main [data-slot='page-header']")).toHaveCount(1);
      await expect(page.locator("main [data-slot='page-subtitle']")).toHaveCount(1);
      const crumbs = page.getByRole("navigation", { name: "breadcrumb" });
      await expect(crumbs).toHaveCount(1);
      // The ancestor is a link; the page itself is the last, current crumb.
      await expect(crumbs.locator("a")).toHaveCount(1);
      await expect(crumbs.locator("[aria-current='page']")).toHaveText(heading);
      // …and the accordion trigger label is identical everywhere.
      await expect(page.getByRole("button", { name: ACCORDION_TRIGGER })).toBeVisible();

      const box = await page.locator("main [data-slot='page-header']").boundingBox();
      expect(box).not.toBeNull();
      heights.push(Math.round(box!.height));
    }

    // …and it never changes height from page to page.
    expect(new Set(heights).size).toBe(1);
  });
});

/**
 * Importing JSON fills the form's own fields (rows / rule panels) instead of
 * writing anything — on every create page.
 */
test.describe("filling the form from JSON", () => {
  test("word lists: rows appear with meanings, examples and reorder handles", async ({ page }) => {
    await gotoHydrated(page, "/lists/new");

    // One empty row with a drag handle to start with.
    await expect(page.getByRole("button", { name: "Drag to reorder" })).toHaveCount(1);
    await page.locator("#title").fill("Imported list");

    await page.getByRole("button", { name: ACCORDION_TRIGGER }).click();
    await page.locator(JSON_TEXTAREA).fill(
      JSON.stringify([
        {
          word: "図書館",
          kana: "としょかん",
          pos: "noun",
          meanings: ["library", "book building"],
          examples: [{ japanese: "図書館へ行く", translation: "go to the library" }],
        },
        { word: "水", kana: "みず", meanings: ["water"] },
      ])
    );
    await page.getByRole("button", { name: FILL_BUTTON, exact: true }).click();

    // Two rows, fully populated — including the second meaning and the example.
    await expect(page.getByRole("button", { name: "Drag to reorder" })).toHaveCount(2);
    await expect(page.getByLabel("Word 1", { exact: true })).toHaveValue("図書館");
    await expect(page.getByLabel("Word 1 (kana)", { exact: true })).toHaveValue("としょかん");
    await expect(page.getByLabel("Word 1 meaning 2", { exact: true })).toHaveValue(
      "book building"
    );
    await expect(page.getByLabel("Word 1 example 1 (Japanese)", { exact: true })).toHaveValue(
      "図書館へ行く"
    );
    await expect(page.getByLabel("Word 2", { exact: true })).toHaveValue("水");
    await expect(page.getByText("2 of 2 ready")).toBeVisible();

    // Still on the create page: filling never submits, so there is no
    // "please fill in this field" prompt for the untouched required fields.
    await expect(page).toHaveURL(/\/lists\/new$/);
  });

  test("phrases: rows are filled and marked as phrases", async ({ page }) => {
    await gotoHydrated(page, "/phrases/new");

    await page.getByRole("button", { name: ACCORDION_TRIGGER }).click();
    await page.locator(JSON_TEXTAREA).fill(
      JSON.stringify([{ word: "おはよう", kana: "おはよう", meanings: ["Good morning"] }])
    );
    await page.getByRole("button", { name: FILL_BUTTON, exact: true }).click();

    await expect(page.getByLabel("Phrase 1", { exact: true })).toHaveValue("おはよう");
    await expect(page.getByLabel("Phrase 1 meaning 1", { exact: true })).toHaveValue(
      "Good morning"
    );
    // Phrases have no part-of-speech picker.
    await expect(page.getByRole("button", { name: /part of speech/ })).toHaveCount(0);
    await expect(page).toHaveURL(/\/phrases\/new$/);
  });

  test("invalid JSON reports the problem and keeps the form", async ({ page }) => {
    await gotoHydrated(page, "/lists/new");
    await page.locator("#title").fill("Kept");
    await page.getByRole("button", { name: ACCORDION_TRIGGER }).click();
    await page.locator(JSON_TEXTAREA).fill("{ nope");
    await page.getByRole("button", { name: FILL_BUTTON, exact: true }).click();

    await expect(page.getByRole("alert")).toContainText(/Could not parse JSON/);
    await expect(page.locator("#title")).toHaveValue("Kept");
  });
});
