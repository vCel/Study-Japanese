import { expect, test } from "@playwright/test";

const SECTIONS = ["Word library", "Phrases", "文法 · Grammar", "Study"];

const ACTIVE_LINK_CASES = [
  { path: "/", label: "Word lists" },
  { path: "/words", label: "Words" },
  { path: "/examples", label: "Examples" },
  { path: "/phrases/lists", label: "Phrase lists" },
  { path: "/phrases", label: "Phrases" },
  { path: "/study", label: "Study" },
  { path: "/rules", label: "Rules & forms" },
  { path: "/rules/examples", label: "Rule examples" },
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
});
