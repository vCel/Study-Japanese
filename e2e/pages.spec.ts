import { expect, test, type Page } from "@playwright/test";

import {
  expectHydrated,
  listIdByTitle,
  ruleIdByTitle,
  seedStarterPack,
  STARTER_WORD_LIST,
  stubConvex,
  waitForFonts,
  waitForHydration,
  wordIdByTitle,
} from "./helpers";

/**
 * These pages are all empty until the browser's owner owns something, so every
 * test starts by taking a copy of the starter pack. That also retires the
 * hard-coded ids (`/words/1`, `/lists/1`): the seeded rows have `owner_id IS
 * NULL` and are invisible to an owner, so ids are resolved from the list pages.
 */
test.beforeEach(async ({ page }) => {
  await stubConvex(page);
  await seedStarterPack(page);
});

/** Seeded titles used to resolve ids. */
const WORD = "日本語";
const WORD_LIST = STARTER_WORD_LIST;
const PHRASE_LIST = "Everyday Phrases";
const RULE = "Polite ます-form";

/** Titles of the cards on a listing page (each card renders its title as an h2). */
async function cardTitles(page: Page, path: string): Promise<string[]> {
  await page.goto(path);
  // The cards are server-rendered, so waiting for the network to go quiet is
  // pure overhead on a dev server. Waiting for the first card is also the
  // stronger assertion: a listing that renders nothing now fails here, at the
  // page that rendered nothing, rather than as an empty-array mismatch later.
  await expect(page.locator("main h2").first()).toBeVisible({ timeout: 30_000 });
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

  /**
   * The shape a word/phrase card has, read off the first card on a page:
   * headword, its kana reading as muted text, and the part of speech as a badge
   * pinned into the footer at the card's bottom-right corner.
   */
  async function firstCard(page: Page, path: string) {
    await page.goto(path);
    const card = page.locator("main [data-slot='word-card']").first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    // Every number below is a measurement, so the webfont has to have settled.
    await waitForFonts(page);
    return card.evaluate((el) => {
      const h2 = el.querySelector("h2") as HTMLElement;
      const kana = h2.nextElementSibling as HTMLElement | null;
      const badge = el.querySelector("span.rounded-full") as HTMLElement | null;
      const cardBox = el.getBoundingClientRect();
      const badgeBox = badge?.getBoundingClientRect();
      return {
        headword: h2.textContent?.trim() ?? null,
        // Only a plain paragraph counts — a badge would be a `<span>`.
        kana: kana?.tagName === "P" ? (kana.textContent?.trim() ?? null) : null,
        kanaIsBadge: kana?.classList.contains("rounded-full") ?? false,
        badge: badge?.textContent?.trim() ?? null,
        badgeFromBottom: badgeBox ? Math.round(cardBox.bottom - badgeBox.bottom) : null,
        badgeFromRight: badgeBox ? Math.round(cardBox.right - badgeBox.right) : null,
      };
    });
  }

  test("phrase cards are laid out exactly like word cards", async ({ page }) => {
    const words = await firstCard(page, "/words");
    const phrases = await firstCard(page, "/phrases");

    expect(words.headword).toBe("日本語");
    expect(words.kana).toBe("にほんご");
    expect(phrases.headword).toBe("おはようございます");
    // The kana sits under the headword as text, the way `/words` renders it —
    // it used to be a badge above the word here.
    expect(phrases.kana).toBe("おはようございます");
    expect(words.kanaIsBadge).toBe(false);
    expect(phrases.kanaIsBadge, "the kana is muted text, not a badge").toBe(false);

    // The part of speech moved from the top badges into the footer, the same
    // distance from the card's bottom-right corner as on a word card.
    expect(words.badge).toBe("noun");
    expect(phrases.badge).toBe("phrase");
    expect(phrases.badgeFromBottom).toBe(words.badgeFromBottom);
    expect(phrases.badgeFromRight).toBe(words.badgeFromRight);
  });
});

/**
 * Every list card ends the same way — count badge left, Study button right —
 * and that footer is pinned to the card's bottom edge, so a row of cards ends
 * flush whether or not each list carries a description.
 */
