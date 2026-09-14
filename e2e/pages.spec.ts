import { expect, test, type Page } from "@playwright/test";

import { waitForHydration } from "./helpers";

/** Titles of the cards on a listing page (each card renders its title as an h2). */
async function cardTitles(page: Page, path: string): Promise<string[]> {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  return page.locator("main h2").allInnerTexts();
}

function overlap(a: string[], b: string[]): string[] {
  const inB = new Set(b);
  return a.filter((item) => inB.has(item));
}

test.describe("word lists vs phrase lists", () => {
  test("home shows word lists only — phrase lists are moved off it", async ({ page }) => {
    const homeLists = await cardTitles(page, "/");
    const phraseLists = await cardTitles(page, "/phrases/lists");

    // The seed migration ships one phrase list ("Everyday Phrases").
    expect(phraseLists.length).toBeGreaterThan(0);
    expect(overlap(homeLists, phraseLists)).toEqual([]);
  });

  test("home header offers the add button to everyone", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Word lists" })).toBeVisible();
    // Anyone can create a word list — signed in or not.
    await expect(page.getByRole("link", { name: "Add word list" })).toHaveCount(1);
  });

  test("phrase lists page counts phrases and tags link back to itself", async ({ page }) => {
    await page.goto("/phrases/lists");
    await expect(page.getByRole("heading", { level: 1, name: "Phrase lists" })).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Everyday Phrases" })
    ).toBeVisible();

    // Badge counts phrases, not words.
    await expect(page.locator("main")).toContainText(/\d+\s+phrases/);

    // Tag links keep the reader on the phrase-lists page.
    await expect(page.getByRole("link", { name: "#phrases" })).toHaveAttribute(
      "href",
      "/phrases/lists?tag=phrases"
    );
  });
});

test.describe("phrases vs words", () => {
  test("phrases are excluded from /words", async ({ page }) => {
    const words = await cardTitles(page, "/words");
    const phrases = await cardTitles(page, "/phrases");

    expect(phrases.length).toBeGreaterThan(0);
    expect(overlap(words, phrases)).toEqual([]);
  });

  test("/phrases links each phrase to its detail page", async ({ page }) => {
    await page.goto("/phrases");
    await expect(page.getByRole("heading", { level: 1, name: "Phrases" })).toBeVisible();
    await expect(page.locator("main")).toContainText(/\d+\s+phrases?/);
    await expect(page.locator("main a[href^='/words/']").first()).toBeVisible();
  });
});

/**
 * Filtering by tag looks the same everywhere: the tag becomes a chip inside the
 * search bar (never text in the input), and the chip links stay on the page you
 * are already browsing.
 */
