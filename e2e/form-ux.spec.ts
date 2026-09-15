import { expect, test, type Page } from "@playwright/test";

import {
  expectHydrated,
  gotoHydrated,
  listIdByTitle,
  ruleIdByTitle,
  seedStarterPack,
  STARTER_WORD_LIST,
  stubConvex,
  wordIdByTitle,
} from "./helpers";

/**
 * The form-UX pass: custom Lightswind selects, full-width edit pages,
 * right-aligned primary buttons, destructive admin actions and toasts.
 *
 * The create pages render a fallback until the Convex client is available, so
 * they use `gotoHydrated`. The edit pages have no accordion to wait for, so the
 * assertions themselves wait for the hydrated markup.
 *
 * Everything here reads owner-scoped content, so each test takes a copy of the
 * starter pack first. That also retires the hard-coded ids (`/words/1/edit`):
 * the seeded rows have `owner_id IS NULL` and are invisible to an owner, so the
 * ids are resolved from the list pages instead.
 */
test.beforeEach(async ({ page }) => {
  await stubConvex(page);
  await seedStarterPack(page);
});

/** Seeded titles, used to resolve the ids the edit pages need. */
const WORD = "食べる";
const LIST = STARTER_WORD_LIST;
const RULE = "Polite ます-form";

/** The three edit pages the width and delete specs both exercise. */
const EDIT_TARGETS = [
  {
    kind: "word",
    resolve: (page: Page) => wordIdByTitle(page, WORD),
    href: (id: number) => `/words/${id}/edit`,
  },
  {
    kind: "word list",
    resolve: (page: Page) => listIdByTitle(page, LIST),
    href: (id: number) => `/lists/${id}/edit`,
  },
  {
    kind: "rule",
    resolve: (page: Page) => ruleIdByTitle(page, RULE),
    href: (id: number) => `/rules/${id}/edit`,
  },
] as const;

async function openEdit(page: Page, target: (typeof EDIT_TARGETS)[number]) {
  await page.goto(target.href(await target.resolve(page)));
  await expectHydrated(page);
}

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
    await page.goto(`/words/${await wordIdByTitle(page, WORD)}/edit`);
    await expectHydrated(page);

    const trigger = page.getByRole("button", { name: "Part of speech" });
    await expect(trigger).toBeVisible();
    await trigger.click();

    await page.getByRole("listbox").getByRole("option", { name: "Verb", exact: true }).click();
    await expect(page.locator('input[name="pos"]')).toHaveValue("verb");
  });
});

test.describe("edit pages match the create page width", () => {
  for (const target of EDIT_TARGETS) {
    test(`the ${target.kind} edit page is no longer column-capped`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await openEdit(page, target);

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

test.describe("delete on edit pages", () => {
  for (const target of EDIT_TARGETS) {
    test(`the ${target.kind} edit page offers a delete button next to save, confirmed by an alert dialog`, async ({
      page,
    }) => {
      await openEdit(page, target);
      const label = target.kind;

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
  test("saving an edit surfaces a toast", async ({ page }) => {
    await page.goto(`/words/${await wordIdByTitle(page, WORD)}/edit`);
    await expectHydrated(page);

    await page.getByRole("button", { name: "Save changes" }).click();

    const toast = page.locator('[data-slot="toast"]');
    await expect(toast).toBeVisible();
    await expect(toast).toHaveAttribute("data-variant", "success");
  });

  // NOTE: this test used to assert the *error* variant, on the premise that the
  // server rejects a save "because the test browser has no auth token". Owner
  // scoping retired that premise: a signed-out device owner is a real owner and
  // may edit its own words (server-actions.spec.ts asserts exactly that), so the
  // save now succeeds.
  //
  // The action's remaining error branches are all hard to trigger
  // deterministically from e2e:
  //   - "You can only edit words in your own library." needs a foreign-owned row,
  //     and the loader 404s before the form ever renders.
  //   - "Word not found." (row deleted mid-edit) makes the loader revalidate into
  //     an error boundary, so no toast is shown at all.
  //   - "Too many requests." would work, but UPLOAD_LIMITER is 10 writes/minute
  //     keyed by client IP, and the suite runs in parallel — exhausting it here
  //     would start failing other specs for up to a minute.
  //
  // So the error variant has no e2e coverage right now. The right home for it is
  // a component-level test of the toast itself, not a contrived end-to-end path.
});
