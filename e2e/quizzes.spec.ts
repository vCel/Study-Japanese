import { expect, test, type Page, type Route } from "@playwright/test";

import { expectHydrated, seedStarterPack, stubConvex, wordIdByTitle } from "./helpers";

/**
 * The Quizzes builder (/study/quizzes) and the session page
 * (/study/quizzes/session).
 *
 * Unlike the flashcards builder there are no tabs: words, phrases and rules are
 * togglable buttons, so a single quiz can draw on any combination of them. The
 * panel below shows only the steps that apply to what is switched on.
 *
 * The generation endpoint is always stubbed: the real thing calls out to Gemini
 * and GLM, which would make these specs slow, non-deterministic, and would
 * spend the account's quota. What is under test here is the UI and the client's
 * handling of the response — the providers themselves are not.
 *
 * Convex is stubbed too (see `stubConvex`): the builder renders inside
 * `ConvexClientProvider`, so if the convex.cloud websocket never opens, React
 * hydration silently stalls and *every* assertion on the page fails. Stubbing
 * keeps the suite off the network.
 */

interface StubQuestion {
  type: string;
  prompt: string;
  sentence?: string;
  blanks?: number;
  options?: string[];
  answer: string;
  acceptableAnswers?: string[];
  explanation?: string;
  sourceId?: number;
  sourceKind?: "word" | "rule";
}

/** A tiny, fully-valid question set, used wherever a successful run is needed. */
function sampleQuestions(): StubQuestion[] {
  return [
    {
      type: "multiple-choice",
      prompt: "What does 学生 mean?",
      options: ["student", "teacher", "doctor", "friend"],
      answer: "student",
      explanation: "学生 (がくせい) means student.",
      sourceId: 1,
      sourceKind: "word",
    },
    {
      type: "fill-blanks",
      prompt: "Fill in the missing particle.",
      sentence: "私___学生です",
      blanks: 1,
      options: ["は", "が", "を", "に"],
      answer: "は",
      explanation: "は marks the topic.",
      sourceId: 2,
      sourceKind: "rule",
    },
    {
      type: "input",
      prompt: "How is 学生 read?",
      answer: "がくせい",
      acceptableAnswers: ["gakusei"],
      explanation: "学生 is read がくせい.",
      sourceId: 3,
      sourceKind: "word",
    },
  ];
}

/** Stub a successful generation, recording the request body for assertions. */
async function stubGeneration(
  page: Page,
  questions: StubQuestion[] = sampleQuestions(),
  meta: { model?: string; attempts?: unknown[] } = {}
) {
  let captured: unknown = null;
  await page.route("**/api/quiz/generate", async (route: Route) => {
    captured = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        questions,
        model: meta.model ?? "gemini-3.8-flash",
        attempts: meta.attempts ?? [
          { model: "gemini-3.8-flash", provider: "gemini", outcome: "ok", ms: 900 },
        ],
      }),
    });
  });
  return () => captured;
}

/** Stub a failed generation. */
async function stubGenerationFailure(page: Page, message: string, attempts: unknown[] = []) {
  await page.route("**/api/quiz/generate", async (route: Route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: message, attempts }),
    });
  });
}

/**
 * A quiz in the shape a *live* generation returns: the Japanese is annotated
 * with ruby readings, `漢字《かんじ》`.
 *
 * `sampleQuestions` above deliberately has none — it predates the annotations,
 * and leaving it alone is what keeps every other spec in this file a check that
 * the renderer passes plain text through untouched. This fixture is the other
 * half: it is the one that would catch the renderer mangling real output, and
 * the one that catches the grader comparing an annotated answer against the
 * plain text the user actually types.
 *
 * The `input` question is the sharp end of that. Its `answer` is annotated and
 * its `acceptableAnswers` deliberately does *not* include the plain `学生` — so
 * typing 学生 can only be graded correct if the annotation is stripped before
 * the comparison.
 */
