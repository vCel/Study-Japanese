import { expect, test } from "@playwright/test";

test.describe("rules & forms list", () => {
  test("leads with the title and keeps the kind badge to its right", async ({ page }) => {
    await page.goto("/rules");
    const card = page.locator("main [data-slot='rule-card']").first();

    // Measured in one pass — the client re-renders after a hydration mismatch,
    // which can detach nodes between two separate Playwright calls.
    const geometry = await card.evaluate((el) => {
      const title = el.querySelector("h2");
      const badge = Array.from(el.querySelectorAll("span")).find((span) =>
        /^(Word|Sentence) rule$/.test((span.textContent ?? "").trim())
      );
      if (!title || !badge) return null;
      const titleRect = title.getBoundingClientRect();
      const badgeRect = badge.getBoundingClientRect();
      const cardRect = el.getBoundingClientRect();
      return {
        titleIsFirstChild: title === title.parentElement?.firstElementChild,
        titleX: titleRect.x,
        badgeX: badgeRect.x,
        badgeRight: badgeRect.right,
        cardRight: cardRect.right,
      };
    });

    expect(geometry).not.toBeNull();
    // The heading leads the card's title row…
    expect(geometry!.titleIsFirstChild).toBe(true);
    // …the kind badge sits to its right, pushed to the card's edge.
    expect(geometry!.badgeX).toBeGreaterThan(geometry!.titleX);
    expect(geometry!.badgeRight).toBeGreaterThan(geometry!.cardRight - 30);
  });

  test("moves the example count to the bottom-left of the card", async ({ page }) => {
    await page.goto("/rules");
    const card = page.locator("main [data-slot='rule-card']").first();
    await expect(card).toBeVisible();

    const geometry = await card.evaluate((el) => {
      const count = Array.from(el.querySelectorAll("span")).find((span) =>
        /\d+ examples?$/.test((span.textContent ?? "").trim())
      );
      if (!count) return null;
      const countRect = count.getBoundingClientRect();
      const cardRect = el.getBoundingClientRect();
      return {
        countX: countRect.x,
        countY: countRect.y,
        midX: cardRect.x + cardRect.width / 2,
        midY: cardRect.y + cardRect.height / 2,
      };
    });

    expect(geometry).not.toBeNull();
    expect(geometry!.countY).toBeGreaterThan(geometry!.midY);
    expect(geometry!.countX).toBeLessThan(geometry!.midX);
  });

  test("shows the pattern in a dashed ポイント callout", async ({ page }) => {
    await page.goto("/rules");
    const label = page.getByText("ポイント!").first();
    await expect(label).toBeVisible();
    // The label overlaps the dashed container that holds the pattern.
    await expect(label.locator("..")).toHaveClass(/border-dashed/);
  });

  test("shows at most two tags, collapsing the rest into +x", async ({ page }) => {
    await page.goto("/rules");
    // Rule 3 is seeded with three tags (adjectives, jlpt, n5).
    const card = page
      .locator("main [data-slot='rule-card']")
      .filter({ hasText: "Adjective conjugation" });

    await expect(card.getByRole("link", { name: "#adjectives" })).toBeVisible();
    await expect(card.getByRole("link", { name: "#jlpt" })).toBeVisible();
    await expect(card.getByText("+1")).toBeVisible();
    // The third tag is hidden behind the counter…
    await expect(card.getByRole("link", { name: "#n5" })).toHaveCount(0);
    // …but is still discoverable via the counter's tooltip.
    await card.getByText("+1").hover();
    await expect(page.locator("[data-slot='tooltip']")).toContainText("#n5");
  });

  test("filters by tag", async ({ page }) => {
    await page.goto("/rules?tag=particles");
    await expect(page.getByRole("heading", { level: 2, name: /Topic marker/ })).toBeVisible();
    await expect(page.locator("main [data-slot='rule-card']")).toHaveCount(1);
  });

  test("searches title, explanation and pattern", async ({ page }) => {
    await page.goto("/rules?q=polite");
    await expect(page.getByRole("heading", { level: 2, name: /Polite ます-form/ })).toBeVisible();
    await expect(page.locator("main [data-slot='rule-card']").first()).toBeVisible();
    // Rules that don't mention the term anywhere are filtered out.
    await expect(page.getByRole("heading", { level: 2, name: /Topic marker/ })).toHaveCount(0);
    await expect(
      page.getByRole("heading", { level: 2, name: /Adjective conjugation/ })
    ).toHaveCount(0);
  });
});

