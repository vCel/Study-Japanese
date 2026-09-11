import { expect, test, type Page } from "@playwright/test";

import { waitForHydration } from "./helpers";

/** On small screens the navigation is a bottom dock of categories instead of the sidebar. */
test.use({ viewport: { width: 390, height: 780 } });

/** Every category except Study expands into a popover. */
const CATEGORIES_WITH_MENU = ["Words", "Phrases", "Grammar", "Profile"];

/** Clicks happen after hydration — pre-hydration clicks are silently dropped. */
async function openCategory(page: Page, label: string) {
  await waitForHydration(page);
  const dock = page.getByRole("toolbar", { name: "Primary" });
  await dock.getByRole("button", { name: label, exact: true }).click();
  const menu = page.getByRole("menu", { name: `${label} pages` });
  await expect(menu).toBeVisible();
  return { dock, menu };
}

test.describe("mobile navigation", () => {
  test("renders a category dock and hides the sidebar", async ({ page }) => {
    await page.goto("/");

    const dock = page.getByRole("toolbar", { name: "Primary" });
    await expect(dock).toBeVisible();

    // Five categories — nothing is squeezed off-screen.
    for (const label of CATEGORIES_WITH_MENU) {
      await expect(dock.getByRole("button", { name: label, exact: true })).toBeVisible();
    }
    await expect(dock.getByRole("link", { name: "Study", exact: true })).toBeVisible();

    // The desktop sidebar is not shown at this width.
    await expect(page.getByRole("navigation")).toBeHidden();
  });

  test("a category opens a popover listing only its pages", async ({ page }) => {
    await page.goto("/");
    const { dock, menu: wordsMenu } = await openCategory(page, "Words");

    await expect(wordsMenu.getByRole("menuitem")).toHaveCount(3);
    await expect(wordsMenu.getByRole("menuitem", { name: "Word lists" })).toHaveAttribute(
      "href",
      "/"
    );
    await expect(wordsMenu.getByRole("menuitem", { name: "Words", exact: true })).toHaveAttribute(
      "href",
      "/words"
    );
    await expect(wordsMenu.getByRole("menuitem", { name: "Examples" })).toHaveAttribute(
      "href",
      "/examples"
    );

    // Opening another category swaps the menu rather than stacking them.
    await dock.getByRole("button", { name: "Profile", exact: true }).click();
    await expect(wordsMenu).toBeHidden();
    const profileMenu = page.getByRole("menu", { name: "Profile pages" });
    await expect(profileMenu).toBeVisible();
    await expect(profileMenu.getByRole("menuitem", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login"
    );
    await expect(profileMenu.getByRole("menuitem", { name: "Sign up" })).toHaveAttribute(
      "href",
      "/signup"
    );

    // Escape closes it again.
    await page.keyboard.press("Escape");
    await expect(profileMenu).toBeHidden();

    // Tapping the open category again toggles it shut.
    await dock.getByRole("button", { name: "Grammar", exact: true }).click();
    await expect(page.getByRole("menu", { name: "Grammar pages" })).toBeVisible();
    await dock.getByRole("button", { name: "Grammar", exact: true }).click();
    await expect(page.getByRole("menu", { name: "Grammar pages" })).toBeHidden();
  });

  test("the popover hangs off the category that was tapped", async ({ page }) => {
    await page.goto("/");
    const dock = page.getByRole("toolbar", { name: "Primary" });
    await waitForHydration(page);

    // The left-most category opens a menu on the left half of the dock…
    await dock.getByRole("button", { name: "Words", exact: true }).click();
    const wordsBox = await page.getByRole("menu", { name: "Words pages" }).boundingBox();
    const toolsBox = await dock.boundingBox();
    expect(wordsBox).not.toBeNull();
    expect(toolsBox).not.toBeNull();
    const wordsCentre = wordsBox!.x + wordsBox!.width / 2;
    expect(wordsCentre).toBeLessThan(toolsBox!.x + toolsBox!.width / 2);

    // …and the right-most category opens its menu on the right half.
    await dock.getByRole("button", { name: "Profile", exact: true }).click();
    const profileBox = await page.getByRole("menu", { name: "Profile pages" }).boundingBox();
    expect(profileBox).not.toBeNull();
    const profileCentre = profileBox!.x + profileBox!.width / 2;
    expect(profileCentre).toBeGreaterThan(toolsBox!.x + toolsBox!.width / 2);
    expect(profileCentre).toBeGreaterThan(wordsCentre);
  });

  test("the Profile menu never offers sign out to a signed-out visitor", async ({ page }) => {
    await page.goto("/");
    const { menu } = await openCategory(page, "Profile");

    await expect(menu.getByRole("menuitem", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login"
    );
    await expect(menu.getByRole("menuitem", { name: "Sign up" })).toHaveAttribute(
      "href",
      "/signup"
    );
    // Anonymous visitors must not see the signed-in actions.
    await expect(menu.getByRole("menuitem", { name: "Sign out" })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "Settings" })).toHaveCount(0);
  });

  test("choosing a page from the popover navigates and dismisses the menu", async ({ page }) => {
    await page.goto("/");
    const { menu } = await openCategory(page, "Grammar");

    await menu.getByRole("menuitem", { name: "Rules & forms" }).click();

    await expect(page).toHaveURL(/\/rules$/);
    await expect(page.getByRole("menu")).toHaveCount(0);
  });

  test("the active category is marked and single-page categories link straight through", async ({
    page,
  }) => {
    await page.goto("/phrases");
    const dock = page.getByRole("toolbar", { name: "Primary" });

    await expect(dock.getByRole("button", { name: "Phrases", exact: true })).toHaveAttribute(
      "aria-current",
      "page"
    );
    await expect(dock.locator('[aria-current="page"]')).toHaveCount(1);

    // Study has a single page, so it skips the popover entirely.
    await expect(dock.getByRole("link", { name: "Study", exact: true })).toHaveAttribute(
      "href",
      "/study"
    );

    // A page inside the Grammar category keeps Grammar highlighted.
    await page.goto("/rules/examples");
    await expect(dock.getByRole("button", { name: "Grammar", exact: true })).toHaveAttribute(
      "aria-current",
      "page"
    );
    await expect(dock.locator('[aria-current="page"]')).toHaveCount(1);
  });
});