test.describe("tag filters", () => {
  test("word lists show the active tag as a chip, not in the search box", async ({ page }) => {
    await page.goto("/?tag=jlpt");

    await expect(page.locator("main input[name='tag']")).toHaveValue("");
    await expect(page.getByRole("link", { name: "#jlpt ✕" })).toHaveAttribute("href", "/");

    // The popover keeps the reader — and the part-of-speech filter — in place.
    await page.goto("/?tag=jlpt&pos=noun");
    // The Tags button only opens once React has hydrated; clicking sooner is a
    // silent no-op.
    await waitForHydration(page);
    await page.getByRole("button", { name: "Tags" }).click();
    const popover = page.locator("[data-slot='tag-popover']");
    await expect(popover.getByRole("link", { name: /^#n5\b/ })).toHaveAttribute(
      "href",
      "/?tag=n5&pos=noun"
    );
  });

  test("backspacing the empty search box clears the whole tag", async ({ page }) => {
    await page.goto("/?tag=jlpt");
    await waitForHydration(page);

    const input = page.locator("main input[name='tag']");
    await input.click();
    await input.press("Backspace");

    // The tag filter is gone in one keystroke, not one character.
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("link", { name: "#jlpt ✕" })).toHaveCount(0);
  });

  test("phrase lists filter in place", async ({ page }) => {
    await page.goto("/phrases/lists?tag=phrases");

    await expect(page.locator("main input[name='tag']")).toHaveValue("");
    await expect(page.getByRole("link", { name: "#phrases ✕" })).toHaveAttribute(
      "href",
      "/phrases/lists"
    );

    // Regression: a tag chip used to send you to the word-list page.
    await waitForHydration(page);
    await page.getByRole("button", { name: "Tags" }).click();
    await expect(
      page.locator("[data-slot='tag-popover']").getByRole("link", { name: /^#jlpt\b/ })
    ).toHaveAttribute("href", "/phrases/lists?tag=jlpt");
  });

  test("a phrase list's own tags stay on the phrase-lists page", async ({ page }) => {
    await page.goto("/lists/3");
    await expect(page.getByRole("link", { name: "#phrases" })).toHaveAttribute(
      "href",
      "/phrases/lists?tag=phrases"
    );
  });
});

/**
 * Word pages read like a dictionary entry: meanings as running text, examples,
 * and the list it belongs to at the very bottom.
 */
test.describe("word detail", () => {
  test("lists meanings as text and links its list at the bottom", async ({ page }) => {
    await page.goto("/words/1");
    await page.waitForLoadState("networkidle");

    // Meanings are a numbered list, not badges.
    await expect(page.locator("main ol li").first()).toBeVisible();
    await expect(page.getByText("Japanese language")).toBeVisible();

    // There is no "study this list" button on a word page…
    await expect(page.getByRole("link", { name: "Study this list" })).toHaveCount(0);

    // …and the list it belongs to is linked below the examples.
    const list = page.getByRole("link", { name: "JLPT N5 Starter" });
    const examples = page.getByText("Example sentences").first();
    const listBox = await list.boundingBox();
    const examplesBox = await examples.boundingBox();
    expect(listBox, "list link").not.toBeNull();
    expect(examplesBox, "examples heading").not.toBeNull();
    expect(listBox!.y).toBeGreaterThan(examplesBox!.y);
  });

  test("puts Forms before Examples, with the side-by-side cards the same height", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/words/1");
    await page.waitForLoadState("networkidle");

    // Words are private to their owner: a fresh browser has no device cookie, so
    // it can only see the starter pack. Nothing to lay out in that case.
    if (await page.getByRole("heading", { level: 1, name: "404" }).isVisible().catch(() => false)) {
      test.skip(true, "word 1 is not visible to this browser's owner");
    }

    const forms = page.getByText(/^Forms/).first();
    const examples = page.getByText(/^Example sentences/).first();
    await expect(forms).toBeVisible();
    await expect(examples).toBeVisible();

    const formsBox = await forms.boundingBox();
    const examplesBox = await examples.boundingBox();
    expect(formsBox, "forms heading").not.toBeNull();
    expect(examplesBox, "examples heading").not.toBeNull();
    // The forms card swapped places with the examples card.
    expect(formsBox!.y).toBeLessThan(examplesBox!.y);

    // The two cards that share the row (meanings | forms) are stretched to the
    // same height rather than sizing to their own content.
    const heights = await page.evaluate(() => {
      const heading = Array.from(document.querySelectorAll("main div, main h2, main h3")).find(
        (el) => (el.textContent ?? "").trim() === "Meanings"
      );
      const meaningsCard = heading?.closest("[class*='rounded-']") as HTMLElement | null;
      const formsHeading = Array.from(document.querySelectorAll("main div")).find((el) =>
        (el.textContent ?? "").trim().startsWith("Forms")
      );
      const formsCard = formsHeading?.closest("[class*='rounded-']") as HTMLElement | null;
      if (!meaningsCard || !formsCard) return null;
      return {
        meanings: Math.round(meaningsCard.getBoundingClientRect().height),
        forms: Math.round(formsCard.getBoundingClientRect().height),
        sameRow:
          Math.abs(meaningsCard.getBoundingClientRect().y - formsCard.getBoundingClientRect().y) <
          4,
      };
    });

    expect(heights).not.toBeNull();
    expect(heights!.sameRow).toBe(true);
    expect(heights!.meanings).toBe(heights!.forms);
  });
});

/**
 * Every page opens with the same header block — the back-link row, the title
 * (+ optional badge) and the subtitle line — so moving from a list into a word,
 * a phrase or a form never changes the size of the top of the page.
 */
test.describe("page header", () => {
  const PAGES = [
    "/",
    "/words",
    "/phrases",
    "/phrases/lists",
    "/words/examples",
    "/rules",
    "/rules/examples",
    "/study/flashcards",
    "/study/quizzes",
    "/words/1",
    "/lists/1",
    "/rules/1",
    "/lists/new",
    "/phrases/new",
    "/rules/new",
  ];

  test("keeps the same shape and height on lists, detail pages and forms", async ({ page }) => {
    const heights: number[] = [];

    for (const path of PAGES) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");

      const header = page.locator("main [data-slot='page-header']");
      await expect(header, path).toHaveCount(1);
      await expect(header.locator("h1"), path).toHaveCount(1);
      await expect(header.locator("[data-slot='page-subtitle']"), path).toHaveCount(1);

      const box = await header.boundingBox();
      expect(box, path).not.toBeNull();
      heights.push(Math.round(box!.height));
    }

    // Same pixel height everywhere — this is the jump the design prevents.
    expect(new Set(heights).size, heights.join(", ")).toBe(1);
  });

  test("puts an item's tags to the right of the subtitle", async ({ page }) => {
    await page.goto("/rules/1");

    const subtitle = await page.locator("main [data-slot='page-subtitle']").boundingBox();
    const tags = await page.locator("main [data-slot='page-tags']").boundingBox();
    expect(subtitle, "subtitle").not.toBeNull();
    expect(tags, "tags").not.toBeNull();
    // Same row, and the chips sit to the right of the subtitle.
    expect(Math.abs(tags!.y - subtitle!.y)).toBeLessThan(8);
    expect(tags!.x).toBeGreaterThan(subtitle!.x + subtitle!.width);

    // An item without tags reserves the same room, so the header never resizes.
    const withTags = await page.locator("main [data-slot='page-header']").boundingBox();
    await page.goto("/words/1");
    await expect(page.locator("main [data-slot='page-tags']")).toHaveCount(0);
    const withoutTags = await page.locator("main [data-slot='page-header']").boundingBox();
    expect(withTags).not.toBeNull();
    expect(withoutTags).not.toBeNull();
    expect(withTags!.height).toBe(withoutTags!.height);
  });

  test("navigates with breadcrumbs rather than back buttons", async ({ page }) => {
    await page.goto("/rules/new");
    const crumbs = page.getByRole("navigation", { name: "breadcrumb" });
    await expect(crumbs.getByRole("link", { name: "Rules & forms" })).toHaveAttribute(
      "href",
      "/rules"
    );

    // The title leads, its subtitle follows, and the trail opens the body.
    // Measured in one evaluate so a dev-server reload can't detach an element
    // between the calls, and polled until all three are laid out.
    const headerOrder = () =>
      page.evaluate(() => {
        const y = (selector: string) => {
          const el = document.querySelector(selector);
          return el ? Math.round(el.getBoundingClientRect().y) : null;
        };
        return {
          title: y("main h1"),
          subtitle: y("main [data-slot='page-subtitle']"),
          trail: y("main [data-slot='page-crumbs']"),
        };
      });

    await expect
      .poll(headerOrder)
      .toEqual({ title: expect.any(Number), subtitle: expect.any(Number), trail: expect.any(Number) });

    const layout = await headerOrder();
    expect(layout.title!).toBeLessThan(layout.subtitle!);
    expect(layout.subtitle!).toBeLessThan(layout.trail!);
    await expect(crumbs.locator("[aria-current='page']")).toHaveText("Add rule");

    // A nested page trails through every ancestor, outermost first, ending on
    // the page itself.
    await page.goto("/lists/1/edit");
    const editCrumbs = page.getByRole("navigation", { name: "breadcrumb" });
    await expect(editCrumbs.locator("a")).toHaveCount(2);
    await expect(editCrumbs.getByRole("link", { name: "Word lists" })).toHaveAttribute(
      "href",
      "/"
    );
    await expect(editCrumbs.getByRole("link", { name: "JLPT N5 Starter" })).toHaveAttribute(
      "href",
      "/lists/1"
    );
    await expect(editCrumbs.locator("[aria-current='page']")).toHaveText("Edit word list");

    // Word examples trail through Words, matching the rule-examples page.
    await page.goto("/words/examples");
    await expect(
      page.getByRole("navigation", { name: "breadcrumb" }).getByRole("link", { name: "Words" })
    ).toHaveAttribute("href", "/words");

    // Top-level pages have no trail, and nothing says "Back to …" any more.
    await page.goto("/rules");
    await expect(page.getByRole("navigation", { name: "breadcrumb" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Back to / })).toHaveCount(0);
  });
});

test.describe("settings page", () => {
  test("hydrates without a server/client mismatch", async ({ page }) => {
    const problems: string[] = [];
    page.on("pageerror", (error) => problems.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(message.text());
    });

    await page.goto("/settings");
    await page.waitForLoadState("networkidle");
    await waitForHydration(page);

    // The skeleton renders first (server + first client render), then the
    // live component mounts — either way, the heading must be present.
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    expect(problems.filter((text) => /hydration/i.test(text))).toEqual([]);
  });
});
