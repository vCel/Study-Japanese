import { expect, test } from "@playwright/test";

const SECTIONS = ["Word library", "Phrases", "文法 · Grammar", "Study"];

const ACTIVE_LINK_CASES = [
  { path: "/", label: "Word lists" },
  { path: "/words", label: "Words" },
  { path: "/phrases/lists", label: "Phrase lists" },
  { path: "/phrases", label: "Phrases" },
  { path: "/study/flashcards", label: "Flashcards" },
  { path: "/study/quizzes", label: "Quizzes" },
  { path: "/rules", label: "Rules & forms" },
];

/**
 * Pages that were removed rather than moved. Nothing links to them any more, so
 * a bookmark is the only way in — and it must not reach a live page.
 */
const REMOVED_PAGES = [
  { path: "/words/examples", heading: "Example sentences" },
  { path: "/rules/examples", heading: "Rule examples" },
  { path: "/examples", heading: "Example sentences" },
];

test.describe("sidebar navigation", () => {
  test("groups the app into four sections", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("navigation", { name: "Primary" }).locator("p")
    ).toHaveText(SECTIONS);
  });

  test("lists Study after the Grammar section", async ({ page }) => {
    await page.goto("/");
    const labels = await page
      .getByRole("navigation", { name: "Primary" })
      .locator("p")
      .allTextContents();
    expect(labels.indexOf("Study")).toBeGreaterThan(labels.indexOf("文法 · Grammar"));
  });

  for (const { path, label } of ACTIVE_LINK_CASES) {
    test(`marks only "${label}" as current on ${path}`, async ({ page }) => {
      await page.goto(path);
      // Scoped to the sidebar: sub-pages also carry a breadcrumb `<nav>`.
      const nav = page.getByRole("navigation", { name: "Primary" });
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
      await expect(nav.getByRole("link", { name: label, exact: true })).toHaveAttribute(
        "aria-current",
        "page"
      );
    });
  }

  test("phrase sub-pages do not mark the parent Phrases link as current", async ({ page }) => {
    await page.goto("/phrases/lists");
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav.getByRole("link", { name: "Phrases", exact: true })).not.toHaveAttribute(
      "aria-current",
      "page"
    );
  });

  for (const { path, heading } of REMOVED_PAGES) {
    test(`${path} is no longer a page`, async ({ page }) => {
      const response = await page.goto(path);
      // `/words/examples` still matches `/words/:id`, so it fails as a bad id
      // (400) rather than as an unmatched route (404). Either way it is an
      // error page, not the page that used to be here.
      expect(response?.status(), path).toBeGreaterThanOrEqual(400);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toHaveCount(0);
    });
  }
});
