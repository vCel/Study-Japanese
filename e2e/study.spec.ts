import { expect, test, type Page } from "@playwright/test";

import { waitForHydration } from "./helpers";

/**
 * Study is split into three independent sections (words, phrases, forms) using
 * the Lightswind tabs component, and saved sessions moved into save/load
 * drawers.
 */

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

/** Only the active tab's panel is mounted, so scope by its `data-value`. */
function panelFor(page: Page, kind: StudyTab) {
  return page.locator(`[role="tabpanel"][data-value="${kind}"]`);
}

type StudyTab = "words" | "phrases" | "forms";

const TAB_LABELS: Record<StudyTab, string> = {
  words: "Words",
  phrases: "Phrases",
  forms: "Forms",
};

async function saveSession(page: Page, kind: StudyTab, name: string) {
  await page.getByRole("tab", { name: TAB_LABELS[kind] }).click();
  await panelFor(page, kind).getByRole("button", { name: "Save session" }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("Session name").fill(name);
  await drawer.getByRole("button", { name: "Save session" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test.describe("study sections", () => {
  test("offers a words, phrases and forms tab", async ({ page }) => {
    await page.goto("/study");

    const tabs = page.getByRole("tablist");
    await expect(tabs.getByRole("tab")).toHaveText(["Words", "Phrases", "Forms"]);

    // Words is the default section, and only its panel is mounted.
    await expect(page.getByRole("tab", { name: "Words" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(panelFor(page, "words")).toBeVisible();
    await expect(panelFor(page, "words").getByText("Word lists")).toBeVisible();
    await expect(panelFor(page, "words").getByText("Types of words")).toBeVisible();
    await expect(panelFor(page, "phrases")).toHaveCount(0);
    await expect(panelFor(page, "forms")).toHaveCount(0);
  });

  test("each section keeps its own configuration", async ({ page }) => {
    await page.goto("/study");
    await waitForHydration(page);

    // Configure the words tab…
    const words = panelFor(page, "words");
    await words.getByRole("button", { name: "Nouns" }).click();
    await words.getByRole("button", { name: "20 cards" }).click();
    await expect(words.getByRole("button", { name: "Nouns" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    // …the phrases tab starts from its own defaults (and has no POS step).
    await page.getByRole("tab", { name: "Phrases" }).click();
    const phrases = panelFor(page, "phrases");
    await expect(phrases).toBeVisible();
    await expect(phrases.getByText("Phrase lists")).toBeVisible();
    await expect(phrases.getByRole("button", { name: "Nouns" })).toHaveCount(0);
    await expect(phrases.getByRole("button", { name: "40 cards" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    // …and forms swaps the source picker for a rule-kind picker.
    await page.getByRole("tab", { name: "Forms" }).click();
    const forms = panelFor(page, "forms");
    await expect(forms.getByText("Rule type")).toBeVisible();
    await expect(forms.getByRole("button", { name: /Sentence rules/ })).toBeVisible();
    await expect(forms.getByText("Word lists")).toHaveCount(0);

    // The words tab still remembers what was picked.
    await page.getByRole("tab", { name: "Words" }).click();
    await expect(words.getByRole("button", { name: "Nouns" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(words.getByRole("button", { name: "20 cards" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });
});

test.describe("starting a session", () => {
  test("starts a words session", async ({ page }) => {
    await page.goto("/study");
    await waitForHydration(page);

    await panelFor(page, "words").getByRole("button", { name: "Start studying" }).click();

    await expect(page).toHaveURL(/\/study\/session\?kind=words/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Words");
    await expect(page.getByRole("button", { name: "Reveal answer" })).toBeVisible();
  });

  test("starts a forms session with grammar cards", async ({ page }) => {
    await page.goto("/study?kind=forms");
    await waitForHydration(page);

    // The deep link opens straight on the forms tab.
    await expect(page.getByRole("tab", { name: "Forms" })).toHaveAttribute(
      "aria-selected",
      "true"
    );

    await panelFor(page, "forms").getByRole("button", { name: "Start studying" }).click();

    await expect(page).toHaveURL(/kind=forms/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Forms");
    await expect(page.getByRole("button", { name: "Reveal answer" })).toBeVisible();
  });

  test("a phrase-list link studies phrases (kind is inferred)", async ({ page }) => {
    await page.goto("/phrases/lists");
    await waitForHydration(page);
    // Scope to the list cards — the sidebar also has a link called "Study".
    const study = page.locator("main").getByRole("link", { name: "Study" }).first();
    await expect(study).toBeVisible();
    await study.click();

    await expect(page).toHaveURL(/\/study\/session\?lists=/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Phrases");
  });

  test("the answer buttons are wide and the card flips in place", async ({ page }) => {
    await page.goto("/study/session?kind=words&limit=4");
    await page.waitForLoadState("networkidle");

    const again = await page.getByRole("button", { name: /Again/ }).boundingBox();
    const gotIt = await page.getByRole("button", { name: /Got it/ }).boundingBox();
    expect(again, "Again").not.toBeNull();
    expect(gotIt, "Got it").not.toBeNull();
    expect(again!.width).toBeGreaterThan(180);
    expect(gotIt!.width).toBeGreaterThan(180);

    // Revealing flips the card (the button reports the visible side)…
    const card = page.getByRole("button", { name: "Reveal answer" });
    await card.click();
    const flipped = page.getByRole("button", { name: "Show question side" });
    await expect(flipped).toBeVisible();

    // …and answering moves straight on to the next card's question side, with
    // no replayed flip (which used to show the next answer mid-animation).
    await page.getByRole("button", { name: /Got it/ }).click();
    await expect(page.getByRole("button", { name: "Reveal answer" })).toBeVisible();
  });
});

test.describe("saved study sessions", () => {
  test("saves a configuration through the save drawer", async ({ page }) => {
    await page.goto("/study");
    await waitForHydration(page);

    const panel = panelFor(page, "words");
    await panel.getByRole("button", { name: "10 cards" }).click();

    // No sessions yet, so nothing to load.
    await expect(panel.getByRole("button", { name: "Load" })).toBeDisabled();

    await panel.getByRole("button", { name: "Save session" }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("heading", { name: "Save session" })).toBeVisible();

    const name = drawer.getByLabel("Session name");
    await expect(name).not.toHaveValue("");
    await name.fill("N5 quick round");
    await drawer.getByRole("button", { name: "Save session" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator('[data-slot="toast"]')).toContainText("N5 quick round");
    await expect(panel.getByRole("button", { name: "Load" })).toBeEnabled();

    // The tab it was saved from is recorded.
    const stored = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("jv:study:sessions") ?? "[]")
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ name: "N5 quick round", kind: "words", limit: 10 });
  });

  test("loads a session from the load drawer's reorderable list", async ({ page }) => {
    await page.goto("/study");
    await waitForHydration(page);
    const panel = panelFor(page, "words");

    // Save one session with a 10-card deck.
    await panel.getByRole("button", { name: "10 cards" }).click();
    await saveSession(page, "words", "Ten card deck");

    // Change the deck size, then load the saved session back.
    await panel.getByRole("button", { name: "100 cards" }).click();
    await panel.getByRole("button", { name: "Load" }).click();

    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("heading", { name: "Saved sessions" })).toBeVisible();
    // Scroll area + one draggable row.
    await expect(drawer.locator('[data-slot="scroll-area-viewport"]')).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Drag to reorder" })).toHaveCount(1);

    await drawer.getByRole("button", { name: "Load Ten card deck", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "10 cards" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  test("keeps saved sessions per section", async ({ page }) => {
    await page.goto("/study");
    await waitForHydration(page);

    await saveSession(page, "words", "Words only");
    await saveSession(page, "forms", "Grammar drills");

    // Phrases has no sessions of its own yet…
    await page.getByRole("tab", { name: "Phrases" }).click();
    await expect(panelFor(page, "phrases").getByRole("button", { name: "Load" })).toBeDisabled();

    // …while forms only lists the session saved on the forms tab.
    await page.getByRole("tab", { name: "Forms" }).click();
    await panelFor(page, "forms").getByRole("button", { name: "Load" }).click();

    const drawer = page.getByRole("dialog");
    await expect(
      drawer.getByRole("button", { name: "Load Grammar drills", exact: true })
    ).toHaveCount(1);
    await expect(
      drawer.getByRole("button", { name: "Load Words only", exact: true })
    ).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test.describe("json import", () => {
  test("copies the example JSON with the animated copy button", async ({ page }) => {
    await page.goto("/lists/new");
    await page.getByRole("button", { name: /Bulk import from JSON/ }).click();

    const copy = page.getByRole("button", { name: "Copy the example JSON" });
    await expect(copy).toBeVisible();
    await copy.click();

    await expect(page.locator('[data-slot="toast"]')).toContainText("Example JSON copied");

    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(Array.isArray(JSON.parse(copied))).toBe(true);
  });
});
