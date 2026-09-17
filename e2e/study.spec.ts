import { expect, test, type Page } from "@playwright/test";

import {
  ACCORDION_TRIGGER,
  listIdByTitle,
  seedStarterPack,
  stubConvex,
  waitForFonts,
  waitForHydration,
} from "./helpers";

/**
 * The Flashcards builder (/study/flashcards) is split into three independent
 * sections (words, phrases, forms) using the Lightswind tabs component, and
 * saved sessions moved into save/load drawers.
 *
 * Every spec here reads owner-scoped content, so this browser has to own a copy
 * of the starter pack before any section has something to deal — with an empty
 * library the panels render their "nothing here yet" copy and *Start studying*
 * stays disabled. `stubConvex` comes first because `seedStarterPack` clicks a
 * button, and clicks are dropped until React has hydrated.
 */
test.beforeEach(async ({ page }) => {
  await stubConvex(page);
  await seedStarterPack(page);
});

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

/** Only the active tab's panel is mounted, so scope by its `data-value`. */
function panelFor(page: Page, kind: StudyTab) {
  return page.locator(`[role="tabpanel"][data-value="${kind}"]`);
}

type StudyTab = "words" | "phrases" | "forms";

const TAB_LABELS: Record<StudyTab, string> = {
  words: "Words",
  phrases: "Phrases",
  forms: "Rules",
};

/** The seeded word list the word-list specs drill into. */
const STARTER_LIST = "JLPT N5 Starter";