function furiganaQuestions(): StubQuestion[] {
  return [
    {
      type: "multiple-choice",
      prompt: "Which of these means 学生《がくせい》?",
      options: ["学生《がくせい》", "先生《せんせい》", "医者《いしゃ》", "友達《ともだち》"],
      answer: "学生《がくせい》",
      explanation: "学生《がくせい》 means student.",
      sourceId: 1,
      sourceKind: "word",
    },
    {
      type: "fill-blanks",
      prompt: "Fill in the missing particle.",
      sentence: "私《わたし》___学生《がくせい》です",
      blanks: 1,
      options: ["は", "が", "を", "に"],
      answer: "は",
      explanation: "は marks the topic.",
      sourceId: 2,
      sourceKind: "rule",
    },
    {
      type: "input",
      prompt: 'Type the Japanese for "student".',
      answer: "学生《がくせい》",
      acceptableAnswers: ["がくせい", "gakusei"],
      explanation: "学生《がくせい》 means student.",
      sourceId: 3,
      sourceKind: "word",
    },
  ];
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * A tag chip, found by the name it carries rather than by its state — the whole
 * point of the cycle is that the same chip is clicked more than once.
 *
 * The seeded tags are disjoint enough that a substring match is unambiguous:
 * `#n5` is not inside `#jlpt`, and neither appears in another chip's count.
 */
function tagChip(page: Page, name: string) {
  return page.locator("[data-tag-mode]", { hasText: name });
}

test.describe("quiz builder", () => {
  test("offers words, phrases and rules as togglable sources", async ({ page }) => {
    await stubConvex(page);
    await page.goto("/study/quizzes");

    // No tabs: the three sources are buttons, and a quiz may combine them.
    await expect(page.getByRole("tablist")).toHaveCount(0);

    for (const label of ["Words", "Phrases", "Rules"]) {
      await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
    }

    // Rules is the default, so its steps are the ones on show.
    await expect(page.getByRole("button", { name: "Rules", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(page.getByRole("button", { name: "Words", exact: true })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    // Rules is the only source on, so the shared source container is titled
    // for rules alone.
    await expect(page.getByText(/^\d+ · Rules$/)).toBeVisible();
    await expect(page.getByText(/^\d+ · Lists & rules$/)).toHaveCount(0);
  });

  test("sources can be combined, and the panel follows what is switched on", async ({ page }) => {
    await stubConvex(page);
    await page.goto("/study/quizzes");
    await expectHydrated(page);

    const words = page.getByRole("button", { name: "Words", exact: true });
    const rules = page.getByRole("button", { name: "Rules", exact: true });

    // Turning words on adds the word-only steps without dropping the rule one.
    await words.click();
    await expect(words).toHaveAttribute("aria-pressed", "true");
    await expect(rules).toHaveAttribute("aria-pressed", "true");
    // Words and rules share one container, sectioned inside it — so there is a
    // single "Lists & rules" step rather than one step per group.
    await expect(page.getByText(/^\d+ · Lists & rules$/)).toBeVisible();
    await expect(page.getByText(/^\d+ · Types of words$/)).toBeVisible();
    await expect(page.getByText(/^\d+ · What to ask about$/)).toBeVisible();
    // …and the rule type pills sit in that same container, not in a step of
    // their own. Nothing is seeded here, so the picker itself is empty.
    await expect(page.getByRole("button", { name: /All rules/ })).toBeVisible();
    await expect(page.getByText("No rules yet — create one and it appears here.")).toBeVisible();

    // Phrases join the same list section rather than adding a second one.
    await page.getByRole("button", { name: "Phrases", exact: true }).click();
    await expect(page.getByText(/^\d+ · Lists & rules$/)).toBeVisible();

    // Turning rules off retitles the container for the lists alone, and takes
    // the rule-only controls with it.
    await rules.click();
    await expect(rules).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByText(/^\d+ · Lists$/)).toBeVisible();
    await expect(page.getByRole("button", { name: /All rules/ })).toHaveCount(0);
  });

  test("the last source cannot be deselected", async ({ page }) => {
    await stubConvex(page);
    await page.goto("/study/quizzes");
    await expectHydrated(page);

    // Rules starts alone; turning words on then rules off leaves words only…
    await page.getByRole("button", { name: "Words", exact: true }).click();
    await page.getByRole("button", { name: "Rules", exact: true }).click();

    // …and that last one must stay on, so a quiz always has material to draw on.
    await page.getByRole("button", { name: "Words", exact: true }).click();
    await expect(page.getByRole("button", { name: "Words", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  test("exposes every quiz setting", async ({ page }) => {
    await stubConvex(page);
    await page.goto("/study/quizzes");
    await expectHydrated(page);

    await expect(page.getByText("Question types")).toBeVisible();
    await expect(page.getByText("Number of questions")).toBeVisible();
    await expect(page.getByText("Time limit per question")).toBeVisible();
    await expect(page.getByText("Difficulty")).toBeVisible();
    await expect(page.getByRole("button", { name: "Generate quiz" })).toBeVisible();
  });

  test("the question count is a select and the question types are pills", async ({ page }) => {
    await stubConvex(page);
    await page.goto("/study/quizzes");
    await expectHydrated(page);

    // The count is a Select, so its trigger shows the chosen option's label.
    // `exact` matters: the row's info tooltip is labelled "About Number of
    // questions", which a substring match would also hit.
    const count = page.getByRole("button", { name: "Number of questions", exact: true });
    await expect(count).toContainText("10 questions");

    await count.click();
    await page.getByRole("option", { name: "20 questions" }).click();
    await expect(page.getByRole("button", { name: "Number of questions", exact: true })).toContainText(
      "20 questions"
    );

    // Types stay multi-select pills: multiple-choice + fill-blanks by default.
    await expect(page.getByRole("button", { name: "Multiple choice" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(page.getByRole("button", { name: "Fill in the blanks" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    // …and adding a third keeps the other two on.
    await page.getByRole("button", { name: "Type the answer" }).click();
    await expect(page.getByRole("button", { name: "Type the answer" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(page.getByRole("button", { name: "Multiple choice" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  test("the last question type cannot be deselected", async ({ page }) => {
    await stubConvex(page);
    await page.goto("/study/quizzes");
    await expectHydrated(page);

    // Turn fill-blanks off, leaving only multiple-choice…
    await page.getByRole("button", { name: "Fill in the blanks" }).click();
    await expect(page.getByRole("button", { name: "Fill in the blanks" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );

    // …then try to turn that off too — it must stay on, so the quiz always has
    // at least one question type.
    await page.getByRole("button", { name: "Multiple choice" }).click();
    await expect(page.getByRole("button", { name: "Multiple choice" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  test("the time limit toggles its seconds row", async ({ page }) => {
    await stubConvex(page);
    await page.goto("/study/quizzes");
    await expectHydrated(page);

    const toggle = page.getByRole("switch", { name: "Time limit per question" });
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    // On by default, so the seconds row is showing.
    await expect(page.getByText("Seconds per question")).toBeVisible();

    // Seconds is a slider over the ladder the builder offers, starting on the
    // second rung (30s).
    const seconds = page.getByRole("slider", { name: "Seconds per question" });
    await expect(seconds).toHaveAttribute("aria-valuemin", "0");
    await expect(seconds).toHaveAttribute("aria-valuemax", "5");
    await expect(seconds).toHaveAttribute("aria-valuenow", "1");
    await expect(seconds).toHaveAttribute("aria-valuetext", "30 seconds");

    // Arrow keys step it — the accessible way to drive it. The thumb is
    // re-created on each commit, so re-query rather than reuse the handle.
    await seconds.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("slider", { name: "Seconds per question" })).toHaveAttribute(
      "aria-valuetext",
      "45 seconds"
    );

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(page.getByText("Seconds per question")).toHaveCount(0);

    await toggle.click();
    await expect(page.getByText("Seconds per question")).toBeVisible();
  });

  test("difficulty is a slider across easy, normal and hard", async ({ page }) => {
    await stubConvex(page);
    await page.goto("/study/quizzes");
    await expectHydrated(page);

    // The slider shares a line with its label, so both live in the same row.
    const slider = page.getByRole("slider", { name: "Difficulty" });
    await expect(slider).toBeVisible();
    await expect(slider).toHaveAttribute("aria-valuemin", "0");
    await expect(slider).toHaveAttribute("aria-valuemax", "2");
    // Normal is the default — the middle of the three steps.
    await expect(slider).toHaveAttribute("aria-valuenow", "1");
    await expect(slider).toHaveAttribute("aria-valuetext", "Normal");

    const labelBox = await page.getByText("Difficulty", { exact: true }).boundingBox();
    const sliderBox = await slider.boundingBox();
    expect(labelBox, "difficulty label").not.toBeNull();
    expect(sliderBox, "difficulty slider").not.toBeNull();
    // Same visual row: their vertical centres line up.
    const labelCentre = labelBox!.y + labelBox!.height / 2;
    const sliderCentre = sliderBox!.y + sliderBox!.height / 2;
    expect(Math.abs(labelCentre - sliderCentre)).toBeLessThan(12);

    // Arrow keys step the slider — the accessible way to drive it. The thumb
    // is re-created on each commit, so re-query rather than reuse the handle.
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("slider", { name: "Difficulty" })).toHaveAttribute(
      "aria-valuenow",
      "2"
    );
    await expect(page.getByRole("slider", { name: "Difficulty" })).toHaveAttribute(
      "aria-valuetext",
      "Hard"
    );
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("slider", { name: "Difficulty" })).toHaveAttribute(
      "aria-valuetext",
      "Easy"
    );
  });

  test("the even/random split appears only for multiple types", async ({ page }) => {
    await stubConvex(page);
    await page.goto("/study/quizzes");
    await expectHydrated(page);

    // Two types are on by default, so the split row starts visible.
    await expect(page.getByText("How to split them")).toBeVisible();
    await expect(page.getByRole("button", { name: "Even split" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    await page.getByRole("button", { name: "Mix freely" }).click();
    await expect(page.getByRole("button", { name: "Mix freely" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    // Down to one type — nothing to split.
    await page.getByRole("button", { name: "Fill in the blanks" }).click();
    await expect(page.getByText("How to split them")).toHaveCount(0);
  });

  test("'only what I keep missing' is hidden until something has been missed", async ({
    page,
  }) => {
    await stubConvex(page);
    // The log lives in Convex and is empty for a fresh browser, so the toggle
    // must not be offered — a misses quiz with no misses would be empty.
    await page.goto("/study/quizzes");
    await expectHydrated(page);

    await expect(page.getByRole("switch", { name: "Only what I keep missing" })).toHaveCount(0);
  });

  test("an empty list selection means every list, and the picker says so", async ({ page }) => {
    await stubConvex(page);
    // Lists are owner-scoped, so the starter pack has to be copied in first.
    await seedStarterPack(page);
    await page.goto("/study/quizzes");
    await expectHydrated(page);
    // Rules is the default source; the lists section only shows for words or
    // phrases. Both, so every seeded list is on offer.
    await page.getByRole("button", { name: "Words", exact: true }).click();
    await page.getByRole("button", { name: "Phrases", exact: true }).click();

    const daily = page.getByRole("button", { name: /Daily Conversation/ });
    const starter = page.getByRole("button", { name: /JLPT N5 Starter/ });
    const pill = page.getByRole("button", { name: "Select all lists" });

    // Nothing is narrowed, so every card reads as chosen and "select all" has
    // nothing to do. Offering it contradicted the hint beside it, which said
    // every list was already included.
    await expect(page.getByText(/Every list is included \(\d+\)\./)).toBeVisible();
    await expect(daily).toHaveAttribute("aria-pressed", "true");
    await expect(starter).toHaveAttribute("aria-pressed", "true");
    await expect(pill).toHaveCount(0);

    // Clicking a card that reads as chosen has to *deselect* it, not become the
    // only selection: the "every list" sentinel must be resolved before toggling.
    await daily.click();
    await expect(daily).toHaveAttribute("aria-pressed", "false");
    await expect(starter).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(/2 of 3 lists selected\./)).toBeVisible();
    await expect(pill).toBeVisible();

    // The pill restores the sentinel rather than listing the ids, so a list
    // created later is included too.
    await pill.click();
    await expect(page.getByText(/Every list is included \(\d+\)\./)).toBeVisible();
    await expect(daily).toHaveAttribute("aria-pressed", "true");
    await expect(pill).toHaveCount(0);
  });

  test("the tags step is second, and its search narrows the chips", async ({ page }) => {
    await stubConvex(page);
    await seedStarterPack(page);
    await page.goto("/study/quizzes");
    await expectHydrated(page);

    // Tags come before the lists and rules they narrow. Choosing them first is
    // what stops the pickers below offering something the next step would then
    // silently take away.
    await expect(page.getByText("1 · What to quiz on")).toBeVisible();
    await expect(page.getByText("2 · Tags (optional)")).toBeVisible();
    await expect(page.getByText("3 · Rules")).toBeVisible();

    // The chips are the union of the two tag registries, so the list tags only
    // appear once words or phrases are in scope — a tag that can filter nothing
    // is not offered. Switching them on also makes the search worth testing:
    // eight chips rather than the five the rule registry alone carries.
    await page.getByRole("button", { name: "Words", exact: true }).click();
    await page.getByRole("button", { name: "Phrases", exact: true }).click();

    const search = page.getByLabel("Search tags");
    await expect(tagChip(page, "#conversation")).toBeVisible();
    await expect(tagChip(page, "#particles")).toBeVisible();

    // Substring, not prefix, and case-insensitive: "JLPT" has to find "#jlpt".
    await search.fill("JLPT");
    await expect(tagChip(page, "#jlpt")).toBeVisible();
    await expect(tagChip(page, "#conversation")).toHaveCount(0);
    await expect(page.getByText(/No tags match/)).toHaveCount(0);

    // A query that matches nothing says so rather than showing an empty box.
    await search.fill("zzz");
    await expect(page.getByText("No tags match “zzz”.")).toBeVisible();

    // Clearing the query brings the whole registry back.
    await search.fill("");
    await expect(tagChip(page, "#conversation")).toBeVisible();
    await expect(tagChip(page, "#particles")).toBeVisible();

    // An active tag stays on screen even when it does not match the query —
    // otherwise selecting #n5 and then searching "part" leaves it filtering the
    // quiz with nothing on screen to click to turn it off.
    await tagChip(page, "#n5").click();
    await search.fill("part");
    await expect(tagChip(page, "#particles")).toBeVisible();
    await expect(tagChip(page, "#n5")).toHaveAttribute("data-tag-mode", "include");
    await expect(tagChip(page, "#conversation")).toHaveCount(0);
  });

  test("clicking a tag cycles include, exclude, off", async ({ page }) => {
    await stubConvex(page);
    await seedStarterPack(page);
    await page.goto("/study/quizzes");
    await expectHydrated(page);

    const jlpt = tagChip(page, "#jlpt");
    await expect(jlpt).toHaveAttribute("data-tag-mode", "off");
    await expect(page.getByText(/Click a tag to include it/)).toBeVisible();

    await jlpt.click();
    await expect(jlpt).toHaveAttribute("data-tag-mode", "include");
    await expect(page.getByText(/1 included · 0 excluded/)).toBeVisible();

    await jlpt.click();
    await expect(jlpt).toHaveAttribute("data-tag-mode", "exclude");
    await expect(page.getByText(/0 included · 1 excluded/)).toBeVisible();

    // Back to off — and the hint returns with it, rather than leaving a stale
    // "1 included" line above an unfiltered picker.
    await jlpt.click();
    await expect(jlpt).toHaveAttribute("data-tag-mode", "off");
    await expect(page.getByText(/Click a tag to include it/)).toBeVisible();
  });

  test("a tag hides the rules that do not carry it, in both directions", async ({ page }) => {
    await stubConvex(page);
    await seedStarterPack(page);
    await page.goto("/study/quizzes");
    await expectHydrated(page);

    const ruleChips = page.locator("[data-slot='quiz-rule']");
    // The three seeded rules: verbs+jlpt, particles+jlpt, adjectives+jlpt+n5.
    await expect(ruleChips).toHaveCount(3);

    // Including narrows to a union — #particles is on exactly one of them.
    await tagChip(page, "#particles").click();
    await expect(ruleChips).toHaveCount(1);
    await expect(page.getByText(/Every rule is included \(1\)\./)).toBeVisible();

    await page.locator("[data-slot='quiz-tag-clear']").click();
    await expect(ruleChips).toHaveCount(3);

    // Excluding subtracts, and it applies even to a rule that matched an
    // include: every seeded rule carries #jlpt, so excluding it empties the
    // picker rather than leaving the three behind.
    await tagChip(page, "#jlpt").click(); // include
    await tagChip(page, "#jlpt").click(); // exclude
    await expect(ruleChips).toHaveCount(0);
    await expect(page.getByText("No rules match the selected tags.")).toBeVisible();
  });

  test("a tag hides the lists that do not carry it", async ({ page }) => {
    await stubConvex(page);
    await seedStarterPack(page);
    await page.goto("/study/quizzes");
    await expectHydrated(page);
    await page.getByRole("button", { name: "Words", exact: true }).click();
    await page.getByRole("button", { name: "Phrases", exact: true }).click();

    // Three seeded lists: JLPT N5 Starter (#jlpt #n5), Daily Conversation
    // (#daily #conversation), Everyday Phrases (#phrases).
    await expect(page.getByRole("button", { name: /JLPT N5 Starter/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Daily Conversation/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Everyday Phrases/ })).toBeVisible();

    await tagChip(page, "#phrases").click();
    await expect(page.getByRole("button", { name: /Everyday Phrases/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Daily Conversation/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /JLPT N5 Starter/ })).toHaveCount(0);

    // Exclusion alone is a working filter: "everything except #daily" leaves
    // the two lists that do not carry it, which is the case the old code could
    // not express at all — with no include tags it filtered nothing.
    await page.locator("[data-slot='quiz-tag-clear']").click();
    await tagChip(page, "#daily").click();
    await tagChip(page, "#daily").click();
    await expect(page.getByRole("button", { name: /Daily Conversation/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /JLPT N5 Starter/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Everyday Phrases/ })).toBeVisible();
  });

  test("hands both tag directions to the session", async ({ page }) => {
    await stubConvex(page);
    const getRequest = await stubGeneration(page, [sampleQuestions()[0]]);
    await seedStarterPack(page);
    await page.goto("/study/quizzes");
    await expectHydrated(page);

    await tagChip(page, "#particles").click(); // include
    await tagChip(page, "#n5").click(); // include
    await tagChip(page, "#n5").click(); // exclude

    await page.getByRole("button", { name: "Generate quiz" }).click();

    // The URL carries both, so a reload or a bookmark reproduces the filter.
    await expect(page).toHaveURL(/excludedTags=n5/);
    expect(new URL(page.url()).searchParams.get("tags")).toBe("particles");

    // And they survive the round trip into the generate call. Dropping them
    // here is what used to count rules with the tag filter and then draw them
    // without it.
    await expect
      .poll(() => getRequest())
      .toMatchObject({ config: { tags: ["particles"], excludedTags: ["n5"] } });
  });
});

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

test.describe("quiz session", () => {
  // Rules live in D1 and are owner-scoped: a fresh browser owns nothing until
  // it opts into the starter pack, and the session loader would otherwise find
  // "0 rules". Opting in also mints the `jv_device` cookie this browser keeps
  // for the rest of the test.
  test.beforeEach(async ({ page }) => {
    await seedStarterPack(page);
  });

  test("asks the API for the configured quiz and runs the questions", async ({ page }) => {
    await stubConvex(page);
    const getRequest = await stubGeneration(page);

    await page.goto(
      "/study/quizzes/session?sources=rules&count=3&difficulty=hard&distribution=random" +
        "&types=multiple-choice,fill-blanks,input&seconds=45"
    );
    await expectHydrated(page);

    // The first question renders once generation resolves.
    await expect(page.getByText("What does 学生 mean?")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Question 1 of 3")).toBeVisible();

    // The posted config must reflect the query string.
    const body = getRequest() as {
      config: {
        sources: string[];
        questionCount: number;
        difficulty: string;
        timeLimitSeconds: number;
        types: string[];
      };
    };
    expect(body.config.sources).toEqual(["rules"]);
    expect(body.config.questionCount).toBe(3);
    expect(body.config.difficulty).toBe("hard");
    expect(body.config.timeLimitSeconds).toBe(45);
    expect(body.config.types).toEqual(["multiple-choice", "fill-blanks", "input"]);

    // Answering the multiple-choice question correctly shows the feedback card.
    await page.getByRole("button", { name: "student" }).click();
    await expect(page.getByText("Correct!")).toBeVisible();
    await expect(page.getByText("学生 (がくせい) means student.")).toBeVisible();

    await page.getByRole("button", { name: "Next question →" }).click();

    // Question 2 is the fill-in-the-blanks one: an unordered bank of particles.
    await expect(page.getByText("Question 2 of 3")).toBeVisible();
    await expect(page.getByText("Fill in the missing particle.")).toBeVisible();
    await page.getByRole("button", { name: "は", exact: true }).click();
    await expect(page.getByText("Correct!")).toBeVisible();

    await page.getByRole("button", { name: "Next question →" }).click();

    // Question 3 is free text, with a romaji alternative accepted.
    await expect(page.getByText("Question 3 of 3")).toBeVisible();
    const input = page.getByPlaceholder("Type your answer — kana or romaji");
    await input.fill("gakusei");
    await page.getByRole("button", { name: "Check answer" }).click();
    await expect(page.getByText("Correct!")).toBeVisible();

    // The last question leads to the results.
    await page.getByRole("button", { name: "See results" }).click();
    await expect(page.getByText("Quiz complete!")).toBeVisible();
    await expect(page.getByText("3 of 3 correct (100%)")).toBeVisible();
  });

  test("runs a quiz that mixes words, phrases and rules", async ({ page }) => {
    await stubConvex(page);
    const getRequest = await stubGeneration(page);

    await page.goto("/study/quizzes/session?sources=words,phrases,rules&count=3");
    await expectHydrated(page);

    // A multi-source quiz is titled "Mixed" and says how much is in scope.
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Mixed");
    await expect(page.getByText(/\d+ items? in scope/)).toBeVisible();

    await expect(page.getByText("What does 学生 mean?")).toBeVisible({ timeout: 15_000 });

    const body = getRequest() as { config: { sources: string[] } };
    expect(body.config.sources).toEqual(["words", "phrases", "rules"]);
  });

  test("a wrong answer shows the correct one", async ({ page }) => {
    await stubConvex(page);
    await stubGeneration(page, [sampleQuestions()[0]]);

    await page.goto("/study/quizzes/session?sources=rules&count=1&types=multiple-choice");
    await expectHydrated(page);

    await expect(page.getByText("What does 学生 mean?")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "teacher" }).click();

    await expect(page.getByText("Not quite")).toBeVisible();
    await expect(page.getByText("Correct answer:")).toBeVisible();
    await expect(page.getByText("· you said “teacher”")).toBeVisible();
  });

  test("shows the kana above the kanji, and the toggle hides them", async ({ page }) => {
    await stubConvex(page);
    await stubGeneration(page, furiganaQuestions());

    await page.goto("/study/quizzes/session?sources=words,rules&count=3&types=multiple-choice,fill-blanks,input");
    await expectHydrated(page);

    // The reading is in an `rt` above the kanji, not inline in the sentence.
    // Asserting on the element rather than the paragraph text is the point:
    // `textContent` of `<ruby>学生<rt>がくせい</rt></ruby>` is "学生がくせい", so
    // a `getByText` on the whole prompt could not tell the two apart.
    await expect(page.locator("rt").first()).toHaveText("がくせい", { timeout: 15_000 });

    const toggle = page.getByRole("button", { name: /Furigana/ });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    await toggle.click();

    // Off: no ruby anywhere, and the prompt is now plain, readable Japanese —
    // which is what makes this exact `getByText` succeed where it could not above.
    await expect(page.locator("rt")).toHaveCount(0);
    await expect(page.getByText("Which of these means 学生?", { exact: true })).toBeVisible();

    // The choice is remembered across a reload, not just for this question.
    // Waiting on `aria-pressed` — which only renders once the question panel is
    // back — is what makes this a check of the persisted preference: `rt` is
    // already zero during the loading panel, so counting it would prove nothing.
    await page.reload();
    await expectHydrated(page);
    await expect(toggle).toHaveAttribute("aria-pressed", "false", { timeout: 15_000 });
    await expect(page.locator("rt")).toHaveCount(0);
  });

  test("grades a plain answer against an annotated one", async ({ page }) => {
    await stubConvex(page);
    await stubGeneration(page, furiganaQuestions());

    await page.goto("/study/quizzes/session?sources=words,rules&count=3&types=multiple-choice,fill-blanks,input");
    await expectHydrated(page);

    // The correct option is itself annotated. Clicking it must be accepted —
    // the comparison strips the reading off both sides rather than trusting
    // that the option and the answer are written identically.
    await expect(page.locator("rt").first()).toHaveText("がくせい", { timeout: 15_000 });
    await page.locator("button", { hasText: "学生" }).first().click();
    await expect(page.getByText("Correct!")).toBeVisible();

    await page.getByRole("button", { name: "Next question →" }).click();
    await page.getByRole("button", { name: "は", exact: true }).click();
    await expect(page.getByText("Correct!")).toBeVisible();

    await page.getByRole("button", { name: "Next question →" }).click();

    // The answer to this one is `学生《がくせい》` and the plain `学生` is NOT
    // among its alternatives, so this passes only if the annotation is stripped
    // before the comparison. Without that, every kanji answer would be marked
    // wrong while the question looked perfectly correct on screen.
    const input = page.getByPlaceholder("Type your answer — kana or romaji");
    await input.fill("学生");
    await page.getByRole("button", { name: "Check answer" }).click();
    await expect(page.getByText("Correct!")).toBeVisible();

    await page.getByRole("button", { name: "See results" }).click();
    await expect(page.getByText("3 of 3 correct (100%)")).toBeVisible();
  });

  test("omitting seconds means the quiz is untimed", async ({ page }) => {
    await stubConvex(page);
    const getRequest = await stubGeneration(page, [sampleQuestions()[0]]);

    await page.goto("/study/quizzes/session?sources=rules&count=1&types=multiple-choice");
    await expectHydrated(page);

    await expect(page.getByText("What does 学生 mean?")).toBeVisible({ timeout: 15_000 });
    // No countdown badge and no timer row when the limit is off.
    await expect(page.getByText(/\d+s$/)).toHaveCount(0);

    // The wire format keeps the seconds field numeric at all times; whether a
    // timer runs is carried separately by `timeLimitEnabled`.
    const body = getRequest() as { config: { timeLimitEnabled: boolean } };
    expect(body.config.timeLimitEnabled).toBe(false);
  });

  test("the countdown auto-submits when it runs out", async ({ page }) => {
    await stubConvex(page);
    await stubGeneration(page, [sampleQuestions()[2]]);

    // The shortest limit the builder offers is 15s; use 5s here so the test
    // doesn't wait a quarter of a minute for the timer to expire.
    await page.goto("/study/quizzes/session?sources=rules&count=1&types=input&seconds=5");
    await expectHydrated(page);

    await expect(page.getByText("How is 学生 read?")).toBeVisible({ timeout: 15_000 });
    // The badge counts down from the limit. Anchored exactly, because the page
    // subtitle also contains "5s each".
    await expect(page.getByText("5s", { exact: true })).toBeVisible();

    // Never answer — the timer should submit for us and mark it wrong.
    await expect(page.getByText("Time ran out")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Correct answer:")).toBeVisible();
  });

  test("reports a skipped model when Gemini is rate limited", async ({ page }) => {
    await stubConvex(page);
    // This mirrors what the server returns when a Gemini 429 short-circuits the
    // chain: the remaining Gemini models are marked as skipped, and GLM answers.
    await stubGeneration(page, sampleQuestions(), {
      model: "glm-4.7-flash",
      attempts: [
        {
          model: "gemini-3.8-flash",
          provider: "gemini",
          outcome: "ratelimit",
          detail: "429 RESOURCE_EXHAUSTED",
          ms: 400,
        },
        { model: "gemini-3.7-flash", provider: "gemini", outcome: "error", detail: "skipped", ms: 0 },
        { model: "gemini-3.6-flash", provider: "gemini", outcome: "error", detail: "skipped", ms: 0 },
        { model: "glm-4.7-flash", provider: "glm", outcome: "ok", ms: 1200 },
      ],
    });

    await page.goto("/study/quizzes/session?sources=rules&count=3&types=multiple-choice");
    await expectHydrated(page);

    // The model that actually answered is named in the header.
    await expect(page.getByText("glm-4.7-flash")).toBeVisible({ timeout: 15_000 });
  });

  test("surfaces a friendly error when generation fails", async ({ page }) => {
    await stubConvex(page);
    await stubGenerationFailure(page, "Every model in the fallback chain failed.", [
      { model: "gemini-3.8-flash", provider: "gemini", outcome: "error", ms: 500 },
    ]);

    await page.goto("/study/quizzes/session?sources=rules&count=1&types=multiple-choice");
    await expectHydrated(page);

    await expect(page.getByText("The quiz could not be generated")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/Every model in the fallback chain failed/)).toBeVisible();
  });

  test("surfaces the real server's refusal when generation is not allowed", async ({ page }) => {
    await stubConvex(page);
    // Deliberately NOT stubbing /api/quiz/generate — this is the only spec that
    // talks to the real route, so it covers two things a stub never can: the
    // route's account gate, and the client's JSON-error branch against a real
    // response. Convex is stubbed, so this browser is signed out and the route
    // must refuse. It refuses *before* generating, so no provider is called.
    await page.goto("/study/quizzes/session?sources=rules&count=1&types=multiple-choice");
    await expectHydrated(page);

    await expect(page.getByText("The quiz could not be generated")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/Please sign in to generate a quiz/)).toBeVisible();
  });

  test("refuses to generate when nothing matches the selection", async ({ page }) => {
    await stubConvex(page);
    // 422 is what the API returns when the selection resolves to no items.
    await page.route("**/api/quiz/generate", async (route: Route) => {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          error: "No rules matched this selection — add some content or widen the filters.",
        }),
      });
    });

    await page.goto("/study/quizzes/session?sources=rules&count=5&types=multiple-choice");
    await expectHydrated(page);

    await expect(page.getByText("The quiz could not be generated")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/No rules matched this selection/)).toBeVisible();
  });

  test("only scopes a quiz to starred items when the quiz asks for it", async ({ page }) => {
    await stubConvex(page);
    const getRequest = await stubGeneration(page, [sampleQuestions()[0]]);

    // A real, seeded word's id. A scope that matches nothing never reaches
    // generation at all, so the positive case needs an id that names a row.
    const wordId = await wordIdByTitle(page, "食べる");

    // Starred ids are present but `starred=1` is not. This is the reported bug:
    // merely *having* stars used to narrow every quiz with no way to opt out.
    await page.goto(
      `/study/quizzes/session?sources=words&count=1&types=multiple-choice&starredIds=${wordId}`
    );
    await expectHydrated(page);
    await expect(page.getByText("What does 学生 mean?")).toBeVisible({ timeout: 15_000 });

    let body = getRequest() as { config: { starredOnly: boolean } };
    expect(body.config.starredOnly).toBe(false);

    // …and with the flag, the same ids do scope it.
    await page.goto(
      `/study/quizzes/session?sources=words&count=1&types=multiple-choice&starredIds=${wordId}&starred=1`
    );
    await expectHydrated(page);
    await expect(page.getByText("What does 学生 mean?")).toBeVisible({ timeout: 15_000 });

    body = getRequest() as { config: { starredOnly: boolean } };
    expect(body.config.starredOnly).toBe(true);
  });

  test("reads the streamed generation response", async ({ page }) => {
    await stubConvex(page);
    // The real route streams newline-delimited JSON so the loading panel can
    // name the model actually in flight. Fulfilling it as one NDJSON body still
    // exercises the parser: a client that only understood a buffered JSON body
    // would never see the result, and the wait below would time out.
    await page.route("**/api/quiz/generate", async (route: Route) => {
      // Mirrors a real walk that needed both passes: Gemini 3.8 timed out, the
      // last row answered with output the parser could not read, and only then
      // did the chain restart and Gemini 3.6 answer. Covering the `round` event
      // and the unusable-output outcome here is deliberate — neither has any
      // other spec, and a client that choked on an unknown event would fail the
      // wait below rather than silently losing the quiz.
      const events = [
        { type: "attempt", model: "gemini-3.8-flash", index: 1, total: 9 },
        {
          type: "attemptDone",
          attempt: {
            model: "gemini-3.8-flash",
            provider: "gemini",
            outcome: "timeout",
            detail: "503 UNAVAILABLE",
            ms: 300,
          },
        },
        { type: "attempt", model: "inclusionai/ling-3.0-flash-vl:free", index: 8, total: 9 },
        {
          type: "attemptDone",
          attempt: {
            model: "inclusionai/ling-3.0-flash-vl:free",
            provider: "openrouter",
            outcome: "error",
            detail: "answered with output we could not use",
            ms: 900,
          },
        },
        { type: "round", round: 2, totalRounds: 2, detail: "no model answered on the first pass" },
        { type: "attempt", model: "gemini-3.6-flash", index: 3, total: 9 },
        {
          type: "result",
          questions: sampleQuestions(),
          model: "gemini-3.6-flash",
          attempts: [
            {
              model: "gemini-3.8-flash",
              provider: "gemini",
              outcome: "timeout",
              detail: "503 UNAVAILABLE",
              ms: 300,
            },
            {
              model: "inclusionai/ling-3.0-flash-vl:free",
              provider: "openrouter",
              outcome: "error",
              detail: "answered with output we could not use",
              ms: 900,
            },
            { model: "gemini-3.6-flash", provider: "gemini", outcome: "ok", ms: 900 },
          ],
        },
      ];
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: events.map((event) => `${JSON.stringify(event)}\n`).join(""),
      });
    });

    await page.goto("/study/quizzes/session?sources=rules&count=3&types=multiple-choice");
    await expectHydrated(page);

    await expect(page.getByText("What does 学生 mean?")).toBeVisible({ timeout: 15_000 });
    // The model badge comes from the stream's result event — Gemini 3.6, not
    // the 3.8 the walk started on.
    await expect(page.getByText("gemini-3.6-flash")).toBeVisible();
  });
});