test.describe("list cards", () => {
  test("keep the footer on the card's bottom edge without a description", async ({ page }) => {
    await page.goto("/");
    const cards = page.locator("main [data-slot='list-card']");
    await expect(cards.first()).toBeVisible({ timeout: 30_000 });
    expect(await cards.count(), "seeded word lists").toBeGreaterThan(1);

    // The seeded lists all carry a description, so the case under test has to be
    // forced: removing the paragraph is what the layout has to survive.
    const removed = await page.evaluate(() => {
      const description = document.querySelector(
        "[data-slot='list-card'] [data-slot='list-description']"
      );
      description?.remove();
      return description ? 1 : 0;
    });
    expect(removed, "a seeded list carries a description to remove").toBe(1);
    await expect(
      cards.first().locator("[data-slot='list-description']")
    ).toHaveCount(0);

    const gaps = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[data-slot='list-card']")).map((card) => {
        const footer = card.querySelector("[data-slot='list-card-footer']");
        return footer
          ? Math.round(
              card.getBoundingClientRect().bottom - footer.getBoundingClientRect().bottom
            )
          : null;
      })
    );

    expect(gaps.filter((gap) => gap === null), "cards missing a footer").toEqual([]);
    // One card is now a line shorter; every footer must still sit the same
    // distance from its own card's bottom edge.
    expect(new Set(gaps).size, `footer gaps: ${gaps.join(", ")}`).toBe(1);
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
    const id = await listIdByTitle(page, PHRASE_LIST, "/phrases/lists");
    await page.goto(`/lists/${id}`);
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
    await page.goto(`/words/${await wordIdByTitle(page, WORD)}`);

    // Meanings are a numbered list, not badges.
    await expect(page.locator("main ol li").first()).toBeVisible();
    await expect(page.getByText("Japanese language")).toBeVisible();

    // There is no "study this list" button on a word page…
    await expect(page.getByRole("link", { name: "Study this list" })).toHaveCount(0);

    // …and the list it belongs to is linked below the examples. Comparing two
    // y-positions only means something once text metrics have settled.
    await waitForFonts(page);
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
    await page.goto(`/words/${await wordIdByTitle(page, WORD)}`);
    // Every assertion here is a height comparison.
    await waitForFonts(page);

    // No word in the starter pack carries conjugation forms, so there is no
    // Forms card to lay out. (This used to skip because `/words/1` 404'd for a
    // fresh owner — the reason was wrong, even though the outcome was right.)
    if ((await page.getByText(/^Forms/).count()) === 0) {
      test.skip(true, "the starter pack ships no conjugation forms");
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
  /** Pages whose URL is the same for every owner. */
  const STATIC_PAGES = [
    "/",
    "/words",
    "/phrases",
    "/phrases/lists",
    "/rules",
    "/study/flashcards",
    "/study/quizzes",
    "/lists/new",
    "/phrases/new",
    "/rules/new",
  ];

  test("keeps the same shape and height on lists, detail pages and forms", async ({ page }) => {
    // Detail pages need ids resolved for *this* owner — see the note at the top.
    const detailPages = [
      `/words/${await wordIdByTitle(page, WORD)}`,
      `/lists/${await listIdByTitle(page, WORD_LIST)}`,
      `/rules/${await ruleIdByTitle(page, RULE)}`,
    ];

    const heights: number[] = [];

    for (const path of [...STATIC_PAGES, ...detailPages]) {
      await page.goto(path);

      // No `networkidle` here: the header is server-rendered, so it is already
      // in the HTML that `goto` resolved on, and waiting for the network to go
      // quiet on fifteen dev-server page loads is what made this sweep the
      // slowest test in the suite. What the measurement *does* depend on is the
      // webfont — text metrics decide the header's height.
      await waitForFonts(page);

      const header = page.locator("main [data-slot='page-header']");
      // Strict-mode visible == exactly one, which is the old `toHaveCount(1)`
      // plus the guarantee that it is actually laid out.
      await expect(header, path).toBeVisible();
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
    await page.goto(`/rules/${await ruleIdByTitle(page, RULE)}`);

    const subtitle = await page.locator("main [data-slot='page-subtitle']").boundingBox();
    const tags = await page.locator("main [data-slot='page-tags']").boundingBox();
    expect(subtitle, "subtitle").not.toBeNull();
    expect(tags, "tags").not.toBeNull();
    // Same row, and the chips sit to the right of the subtitle.
    expect(Math.abs(tags!.y - subtitle!.y)).toBeLessThan(8);
    expect(tags!.x).toBeGreaterThan(subtitle!.x + subtitle!.width);

    // An item without tags reserves the same room, so the header never resizes.
    const withTags = await page.locator("main [data-slot='page-header']").boundingBox();
    await page.goto(`/words/${await wordIdByTitle(page, WORD)}`);
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
    const listId = await listIdByTitle(page, WORD_LIST);
    await page.goto(`/lists/${listId}/edit`);
    const editCrumbs = page.getByRole("navigation", { name: "breadcrumb" });
    await expect(editCrumbs.locator("a")).toHaveCount(2);
    await expect(editCrumbs.getByRole("link", { name: "Word lists" })).toHaveAttribute(
      "href",
      "/"
    );
    await expect(editCrumbs.getByRole("link", { name: WORD_LIST })).toHaveAttribute(
      "href",
      `/lists/${listId}`
    );
    await expect(editCrumbs.locator("[aria-current='page']")).toHaveText("Edit word list");

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
    // Kept on purpose, like the session-rendering spec in study.spec.ts: this
    // test watches for errors rather than content, and a hydration mismatch can
    // be reported a tick after the markup is up.
    await page.waitForLoadState("networkidle");
    await waitForHydration(page);

    // The skeleton renders first (server + first client render), then the
    // live component mounts — either way, the heading must be present.
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    expect(problems.filter((text) => /hydration/i.test(text))).toEqual([]);
  });
});
