import { expect, test } from "@playwright/test";

/** Legacy URLs — uploads folded into the create pages. */
const REDIRECTS = [
  { from: "/upload", to: "/lists/new" },
  { from: "/rules/upload", to: "/rules/new" },
  { from: "/phrases/upload", to: "/phrases/new" },
];

test.describe("legacy upload URLs", () => {
  for (const { from, to } of REDIRECTS) {
    test(`${from} redirects to ${to}`, async ({ page }) => {
      await page.goto(from);
      await expect(page).toHaveURL(new RegExp(`${to}$`));
    });
  }
});
