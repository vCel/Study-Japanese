import { expect, test, type Page } from "@playwright/test";

import { waitForHydration } from "./helpers";

/** On small screens the navigation is a bottom dock of categories instead of the sidebar. */
test.use({ viewport: { width: 390, height: 780 } });

/** Categories that expand into a popover of their pages. */
const CATEGORIES_WITH_MENU = ["Words", "Phrases", "Study", "Profile"];

/**
 * Grammar has a single page, so the dock links straight to it rather than
 * opening a one-item popover (see `Dock`).
 */
const SINGLE_PAGE_CATEGORY = { label: "Grammar", to: "/rules" };

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

    // Grammar is the one single-page category: it links straight through, and it
    // is the only thing in the dock that does.
    await expect(dock.getByRole("link", { name: SINGLE_PAGE_CATEGORY.label })).toHaveAttribute(
      "href",
      SINGLE_PAGE_CATEGORY.to
    );
    await expect(dock.getByRole("link")).toHaveCount(1);

    // The desktop sidebar is not shown at this width.
    await expect(page.getByRole("navigation")).toBeHidden();
  });

  test("a category opens a popover listing only its pages", async ({ page }) => {
    await page.goto("/");
    const { dock, menu: wordsMenu } = await openCategory(page, "Words");

    await expect(wordsMenu.getByRole("menuitem")).toHaveCount(2);
    await expect(wordsMenu.getByRole("menuitem", { name: "Word lists" })).toHaveAttribute(
      "href",
      "/"
    );
    await expect(wordsMenu.getByRole("menuitem", { name: "Words", exact: true })).toHaveAttribute(
      "href",
      "/words"
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
    await dock.getByRole("button", { name: "Phrases", exact: true }).click();
    await expect(page.getByRole("menu", { name: "Phrases pages" })).toBeVisible();
    await dock.getByRole("button", { name: "Phrases", exact: true }).click();
    await expect(page.getByRole("menu", { name: "Phrases pages" })).toBeHidden();
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
    const { menu } = await openCategory(page, "Phrases");

    await menu.getByRole("menuitem", { name: "Phrases", exact: true }).click();

    await expect(page).toHaveURL(/\/phrases$/);
    await expect(page.getByRole("menu")).toHaveCount(0);
  });

  test("the Study category lists Flashcards and Quizzes", async ({ page }) => {
    await page.goto("/");
    const { menu } = await openCategory(page, "Study");

    await expect(menu.getByRole("menuitem")).toHaveCount(2);
    await expect(menu.getByRole("menuitem", { name: "Flashcards" })).toHaveAttribute(
      "href",
      "/study/flashcards"
    );
    await expect(menu.getByRole("menuitem", { name: "Quizzes" })).toHaveAttribute(
      "href",
      "/study/quizzes"
    );

    // Choosing a page dismisses the menu and leaves Study marked as current.
    await menu.getByRole("menuitem", { name: "Flashcards" }).click();
    await expect(page).toHaveURL(/\/study\/flashcards$/);
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(
      page.getByRole("toolbar", { name: "Primary" }).getByRole("button", {
        name: "Study",
        exact: true,
      })
    ).toHaveAttribute("aria-current", "page");
  });

  test("the active category is marked, including the one that links straight through", async ({
    page,
  }) => {
    await page.goto("/phrases");
    const dock = page.getByRole("toolbar", { name: "Primary" });

    await expect(dock.getByRole("button", { name: "Phrases", exact: true })).toHaveAttribute(
      "aria-current",
      "page"
    );
    await expect(dock.locator('[aria-current="page"]')).toHaveCount(1);

    // The Study category covers both of its pages, and stays highlighted on them.
    await page.goto("/study/quizzes");
    await expect(dock.getByRole("button", { name: "Study", exact: true })).toHaveAttribute(
      "aria-current",
      "page"
    );
    await expect(dock.locator('[aria-current="page"]')).toHaveCount(1);

    // The single-page Grammar category is a link, and marks itself current the
    // same way its popover siblings do.
    await page.goto(SINGLE_PAGE_CATEGORY.to);
    await expect(dock.getByRole("link", { name: SINGLE_PAGE_CATEGORY.label })).toHaveAttribute(
      "aria-current",
      "page"
    );
    await expect(dock.locator('[aria-current="page"]')).toHaveCount(1);
  });
});
