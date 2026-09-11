import { expect, test } from "@playwright/test";

import { ACCORDION_TRIGGER, gotoHydrated } from "./helpers";

/**
 * Rules differ from word/phrase lists: one submission can hold many rules, so
 * the JSON importer *fills the form* (one editable accordion panel per rule)
 * instead of writing entries straight to the database.
 */

const JSON_TEXTAREA = "[data-slot='json-import-textarea']";

const TWO_RULES = JSON.stringify([
  {
    kind: "word",
    title: "Polite past",
    points: ["Verb stem + ました", "Drop ます and add ました"],
    explanation: "Drop ます and add ました for the polite past.",
    tags: "verbs, jlpt",
    examples: [{ japanese: "食べました", english: "ate (polite)" }],
  },
  {
    kind: "sentence",
    title: "Topic marker",
    // The older single-string shape still fills the first point.
    pattern: "Topic は …",
    explanation: "は marks the topic the sentence is about.",
  },
]);

async function openJsonAndFill(page: import("@playwright/test").Page, json: string) {
  await page.getByRole("button", { name: ACCORDION_TRIGGER }).click();
  await page.locator(JSON_TEXTAREA).fill(json);
  await page.getByRole("button", { name: "Fill form from JSON" }).click();
}

test.describe("rules: JSON import fills the form", () => {
  test("pasting rules JSON creates editable panels, not database rows", async ({ page }) => {
    await gotoHydrated(page, "/rules/new");

    // One empty rule to start with.
    await expect(page.getByRole("button", { name: "Create rule", exact: true })).toBeVisible();
    await expect(page.locator("#rule-0-title")).toHaveValue("");

    await openJsonAndFill(page, TWO_RULES);

    // The button count and label follow the imported rules.
    await expect(page.getByRole("button", { name: "Create 2 rules", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create rule", exact: true })).toHaveCount(0);

    // Every field came from the JSON — including tags, points and examples.
    await expect(page.locator("#rule-0-title")).toHaveValue("Polite past");
    await expect(page.locator("#rule-0-point-0")).toHaveValue("Verb stem + ました");
    await expect(page.locator("#rule-0-point-1")).toHaveValue("Drop ます and add ました");
    await expect(page.locator("#rule-0-tags")).toHaveValue("verbs, jlpt");
    // A legacy `pattern` string lands in the first point.
    await expect(page.locator("#rule-1-point-0")).toHaveValue("Topic は …");
    await expect(page.locator("#rule-1-title")).toHaveValue("Topic marker");
    await expect(page.locator("#rule-1-explanation")).toHaveValue(
      "は marks the topic the sentence is about."
    );
    await expect(page.getByLabel("Example 1 (Japanese) 1")).toHaveValue("食べました");

    // Still on the create page — nothing was written.
    await expect(page).toHaveURL(/\/rules\/new$/);
  });

  test("imported rules stay editable and reorderable through the panels", async ({ page }) => {
    await gotoHydrated(page, "/rules/new");
    await openJsonAndFill(page, TWO_RULES);

    // Editing updates the panel heading.
    await page.locator("#rule-1-title").fill("Topic marker (edited)");
    await expect(page.getByRole("button", { name: /Topic marker \(edited\)/ })).toBeVisible();

    // The rule type is a real Select, seeded from the JSON.
    const kind = page.getByRole("button", { name: "Rule type 2" });
    await expect(kind).toContainText("Sentence rule");

    // Invalid JSON explains itself instead of wiping the form.
    await page.locator(JSON_TEXTAREA).fill("{ not json");
    await page.getByRole("button", { name: "Fill form from JSON" }).click();
    await expect(page.getByRole("alert")).toContainText(/Could not parse JSON/);
    await expect(page.locator("#rule-0-title")).toHaveValue("Polite past");
  });

  test("'Add rule' adds a panel and rules can be removed again", async ({ page }) => {
    await gotoHydrated(page, "/rules/new");

    await page.getByRole("button", { name: "Add rule" }).click();
    await expect(page.getByRole("button", { name: "Create 2 rules", exact: true })).toBeVisible();

    // One Remove control per panel below the fields.
    const removes = page.getByRole("button", { name: "Remove", exact: true });
    await expect(removes).toHaveCount(2);
    await removes.nth(1).click();

    await expect(page.getByRole("button", { name: "Create rule", exact: true })).toBeVisible();
    // With a single rule left there is nothing to remove.
    await expect(page.getByRole("button", { name: "Remove", exact: true })).toHaveCount(0);
  });

  test("'Add point' grows a rule up to four points", async ({ page }) => {
    await gotoHydrated(page, "/rules/new");

    const addPoint = page.getByRole("button", { name: "Add point" });
    await page.locator("#rule-0-point-0").fill("Point one");
    await expect(page.getByText("(1/4)")).toBeVisible();

    for (const [index, value] of ["Point two", "Point three", "Point four"].entries()) {
      await addPoint.click();
      await page.locator(`#rule-0-point-${index + 1}`).fill(value);
    }

    // Four is the ceiling: the button is disabled and the counter agrees.
    await expect(page.locator("#rule-0-point-3")).toHaveValue("Point four");
    await expect(page.getByText("(4/4)")).toBeVisible();
    await expect(addPoint).toBeDisabled();

    // Removing one frees a slot again.
    await page.getByRole("button", { name: "Remove point 4" }).click();
    await expect(page.locator("#rule-0-point-3")).toHaveCount(0);
    await expect(page.locator("#rule-0-point-0")).toHaveValue("Point one");
    await expect(addPoint).toBeEnabled();
  });

  test("typing in a panel keeps focus between keystrokes", async ({ page }) => {
    await gotoHydrated(page, "/rules/new");

    // Regression: a field wrapped in a component that was redefined on every
    // render remounted after each keystroke, so only one letter ever landed.
    const title = page.locator("#rule-0-title");
    await title.click();
    await title.pressSequentially("Polite past");
    await expect(title).toHaveValue("Polite past");
    await expect(title).toBeFocused();

    const explanation = page.locator("#rule-0-explanation");
    await explanation.click();
    await explanation.pressSequentially("Drop ます and add ました.");
    await expect(explanation).toHaveValue("Drop ます and add ました.");
  });

  test("the panel grows when the explanation is resized", async ({ page }) => {
    await gotoHydrated(page, "/rules/new");

    // The rule's own panel (the JSON accordion is the first one on the page).
    const panel = page
      .locator("[data-slot='accordion-content']")
      .filter({ has: page.locator("#rule-0-explanation") });
    /** Panel height minus its content height: 0 once the panel is settled. */
    const gap = () =>
      panel.evaluate(
        (el) =>
          el.getBoundingClientRect().height -
          (el.firstElementChild as HTMLElement).scrollHeight
      );
    const content = () =>
      panel.evaluate((el) => (el.firstElementChild as HTMLElement).scrollHeight);

    // Let the opening animation finish so the comparison is meaningful.
    await expect.poll(gap).toBeGreaterThanOrEqual(-1);
    const before = await content();

    // Make the field taller the way dragging its resize handle does.
    await page.locator("#rule-0-explanation").evaluate((el) => {
      (el as HTMLTextAreaElement).style.height = "320px";
    });

    await expect.poll(content).toBeGreaterThan(before + 200);
    // Regression: the panel's height used to be measured once and go stale, so
    // the taller field was clipped by `overflow-hidden`.
    await expect.poll(gap).toBeGreaterThanOrEqual(-1);
  });
});