test.describe("rule detail", () => {
  test("has an English equivalents section built from its own field", async ({ page }) => {
    await page.goto("/rules/1");
    // Anchored: the section heading carries a count, and the site footer also
    // mentions "English equivalents".
    const section = page.locator("main").getByText(/^English equivalents/);
    await expect(section).toBeVisible();

    // The equivalents are the rule example's own `englishEquivalent` field —
    // not a second rendering of the translation of the sentences above.
    const equivalents = page.locator("main ul li");
    await expect(equivalents.first()).toBeVisible();
    await expect(equivalents).toHaveCount(2);
    await expect(equivalents).toContainText([
      "kaku → kakimasu (to write → writes, politely)",
      "taberu → tabemashita (to eat → ate, politely)",
    ]);
  });

  test("shows each example's translation and its English equivalent", async ({ page }) => {
    await page.goto("/rules/1");

    // The example cards sit above the breakdown: sentence, then translation,
    // then the equivalent the section below re-lists.
    const example = page.locator("main").getByText("書く → 書きます").locator("../..");
    await expect(example).toContainText("kaku → kakimasu (to write → writes, politely)");

    const sectionY = await page
      .locator("main")
      .getByText(/^English equivalents/)
      .boundingBox();
    const exampleY = await example.boundingBox();
    expect(sectionY, "English equivalents").not.toBeNull();
    expect(exampleY, "example card").not.toBeNull();
    expect(exampleY!.y).toBeLessThan(sectionY!.y);
  });

  test("puts the kind badge to the right of the heading", async ({ page }) => {
    await page.goto("/rules/1");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const geometry = await page.locator("main").evaluate((el) => {
      const heading = el.querySelector("h1");
      const badge = Array.from(el.querySelectorAll("span")).find((span) =>
        /^(Word|Sentence) rule$/.test((span.textContent ?? "").trim())
      );
      if (!heading || !badge) return null;
      return {
        headingRight: heading.getBoundingClientRect().right,
        badgeX: badge.getBoundingClientRect().x,
      };
    });

    expect(geometry).not.toBeNull();
    expect(geometry!.badgeX).toBeGreaterThan(geometry!.headingRight);
  });

  test("shows the ポイント callout inside the explanation card, under the text", async ({
    page,
  }) => {
    await page.goto("/rules/1");
    const label = page.getByText("ポイント!");
    await expect(label).toBeVisible();
    await expect(label.locator("..")).toHaveClass(/border-dashed/);

    const geometry = await page.locator("main").evaluate((el) => {
      const label = Array.from(el.querySelectorAll("span")).find(
        (span) => (span.textContent ?? "").trim() === "ポイント!"
      );
      const explanation = Array.from(el.querySelectorAll("div")).find(
        (div) => (div.textContent ?? "").trim() === "Explanation"
      );
      const text = Array.from(el.querySelectorAll("p")).find((p) =>
        (p.textContent ?? "").startsWith("Attach")
      );
      if (!label || !explanation || !text) return null;
      return {
        labelY: label.getBoundingClientRect().y,
        explanationY: explanation.getBoundingClientRect().y,
        textY: text.getBoundingClientRect().y,
        // The callout is a sibling of the explanation paragraph, i.e. it sits
        // inside the same explanation container.
        sameContainer: label.parentElement?.parentElement === text.parentElement,
      };
    });

    expect(geometry).not.toBeNull();
    // Explanation heading → its paragraph → the ポイント callout.
    expect(geometry!.explanationY).toBeLessThan(geometry!.textY);
    expect(geometry!.textY).toBeLessThan(geometry!.labelY);
    expect(geometry!.sameContainer).toBe(true);
  });

  test("related rules are picked by hand, never inferred", async ({ page }) => {
    await page.goto("/rules/1/edit");

    // The form offers a picker instead of guessing…
    await expect(page.getByText("Related rules", { exact: true })).toBeVisible();
    await expect(page.getByText("No related rules yet.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Add a related rule" }).click();
    // The picker lists the other rules in the collection.
    await expect(
      page.getByRole("listbox").getByRole("option", { name: /Adjective conjugation/ })
    ).toBeVisible();
    // …and the rule being edited is not offered as its own relation.
    await expect(
      page.getByRole("listbox").getByRole("option", { name: /Polite ます-form/ })
    ).toHaveCount(0);
  });

  test("shows no related section until something is linked", async ({ page }) => {
    await page.goto("/rules/4");
    await expect(page.getByText("Related rules")).toHaveCount(0);
  });
});

test.describe("rule examples page", () => {
  test("is its own page, separate from the word-list examples", async ({ page }) => {
    await page.goto("/rules/examples");
    await expect(page.getByRole("heading", { level: 1, name: "Rule examples" })).toBeVisible();

    // A seeded rule example lives here, with its equivalent broken out…
    const ruleExample = "書く → 書きます";
    await expect(page.getByText(ruleExample)).toBeVisible();
    await expect(
      page.getByText("kaku → kakimasu (to write → writes, politely)")
    ).toBeVisible();

    // …and is not mixed into the word-list examples page.
    await page.goto("/words/examples");
    await expect(page.getByRole("heading", { level: 1, name: "Example sentences" })).toBeVisible();
    await expect(page.getByText(ruleExample)).toHaveCount(0);
  });

  test("links each example back to its rule", async ({ page }) => {
    await page.goto("/rules/examples");
    await expect(page.locator("main a:has(h2), main a[href^='/rules/']").first()).toBeVisible();
  });
});