async function saveSession(page: Page, kind: StudyTab, name: string) {
  await page.getByRole("tab", { name: TAB_LABELS[kind] }).click();
  await panelFor(page, kind).getByRole("button", { name: "Save session" }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("Session name").fill(name);
  await drawer.getByRole("button", { name: "Save session" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test.describe("study sections", () => {
  test("offers a words, phrases and rules tab", async ({ page }) => {
    await page.goto("/study");

    const tabs = page.getByRole("tablist");
    await expect(tabs.getByRole("tab")).toHaveText(["Words", "Phrases", "Rules"]);

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
    await page.goto("/study/flashcards");
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

    // …and rules swaps the source picker for a rule-kind picker.
    await page.getByRole("tab", { name: "Rules" }).click();
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
    await page.goto("/study/flashcards");
    await waitForHydration(page);

    await panelFor(page, "words").getByRole("button", { name: "Start studying" }).click();

    await expect(page).toHaveURL(/\/study\/flashcards\/session\?kind=words/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Words");
    await expect(page.getByRole("button", { name: "Reveal answer" })).toBeVisible();
  });

  test("starts a rules session with grammar cards", async ({ page }) => {
    await page.goto("/study/flashcards?kind=forms");
    await waitForHydration(page);

    // The deep link opens straight on the rules tab.
    await expect(page.getByRole("tab", { name: "Rules" })).toHaveAttribute(
      "aria-selected",
      "true"
    );

    await panelFor(page, "forms").getByRole("button", { name: "Start studying" }).click();

    await expect(page).toHaveURL(/kind=forms/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Rules");
    await expect(page.getByRole("button", { name: "Reveal answer" })).toBeVisible();
  });

  test("a phrase-list link studies phrases (kind is inferred)", async ({ page }) => {
    await page.goto("/phrases/lists");
    await waitForHydration(page);
    // Scope to the list cards' Study action — the sidebar links in this section
    // are called Flashcards and Quizzes now.
    const study = page.locator("main").getByRole("link", { name: "Study" }).first();
    await expect(study).toBeVisible();
    await study.click();

    await expect(page).toHaveURL(/\/study\/flashcards\/session\?lists=/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Phrases");
  });

  test("the answer buttons are wide and the card flips in place", async ({ page }) => {
    await page.goto("/study/flashcards/session?kind=words&limit=4");
    // The card below is a stateful button, so a click that lands before React is
    // listening is silently dropped and the flip never happens. Hydration is fast
    // in isolation but not under full-suite load, where this was flaking.
    await waitForHydration(page);
    // The button widths below are text-width dependent.
    await waitForFonts(page);

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

test.describe("starting from a word list", () => {
  test("one Study button opens a menu with the deck choices", async ({ page }) => {
    // Resolved from the list page rather than hard-coded: the seeded ids belong
    // to `owner_id IS NULL` rows, and `seedStarterPack` copies them into rows
    // with new ids.
    await page.goto(`/lists/${await listIdByTitle(page, STARTER_LIST)}`);
    await waitForHydration(page);

    // A single button — "all cards" and "starred only" are choices inside it,
    // not two buttons competing for the same corner.
    await expect(page.getByRole("link", { name: "Study this list" })).toHaveCount(0);
    const trigger = page.getByRole("button", { name: "Study this list" });
    await expect(trigger).toBeVisible();

    await trigger.click();
    const menu = page.locator("[data-slot='popover']");
    await expect(menu).toBeVisible();
    // One entry, because this browser is signed out: with no stars there is no
    // "starred only" choice to offer.
    await expect(menu.getByRole("menuitem")).toHaveCount(1);
    await expect(menu).toContainText("Every card in this list");

    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  });

  test("the menu's all-cards entry starts a session for that list", async ({ page }) => {
    const listId = await listIdByTitle(page, STARTER_LIST);
    await page.goto(`/lists/${listId}`);
    await waitForHydration(page);

    await page.getByRole("button", { name: "Study this list" }).click();
    await page.locator("[data-slot='popover']").getByRole("menuitem").first().click();

    await expect(page).toHaveURL(new RegExp(`/study/flashcards/session\\?lists=${listId}`));
    await expect(page.getByRole("button", { name: "Reveal answer" })).toBeVisible();
  });
});

test.describe("session rendering", () => {
  test("hydrates without a server/client mismatch", async ({ page }) => {
    const problems: string[] = [];
    page.on("pageerror", (error) => problems.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(message.text());
    });

    await page.goto("/study/flashcards/session?kind=words&limit=4");
    // `networkidle` stays here on purpose: this spec is watching for errors, not
    // for content, and a hydration mismatch can be reported a tick after the
    // markup is up. The extra patience is the point — don't trade it for speed.
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button", { name: "Reveal answer" })).toBeVisible();

    // Both the deck's leading sides and its order are dealt by the loader, so
    // React must never have to throw the server markup away and rebuild it.
    expect(problems.filter((text) => /hydration/i.test(text))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Grammar rules are drilled differently from words: the explanation is always
// the *answer* (never the question), and a rule with several ポイント is
// several separate things to learn, so it is dealt as several cards.
// ---------------------------------------------------------------------------

const POINT_ONE = "Verb stem + ました";
const POINT_TWO = "Drop ます and add ました";
const EXPLANATION = "Switch the verb to its polite past to describe something that already happened.";
const RULE_TITLE = "Polite past probe";

/** A rule of its own, tagged so the deck can be scoped to just this rule. */
const MULTI_POINT_RULE = JSON.stringify([
  {
    kind: "word",
    title: RULE_TITLE,
    points: [POINT_ONE, POINT_TWO],
    explanation: EXPLANATION,
    tags: "pointsplit",
  },
]);

/** The card's "click to reveal" hint, which sits under the question text. */
const REVEAL_HINT = /\s*click or press space to reveal\s*/i;

test.describe("rules decks", () => {
  test("asks the point first, and deals one card per point", async ({ page }) => {
    // Reached from the rules list, the way a reader does, so the form hands the
    // browser back to that list once the rule is written.
    await page.goto("/rules");
    await waitForHydration(page);
    await page.getByRole("link", { name: "Add rule" }).click();
    await expect(page).toHaveURL(/\/rules\/new$/);

    // The accordion's open state is React state: a click that lands on the
    // server markup is undone by hydration, leaving the panel shut.
    await page.getByRole("button", { name: ACCORDION_TRIGGER }).click();
    await page.locator("[data-slot='json-import-textarea']").fill(MULTI_POINT_RULE);
    await page.getByRole("button", { name: "Fill form from JSON" }).click();
    await page.getByRole("button", { name: "Create rule", exact: true }).click();
    await expect(page).toHaveURL(/\/rules$/);

    // The tag scopes the deck to this single rule, so the assertions below do
    // not depend on whatever else the library holds.
    await page.goto("/study/flashcards/session?kind=forms&tags=pointsplit&limit=100");
    await waitForHydration(page);

    // Two points became two cards, and both were drawn into the session.
    await expect(page.locator("main")).toContainText("drew 2 random cards");

    const front = page.locator("[data-slot='flashcard-front']");
    const back = page.locator("[data-slot='flashcard-back']");

    const questions: string[] = [];
    for (const index of [0, 1]) {
      // Answering a card swaps in the next one; wait for it before reading.
      if (index > 0) await expect(front).not.toContainText(questions[0]);

      // The question side is the point — never the explanation, which is what
      // the card is asking the reader to recall.
      const question = (await front.innerText()).replace(REVEAL_HINT, "").trim();
      expect([POINT_ONE, POINT_TWO]).toContain(question);
      expect(question).not.toContain(EXPLANATION);
      questions.push(question);

      // Flipping is what reveals the meaning, alongside the rule it belongs to.
      await page.getByRole("button", { name: "Reveal answer" }).click();
      await expect(back).toContainText(EXPLANATION);
      await expect(back).toContainText(RULE_TITLE);

      await page.getByRole("button", { name: /Got it/ }).click();
    }

    // Each point was asked exactly once — two points, two cards, not one card
    // that hides point two behind point one.
    expect([...questions].sort()).toEqual([POINT_ONE, POINT_TWO].sort());
  });

  test("a starter-pack rule still makes a single card", async ({ page }) => {
    await page.goto("/study/flashcards/session?kind=forms&limit=40");
    await waitForHydration(page);

    // Every seeded rule carries exactly one point, so rules and cards still line
    // up one for one — the split only applies to rules that list more.
    const summary = /(\d+) rules · drew (\d+) random cards/.exec(
      await page.locator("main").innerText()
    );
    expect(summary, "the session header reports its scope and deck size").not.toBeNull();
    const [, rules, cards] = summary!;
    expect(Number(rules)).toBeGreaterThan(0);
    expect(Number(cards)).toBe(Number(rules));
  });
});

test.describe("saved study sessions", () => {
  test("saves a configuration through the save drawer", async ({ page }) => {
    await page.goto("/study/flashcards");
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
    await page.goto("/study/flashcards");
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
    await page.goto("/study/flashcards");
    await waitForHydration(page);

    await saveSession(page, "words", "Words only");
    await saveSession(page, "forms", "Grammar drills");

    // Phrases has no sessions of its own yet…
    await page.getByRole("tab", { name: "Phrases" }).click();
    await expect(panelFor(page, "phrases").getByRole("button", { name: "Load" })).toBeDisabled();

    // …while rules only lists the session saved on the rules tab.
    await page.getByRole("tab", { name: "Rules" }).click();
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

// ---------------------------------------------------------------------------
// "Reading on the front" (the flashcards builder's Options card).
//
// A word written in kanji is *asked* as kanji, so a learner who cannot read it
// yet is guessing at the reading as well as the meaning; the setting puts the
// kana under the word to take that second guess away. It must not do so on a
// front that is the meaning — there the reading hands over the kanji — and it
// must leave a card whose headword is already its own reading alone.
// ---------------------------------------------------------------------------

/** Any kana at all. The meanings are English, so kana on a meaning-side front is a leak. */
const KANA = /[\u3040-\u309f\u30a0-\u30ff]/;
/** A line written *only* in kana — a headword that is its own reading. */
const KANA_ONLY = /^[\u3040-\u309f\u30a0-\u30ff]+$/;
/** The hint a meaning-side front carries — how a spec tells the two sides apart. */
const GUESS_HINT = /\s*guess the answer, then click to check\s*/i;

interface CardRead {
  /** The front's raw text, hint included. */
  frontText: string;
  /** True when the front is the Japanese side rather than the meaning. */
  titleSide: boolean;
  /** The front's own lines, with the click hint stripped off. */
  frontLines: string[];
  /** The answer side. Both faces are mounted at once, so this costs no click. */
  backText: string;
}

async function readCard(page: Page): Promise<CardRead> {
  const frontText = await page.locator("[data-slot='flashcard-front']").innerText();
  return {
    frontText,
    titleSide: REVEAL_HINT.test(frontText),
    frontLines: frontText
      .replace(REVEAL_HINT, "")
      .replace(GUESS_HINT, "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    backText: await page.locator("[data-slot='flashcard-back']").innerText(),
  };
}

/**
 * Answer every card of the session and report what each one showed.
 *
 * The deck size comes off the header rather than being assumed, so this still
 * walks the whole deck if the starter pack grows.
 */
async function walkDeck(page: Page): Promise<CardRead[]> {
  const header = /drew (\d+) random card/.exec(await page.locator("main").innerText());
  expect(header, "the session header reports its deck size").not.toBeNull();
  const size = Number(header![1]);

  const cards: CardRead[] = [];
  for (let index = 0; index < size; index += 1) {
    const card = await readCard(page);
    cards.push(card);
    await page.getByRole("button", { name: /Got it/ }).click();
    // Answering swaps in the next card, which remounts the flip card — reading
    // it before the swap would report the card just answered. Polled on
    // `innerText` rather than asserted with `toHaveText`, which compares the
    // whitespace-normalised `textContent` and so would match nothing here and
    // pass without ever waiting.
    if (index < size - 1) {
      await expect
        .poll(() => page.locator("[data-slot='flashcard-front']").innerText())
        .not.toBe(card.frontText);
    }
  }
  return cards;
}

test.describe("reading on the front", () => {
  test("puts the kana under the word on the question side", async ({ page }) => {
    await page.goto("/study/flashcards/session?kind=words&limit=100");
    await waitForHydration(page);

    const cards = await walkDeck(page);
    // The words tab holds only words written in kanji, so every card here has a
    // reading to add and every question side dealt should be carrying it.
    const questions = cards.filter((card) => card.titleSide);
    expect(questions.length, "some cards were dealt their Japanese side").toBeGreaterThan(0);
    for (const card of questions) {
      expect(card.frontLines, "the word, then its reading").toHaveLength(2);
      expect(card.frontLines[1], "the reading is written in kana").toMatch(KANA_ONLY);
      expect(card.frontLines[1], "and is not the word over again").not.toBe(card.frontLines[0]);
    }

    // A front that *is* the meaning never carries it: the reading is written
    // with the very kanji the card is asking for. Both sides have to be dealt
    // for that to mean anything, so their presence is asserted, not assumed.
    const meanings = cards.filter((card) => !card.titleSide);
    expect(meanings.length, "some cards were dealt their meaning side").toBeGreaterThan(0);
    for (const card of meanings) {
      expect(card.frontText, "no reading on a meaning-side front").not.toMatch(KANA);
    }

    // The answer side still states the card in full, which is what keeps this a
    // hint rather than a removal.
    for (const card of cards) expect(card.backText).toMatch(KANA);

    // Rules never get the setting: a rule's title is its *name*, not a reading
    // of the ポイント the card asks about, so there is nothing for it to act on.
    await page.goto("/study/flashcards?kind=forms");
    await waitForHydration(page);
    await expect(
      panelFor(page, "forms").getByRole("switch", { name: "Reading on the front" })
    ).toHaveCount(0);
  });

  test("off means the question side is just the word", async ({ page }) => {
    await page.goto("/study/flashcards");
    await waitForHydration(page);

    // On by default, before anything has been stored.
    const toggle = page.getByRole("switch", { name: "Reading on the front" });
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(
      await page.evaluate(() => window.localStorage.getItem("jv:study:front-reading")),
      "the choice is stored, not just held in state"
    ).toBe("0");

    await page.goto("/study/flashcards/session?kind=words&limit=100");
    await waitForHydration(page);

    const cards = await walkDeck(page);
    const questions = cards.filter((card) => card.titleSide);
    expect(questions.length, "some cards were dealt their Japanese side").toBeGreaterThan(0);
    // One line, the headword. A verb like 食べる keeps its okurigana, so the line
    // count — not the absence of kana — is what says the reading is gone.
    for (const card of questions) expect(card.frontLines, "just the word").toHaveLength(1);
    // And nothing else on the front either: the meaning side is English.
    const meanings = cards.filter((card) => !card.titleSide);
    expect(meanings.length, "some cards were dealt their meaning side").toBeGreaterThan(0);
    for (const card of meanings) {
      expect(card.frontText, "no reading on a meaning-side front").not.toMatch(KANA);
    }
    // The reading is still on the answer side, so hiding it costs nothing.
    for (const card of cards) expect(card.backText).toMatch(KANA);
  });

  test("a card already written in kana gains no second line", async ({ page }) => {
    // Three of the five seeded phrases are written in kana, so their reading is
    // the headword and a second line would only repeat it. Which side a card is
    // dealt is the loader's coin toss, so the session is re-dealt until one of
    // those comes up on its Japanese side — the cap is what makes a future
    // starter pack without one fail loudly instead of looping.
    let kanaCard: CardRead | null = null;
    for (let attempt = 0; attempt < 6 && kanaCard === null; attempt += 1) {
      await page.goto("/study/flashcards/session?kind=phrases&limit=100");
      await waitForHydration(page);
      kanaCard =
        (await walkDeck(page)).find(
          (card) =>
            card.titleSide && card.frontLines.length === 1 && KANA_ONLY.test(card.frontLines[0])
        ) ?? null;
    }
    expect(kanaCard, "a kana-only phrase was dealt its Japanese side").not.toBeNull();

    // One line, which is the word and its reading at once…
    expect(kanaCard!.frontLines).toHaveLength(1);
    // …and the answer side still states the card in full.
    expect(kanaCard!.backText).toContain(kanaCard!.frontLines[0]);
  });
});

test.describe("json import", () => {
  test("copies the example JSON with the animated copy button", async ({ page }) => {
    await page.goto("/lists/new");
    // The accordion's open state is React state: a click that lands on the
    // server markup is undone by hydration, leaving the panel shut.
    await waitForHydration(page);
    await page.getByRole("button", { name: /Bulk import from JSON/ }).click();

    const copy = page.getByRole("button", { name: "Copy the example JSON" });
    await expect(copy).toBeVisible();
    await copy.click();

    await expect(page.locator('[data-slot="toast"]')).toContainText("Example JSON copied");

    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(Array.isArray(JSON.parse(copied))).toBe(true);
  });
});
