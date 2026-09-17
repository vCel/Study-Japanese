import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

import { expectHydrated, seedStarterPack, stubConvex, wordIdByTitle } from "./helpers";

/** One tinted panel inside the merged "What to ask about" step. */
function facetPanel(page: Page, source: "words" | "lists") {
  return page.locator(`[data-slot="quiz-facet-panel"][data-source="${source}"]`);
}

/**
 * The named computed properties of an element, for comparing two elements that
 * are meant to be styled alike. Comparing against the other element rather than
 * against literals is what makes the check unable to drift from the treatment it
 * pins.
 */
function styleOf(target: Locator, keys: string[]) {
  return target.evaluate((el, names) => {
    const computed = getComputedStyle(el);
    return Object.fromEntries(names.map((name) => [name, computed.getPropertyValue(name)]));
  }, keys);
}

/**
 * The Quizzes builder (/study/quizzes) and the session page
 * (/study/quizzes/session).
 *
 * Unlike the flashcards builder there are no tabs: words, phrases and rules are
 * togglable buttons, so a single quiz can draw on any combination of them. The
 * panel below shows only the steps that apply to what is switched on — except
 * inside "What to ask about", where a facet panel whose source is off stays on
 * screen and greys out instead.
 *
 * The generation endpoint is always stubbed: the real thing calls out to Gemini,
 * Comet, Groq and the aggregators, which would make these specs slow,
 * non-deterministic, and would spend the account's quota. What is under test
 * here is the UI and the client's handling of the response — the providers
 * themselves are not.
 *
 * Convex is stubbed too (see `stubConvex`): the builder renders inside
 * `ConvexClientProvider`, so if the convex.cloud websocket never opens, React
 * hydration silently stalls and *every* assertion on the page fails. Stubbing
 * keeps the suite off the network.
 */

interface StubQuestion {
  type: string;
  prompt: string;
  /**
   * The typing shape. Derived server-side by `quiz-parse.ts` rather than
   * declared by the model, so a stub that omits it is not the shape a live
   * generation returns — and the runner reads it to decide whether a prompt
   * may show its readings.
   */
  form?: "blank" | "transform" | "reading";
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
    // "Types of words" and "What to ask about" are one step now, sectioned the
    // same way. Words and rules are both on, so both of its panels are live.
    await expect(
      page.getByText(/^\d+ · What to ask about — rules, words & phrases$/)
    ).toBeVisible();
    await expect(facetPanel(page, "words")).toHaveAttribute("data-disabled", "false");
    await expect(facetPanel(page, "lists")).toHaveAttribute("data-disabled", "false");
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

  test("the facet panels grey out with their own source", async ({ page }) => {
    await stubConvex(page);
    await page.goto("/study/quizzes");
    await expectHydrated(page);

    // Rules is the only source to begin with, so both panels are inert — but
    // they stay on screen. Greying rather than hiding is the point: an option
    // that vanishes when you untick a source is one you cannot discover.
    await expect(facetPanel(page, "words")).toBeVisible();
    await expect(facetPanel(page, "lists")).toBeVisible();
    await expect(facetPanel(page, "words")).toHaveAttribute("data-disabled", "true");
    await expect(facetPanel(page, "lists")).toHaveAttribute("data-disabled", "true");
    await expect(facetPanel(page, "words").getByRole("button", { name: "Nouns" })).toBeDisabled();

    // Words on: both panels come alive, because the facets the second one sets
    // apply to words as much as to phrases.
    await page.getByRole("button", { name: "Words", exact: true }).click();
    await expect(facetPanel(page, "words")).toHaveAttribute("data-disabled", "false");
    await expect(facetPanel(page, "lists")).toHaveAttribute("data-disabled", "false");
    await expect(facetPanel(page, "words").getByRole("button", { name: "Nouns" })).toBeEnabled();

    // Down to phrases alone: the two panels part ways. "What to ask about" still
    // applies, "Types of words" does not — which is the independence the two
    // panels exist to express.
    await page.getByRole("button", { name: "Phrases", exact: true }).click();
    await page.getByRole("button", { name: "Rules", exact: true }).click();
    await page.getByRole("button", { name: "Words", exact: true }).click();
    await expect(facetPanel(page, "words")).toHaveAttribute("data-disabled", "true");
    await expect(facetPanel(page, "lists")).toHaveAttribute("data-disabled", "false");
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

  test("the question count is a slider above difficulty, and types are pills", async ({ page }) => {
    await stubConvex(page);
    await page.goto("/study/quizzes");
    await expectHydrated(page);

    // The count is a slider over the builder's ladder (5…30 in fives), starting
    // on 10 — the second rung. `aria-valuetext` carries the unit, so assistive
    // tech announces "10 questions" rather than a bare index.
    const count = page.getByRole("slider", { name: "Number of questions" });
    await expect(count).toBeVisible();
    await expect(count).toHaveAttribute("aria-valuemin", "0");
    await expect(count).toHaveAttribute("aria-valuemax", "5");
    await expect(count).toHaveAttribute("aria-valuenow", "1");
    await expect(count).toHaveAttribute("aria-valuetext", "10 questions");

    // Arrow keys step it — the accessible way to drive it. The thumb is
    // re-created on each commit, so re-query rather than reuse the handle.
    await count.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("slider", { name: "Number of questions" })).toHaveAttribute(
      "aria-valuetext",
      "15 questions"
    );

    // …and it sits directly above difficulty, which is the pair it belongs
    // with: how many questions, and how hard they are.
    const countBox = await page.getByRole("slider", { name: "Number of questions" }).boundingBox();
    const difficultyBox = await page.getByRole("slider", { name: "Difficulty" }).boundingBox();
    expect(countBox, "count slider").not.toBeNull();
    expect(difficultyBox, "difficulty slider").not.toBeNull();
    expect(countBox!.y).toBeLessThan(difficultyBox!.y);

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

  test("the mode select trades the per-question limit for a whole-run budget", async ({ page }) => {
    await stubConvex(page);
    await stubGeneration(page, [sampleQuestions()[0]]);
    await seedStarterPack(page);
    await page.goto("/study/quizzes");
    await expectHydrated(page);

    // Quiz by default, so the per-question rows are the ones on screen.
    const quiz = page.getByRole("radio", { name: "Quiz" });
    const exam = page.getByRole("radio", { name: "Exam" });
    await expect(quiz).toHaveAttribute("aria-checked", "true");
    await expect(exam).toHaveAttribute("aria-checked", "false");
    await expect(page.getByText("Seconds per question")).toBeVisible();
    await expect(page.getByRole("slider", { name: "Exam time limit" })).toHaveCount(0);

    await exam.click();

    // The per-question limit is not greyed out but gone: a run with one budget
    // for all of its questions has no per-question limit left to set. What
    // remains is the same slider under its exam name.
    await expect(exam).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText("Seconds per question")).toHaveCount(0);
    await expect(page.getByRole("switch", { name: "Time limit per question" })).toHaveCount(0);
    const limit = page.getByRole("slider", { name: "Exam time limit" });
    await expect(limit).toHaveAttribute("aria-valuemin", "0");
    await expect(limit).toHaveAttribute("aria-valuemax", "14");
    await expect(limit).toHaveAttribute("aria-valuetext", "20 minutes");
    // Anchored, because the summary line also carries the budget — as
    // "20 min exam", which is a different string.
    await expect(page.getByText("20 min", { exact: true })).toBeVisible();

    // Arrow keys move focus and selection together, which is what the
    // radiogroup role promises. Back to Quiz and the per-question rows return.
    await exam.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("radio", { name: "Quiz" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await expect(page.getByText("Seconds per question")).toBeVisible();

    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: "Exam" })).toHaveAttribute("aria-checked", "true");

    // Arrow keys step it — the accessible way to drive it. Two minutes at a
    // time, which is the interval the ladder is measured in.
    await limit.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("slider", { name: "Exam time limit" })).toHaveAttribute(
      "aria-valuetext",
      "22 minutes"
    );

    await page.getByRole("button", { name: "Generate quiz" }).click();

    // The whole run's budget, in the unit the runner counts in.
    await expect(page).toHaveURL(/examSeconds=1320/);
  });

  test("the mode select is one control, styled like the question pills", async ({ page }) => {
    await stubConvex(page);
    await page.goto("/study/quizzes");
    await expectHydrated(page);

    // The question element the mode control is meant to match is the question-type
    // pill. "Multiple choice" starts picked, "True or false" does not, so both
    // halves of the treatment have a reference on screen.
    const pillOn = page.getByRole("button", { name: "Multiple choice" });
    const pillOff = page.getByRole("button", { name: "True or false" });
    const itemOn = page.getByRole("radio", { name: "Quiz" });
    const itemOff = page.getByRole("radio", { name: "Exam" });

    // Spacing and type are the pill's, so a mode occupies its row the same way a
    // question type does.
    const SHAPE = [
      "padding-top",
      "padding-right",
      "padding-bottom",
      "padding-left",
      "font-size",
      "font-weight",
      "border-radius",
    ];
    expect(await styleOf(itemOff, SHAPE)).toEqual(await styleOf(pillOff, SHAPE));

    // The picked state is the pill's too — the same tint behind the same blue text.
    const STATE = ["background-color", "color"];
    expect(await styleOf(itemOn, STATE)).toEqual(await styleOf(pillOn, STATE));

    const group = page.getByRole("radiogroup", { name: "Mode" });

    // The pill's border is not repeated on the item: it moves up to the control.
    // Two rounded-full outlines two pixels apart read as a ring nested inside a
    // ring, which is the separate-elements look this control exists to avoid.
    expect((await styleOf(itemOff, ["border-top-width"]))["border-top-width"]).toBe("0px");
    expect(await styleOf(group, ["border-top-width", "border-top-color", "border-radius"])).toEqual(
      await styleOf(pillOff, ["border-top-width", "border-top-color", "border-radius"])
    );

    // One border, and it wraps both options. That is the whole difference between
    // one control and two adjacent pills.
    const [groupBox, onBox, offBox, pillBox] = await Promise.all([
      group.boundingBox(),
      itemOn.boundingBox(),
      itemOff.boundingBox(),
      pillOff.boundingBox(),
    ]);
    expect(groupBox && onBox && offBox && pillBox, "mode control geometry").toBeTruthy();
    expect(groupBox!.x).toBeLessThan(onBox!.x);
    expect(groupBox!.x + groupBox!.width).toBeGreaterThan(offBox!.x + offBox!.width);

    // Flush inside it: the second option starts where the first ends, rather than
    // a gap away.
    expect(Math.abs(offBox!.x - (onBox!.x + onBox!.width))).toBeLessThanOrEqual(1);

    // Taller than a lone pill by its own border and padding, and nothing else, so
    // it stays in scale with the pills sharing the card.
    expect(groupBox!.height - pillBox!.height).toBeLessThanOrEqual(6);
  });

  test("the question split is the same control as the mode select", async ({ page }) => {
    await stubConvex(page);
    await page.goto("/study/quizzes");
    await expectHydrated(page);

    const mode = page.getByRole("radiogroup", { name: "Mode" });
    const split = page.getByRole("radiogroup", { name: "Question split" });

    // The shell: one control's border, radius and inset are the other's.
    const SHELL = [
      "border-top-width",
      "border-top-color",
      "border-radius",
      "padding-top",
      "padding-left",
    ];
    expect(await styleOf(split, SHELL)).toEqual(await styleOf(mode, SHELL));

    // The options: an unpicked one from each control.
    const ITEM = [
      "padding-top",
      "padding-right",
      "padding-bottom",
      "padding-left",
      "font-size",
      "font-weight",
      "border-radius",
    ];
    expect(await styleOf(page.getByRole("radio", { name: "Mix freely" }), ITEM)).toEqual(
      await styleOf(page.getByRole("radio", { name: "Exam" }), ITEM)
    );

    // And the picked state reads the same in both.
    const PICKED = ["background-color", "color"];
    expect(await styleOf(page.getByRole("radio", { name: "Even split" }), PICKED)).toEqual(
      await styleOf(page.getByRole("radio", { name: "Quiz" }), PICKED)
    );

    // Flush, so each reads as one control rather than as two options side by side.
    for (const [name, group] of [
      ["mode", mode],
      ["split", split],
    ] as const) {
      const [first, second] = await Promise.all([
        group.getByRole("radio").first().boundingBox(),
        group.getByRole("radio").last().boundingBox(),
      ]);
      expect(first && second, `${name} control geometry`).toBeTruthy();
      expect(Math.abs(second!.x - (first!.x + first!.width))).toBeLessThanOrEqual(1);
    }
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

  test("the question split greys out until there is something to divide", async ({ page }) => {
    await stubConvex(page);
    await page.goto("/study/quizzes");
    await expectHydrated(page);

    const split = page.locator("[data-slot='quiz-split']");

    // It lives in the Options card now, not underneath the pills it splits, and
    // two question types are on by default — so it starts live.
    await expect(
      page.locator("[data-slot='quiz-options']").getByText("Question split")
    ).toBeVisible();
    await expect(split).toHaveAttribute("data-disabled", "false");
    await expect(page.getByRole("radio", { name: "Even split" })).toHaveAttribute(
      "aria-checked",
      "true"
    );

    await page.getByRole("radio", { name: "Mix freely" }).click();
    await expect(page.getByRole("radio", { name: "Mix freely" })).toHaveAttribute(
      "aria-checked",
      "true"
    );

    // Down to one type with rules alone, neither axis has anything to divide —
    // so the row stays put and greys out rather than disappearing.
    await page.getByRole("button", { name: "Fill in the blanks" }).click();
    await expect(split).toBeVisible();
    await expect(split).toHaveAttribute("data-disabled", "true");
    await expect(page.getByRole("radio", { name: "Even split" })).toBeDisabled();

    // Switching words and phrases on brings the second axis back: still a single
    // question type, but now there are two kinds of list material to separate.
    await page.getByRole("button", { name: "Words", exact: true }).click();
    await page.getByRole("button", { name: "Phrases", exact: true }).click();
    await expect(split).toHaveAttribute("data-disabled", "false");
    await expect(page.getByRole("radio", { name: "Even split" })).toBeEnabled();
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

  test("separates the word lists from the phrase lists", async ({ page }) => {
    await stubConvex(page);
    await seedStarterPack(page);
    await page.goto("/study/quizzes");
    await expectHydrated(page);
    // Both sources, so both kinds of list are on offer.
    await page.getByRole("button", { name: "Words", exact: true }).click();
    await page.getByRole("button", { name: "Phrases", exact: true }).click();

    // One group per kind, words first: the phrase list is no longer a card among
    // the word lists, which is what a mixed grid made it look like.
    const groups = page.locator("[data-slot='quiz-list-group']");
    await expect(groups).toHaveCount(2);
    await expect(groups.nth(0)).toHaveAttribute("data-kind", "words");
    await expect(groups.nth(1)).toHaveAttribute("data-kind", "phrases");

    // Seeded: JLPT N5 Starter and Daily Conversation hold words, Everyday
    // Phrases holds phrases — and each appears in exactly one group.
    await expect(groups.nth(0).getByRole("button", { name: /JLPT N5 Starter/ })).toBeVisible();
    await expect(groups.nth(0).getByRole("button", { name: /Daily Conversation/ })).toBeVisible();
    await expect(groups.nth(0).getByRole("button", { name: /Everyday Phrases/ })).toHaveCount(0);
    await expect(groups.nth(1).getByRole("button", { name: /Everyday Phrases/ })).toBeVisible();
    await expect(groups.nth(1).getByRole("button", { name: /JLPT N5 Starter/ })).toHaveCount(0);

    // The header is the umbrella once there are two groups to tell apart, and
    // the sub-headings name them.
    const lists = page.locator("section").filter({ has: page.locator("[data-slot='quiz-list-title']") });
    const title = page.locator("[data-slot='quiz-list-title']");
    await expect(title).toHaveText("Lists");
    await expect(lists.getByText("Word lists")).toBeVisible();
    await expect(lists.getByText("Phrase lists")).toBeVisible();

    // One kind alone has nothing to separate, so the header names it and the
    // sub-heading goes — rather than the two repeating each other.
    await page.getByRole("button", { name: "Phrases", exact: true }).click();
    await expect(groups).toHaveCount(1);
    await expect(groups.nth(0)).toHaveAttribute("data-kind", "words");
    await expect(title).toHaveText("Word lists");
    await expect(lists.getByText("Phrase lists")).toHaveCount(0);
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

  test("the rule picker shows each rule's points, and searches them", async ({ page }) => {
    await stubConvex(page);
    await seedStarterPack(page);
    await page.goto("/study/quizzes");
    await expectHydrated(page);

    const rows = page.locator("[data-slot='quiz-rule']");
    // One row per rule, and each carries its ポイント lines — the seeded rules
    // have one apiece, from the legacy `pattern` column.
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: "ポイント" })).toHaveCount(3);
    await expect(page.getByText("Verb stem + ます")).toBeVisible();

    // …and how much material sits behind it: each seeded rule has two examples,
    // which is what a question can actually be written from.
    await expect(rows.filter({ hasText: "2 examples" })).toHaveCount(3);

    // Every rule starts included (`ruleIds === null` is the "all" sentinel), so
    // the first click on a row *deselects* it — the whole row is the target,
    // there is no separate checkbox to hunt for.
    const polite = rows.filter({ hasText: "Polite ます-form" });
    await expect(polite).toHaveAttribute("aria-pressed", "true");
    await polite.click();
    await expect(polite).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByText(/2 of 3 rules selected\./)).toBeVisible();

    // Re-ticking everything collapses back to the sentinel, so rules added
    // later are picked up without revisiting this screen.
    await polite.click();
    await expect(polite).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(/Every rule is included \(3\)\./)).toBeVisible();

    const search = page.getByLabel("Search rules");

    // Title, case-insensitively.
    await search.fill("POLITE");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Polite ます-form");

    // …and a rule's *points*, which is the half a title search cannot reach:
    // "くない" appears in no title, only in the い-adjective rule's pattern.
    await search.fill("くない");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Adjective conjugation");

    // Searching narrows the list, never the quiz: the header keeps counting all
    // three, because a search that silently shrank the selection would be a
    // filter the user never asked for.
    await expect(page.getByText(/Every rule is included \(3\)\./)).toBeVisible();
    await expect(page.getByText(/searching only narrows this list/)).toBeVisible();

    // A query that matches nothing says so rather than showing an empty box.
    await search.fill("zzz");
    await expect(rows).toHaveCount(0);
    await expect(page.getByText("No rules match “zzz”.")).toBeVisible();

    // Clearing it brings the whole list back, and the row keeps its tick — a
    // search is a way to find a rule, not a way to change the selection.
    await search.fill("");
    await expect(rows).toHaveCount(3);
    await expect(polite).toHaveAttribute("aria-pressed", "true");
  });

  test("the rules list scrolls once it outgrows its max height", async ({ page }) => {
    await stubConvex(page);
    await seedStarterPack(page);
    await page.goto("/study/quizzes");
    await expectHydrated(page);

    // The viewport that scrolls the rule rows — located by content, not by index,
    // so it survives another ScrollArea being added to this page.
    const viewport = page
      .locator("[data-slot='scroll-area-viewport']")
      .filter({ has: page.locator("[data-slot='quiz-rule']") });

    // The max-height has to live on the element that scrolls. On the wrapper it is
    // silently useless: the viewport's `h-full` resolves against an indefinite
    // height, so it grows to fit its content, and the wrapper's `overflow-hidden`
    // clips the rest — rules past the fold are unreachable, not scrollable.
    await expect(viewport).toHaveCSS("overflow-y", "auto");
    await expect(viewport).toHaveCSS("max-height", "280px");

    // The three seeded rules fit inside 280px, so force the overflow and prove the
    // container actually moves.
    const scrollTop = await viewport.evaluate((el) => {
      const list = el.querySelector("ul")!;
      for (let i = 0; i < 5; i++) {
        for (const row of Array.from(list.children)) {
          list.appendChild(row.cloneNode(true));
        }
      }
      el.scrollTop = 9999;
      return el.scrollTop;
    });
    expect(scrollTop).toBeGreaterThan(0);
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

    // Question 3 is free text, with a romaji alternative accepted. The answer
    // is bare kana, so this one also offers a kana bank — the romaji route has
    // to keep working regardless.
    await expect(page.getByText("Question 3 of 3")).toBeVisible();
    const input = page.locator('[data-slot="quiz-answer-input"]');
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
    const input = page.locator('[data-slot="quiz-answer-input"]');
    await input.fill("学生");
    await page.getByRole("button", { name: "Check answer" }).click();
    await expect(page.getByText("Correct!")).toBeVisible();

    await page.getByRole("button", { name: "See results" }).click();
    await expect(page.getByText("3 of 3 correct (100%)")).toBeVisible();
  });

  /**
   * The kana bank is a typing aid rather than a question type of its own: it
   * appears under a "Type the answer" question whose answer is Japanese, and
   * its tiles write into the same field the keyboard does.
   */
  test("offers a kana bank under a typing question and grades a tapped answer", async ({ page }) => {
    await stubConvex(page);
    await stubGeneration(page, [
      {
        type: "input",
        prompt: 'Type the Japanese for "student".',
        answer: "がくせい",
        acceptableAnswers: ["gakusei"],
        explanation: "学生《がくせい》 is read がくせい.",
        sourceId: 3,
        sourceKind: "word",
      },
    ]);

    await page.goto("/study/quizzes/session?sources=words&count=1&types=input");
    await expectHydrated(page);

    await expect(page.getByText("Kana bank")).toBeVisible({ timeout: 15_000 });
    const input = page.locator('[data-slot="quiz-answer-input"]');
    // One tile per kana of the reading, so each name is unambiguous.
    const tile = (kana: string) => page.getByRole("button", { name: kana, exact: true });

    await tile("が").click();
    await expect(input).toHaveValue("が");
    // A spent tile goes out of play rather than disappearing: the bank's shape
    // must not shift under the user's hand while they are using it.
    await expect(tile("が")).toBeDisabled();

    await tile("く").click();
    await tile("せ").click();
    await tile("い").click();
    await expect(input).toHaveValue("がくせい");

    // The backspace hands the last tile back. It is the only way to undo a
    // mis-tap from the bank, because tapping a tile never focuses the field.
    await page.getByRole("button", { name: "Delete the last kana" }).click();
    await expect(input).toHaveValue("がくせ");
    await expect(tile("い")).toBeEnabled();
    await tile("い").click();

    await page.getByRole("button", { name: "Check answer" }).click();
    await expect(page.getByText("Correct!")).toBeVisible();
  });

  test("offers no kana bank when the answer is not Japanese", async ({ page }) => {
    await stubConvex(page);
    await stubGeneration(page, [
      {
        type: "input",
        prompt: "What does 学生《がくせい》 mean?",
        answer: "student",
        explanation: "学生《がくせい》 means student.",
        sourceId: 3,
        sourceKind: "word",
      },
    ]);

    await page.goto("/study/quizzes/session?sources=words&count=1&types=input");
    await expectHydrated(page);

    const input = page.locator('[data-slot="quiz-answer-input"]');
    await expect(input).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Kana bank")).toHaveCount(0);
    // With nothing to tap, the field keeps its original promise.
    await expect(input).toHaveAttribute("placeholder", "Type your answer — kana or romaji");
  });

  test("offers no kana bank when the reading would be marked wrong", async ({ page }) => {
    await stubConvex(page);
    // The answer is annotated, but only the romaji is listed as an alternative
    // — so a bank spelling がくせい would hand the learner a wrong answer to a
    // question they had actually got right.
    await stubGeneration(page, [
      {
        type: "input",
        prompt: 'Type the Japanese for "student".',
        answer: "学生《がくせい》",
        acceptableAnswers: ["gakusei"],
        explanation: "学生《がくせい》 is read がくせい.",
        sourceId: 3,
        sourceKind: "word",
      },
    ]);

    await page.goto("/study/quizzes/session?sources=words&count=1&types=input");
    await expectHydrated(page);

    await expect(page.locator('[data-slot="quiz-answer-input"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Kana bank")).toHaveCount(0);
  });

  /**
   * A typing question is bounded by material the learner is handed, rather than
   * asking them to compose something. A gap puts the sentence on screen and
   * takes the missing word alone.
   */
  test("shows the gap sentence on a typing question and grades only the gap", async ({ page }) => {
    await stubConvex(page);
    await stubGeneration(page, [
      {
        type: "input",
        form: "blank",
        prompt: "Fill the gap. Type the missing word.",
        sentence: "駅《えき》まで___で行《い》きます。",
        answer: "電車《でんしゃ》",
        acceptableAnswers: ["でんしゃ", "densha"],
        explanation: "電車《でんしゃ》 is a train, and で marks the means of getting there.",
        sourceId: 3,
        sourceKind: "word",
      },
    ]);

    await page.goto("/study/quizzes/session?sources=words&count=1&types=input");
    await expectHydrated(page);

    const input = page.locator('[data-slot="quiz-answer-input"]');
    await expect(input).toBeVisible({ timeout: 15_000 });

    // The sentence IS the question here: without it the field would be asking
    // for a word with nothing to put it into.
    const sentence = page.locator('[data-slot="quiz-sentence"]');
    await expect(sentence).toContainText("駅");
    await expect(sentence).toContainText("で行");

    await input.fill("densha");
    await page.getByRole("button", { name: "Check answer" }).click();
    await expect(page.getByText("Correct!")).toBeVisible();
    // What was typed lands in the gap and nowhere else — the answer to this
    // question is the missing word, not the sentence around it.
    await expect(sentence).toContainText("densha");
  });

  /**
   * The other bounded shape: a sentence to rewrite with the rule under test.
   * The sentence it is given is what belongs on screen — showing the rewritten
   * form would be showing the answer.
   */
  test("grades a rewrite against the sentence it was given", async ({ page }) => {
    await stubConvex(page);
    await stubGeneration(page, [
      {
        type: "input",
        form: "transform",
        prompt: "Rewrite the sentence with 〜てある, so it says the ticket has been bought.",
        sentence: "チケットを買《か》いました。",
        answer: "チケットを買《か》ってあります。",
        acceptableAnswers: ["ちけっとをかってあります", "chiketto wo katte arimasu"],
        explanation: "〜てある describes the state something was left in on purpose.",
        sourceId: 2,
        sourceKind: "rule",
      },
    ]);

    await page.goto("/study/quizzes/session?sources=rules&count=1&types=input");
    await expectHydrated(page);

    const input = page.locator('[data-slot="quiz-answer-input"]');
    await expect(input).toBeVisible({ timeout: 15_000 });

    // Tolerant of the ruby the sentence carries: the reading renders inline in
    // `textContent`, so an exact string would fail on the annotation alone.
    const sentence = page.locator('[data-slot="quiz-sentence"]');
    await expect(sentence).toContainText(/チケットを買(?:か)?いました/);
    await expect(sentence).not.toContainText("買ってあります");

    // Typed in romaji, because the learner this quiz is written for cannot
    // write 買 — which is the whole reason `acceptableAnswers` carries it.
    await input.fill("chiketto wo katte arimasu");
    await page.getByRole("button", { name: "Check answer" }).click();
    await expect(page.getByText("Correct!")).toBeVisible();
  });

  /**
   * A question asking for a reading must not show one, and that has to beat the
   * quiz-wide toggle — which defaults to on, and which the learner may have
   * turned on deliberately.
   *
   * The prompt carries an annotation on an *unrelated* word, so the assertion
   * is discriminating: with the suppression removed, `rt` would render and the
   * count would be 1.
   */
  test("hides the readings on the question that is asking for one", async ({ page }) => {
    await stubConvex(page);
    await stubGeneration(page, [
      {
        type: "input",
        form: "reading",
        prompt: "Type the reading of 学生 in kana — the word as it is used in 学校《がっこう》.",
        answer: "がくせい",
        acceptableAnswers: ["gakusei"],
        explanation: "学生《がくせい》 is read がくせい.",
        sourceId: 3,
        sourceKind: "word",
      },
      {
        type: "multiple-choice",
        prompt: "What does 図書館《としょかん》 mean?",
        options: ["library", "hospital"],
        answer: "library",
        explanation: "図書館《としょかん》 is where you borrow books.",
        sourceId: 4,
        sourceKind: "word",
      },
    ]);

    await page.goto("/study/quizzes/session?sources=words&count=2&types=input,multiple-choice");
    await expectHydrated(page);

    const toggle = page.getByRole("button", { name: /Furigana/ });
    await expect(toggle).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });
    // The readings are on, and the prompt still shows none: 学生《がくせい》 here
    // would be the answer, written above the word it was asking about.
    await expect(page.locator("rt")).toHaveCount(0);

    await page.locator('[data-slot="quiz-answer-input"]').fill("がくせい");
    await page.getByRole("button", { name: "Check answer" }).click();
    await expect(page.getByText("Correct!")).toBeVisible();

    // Only the question loses them. The explanation shown afterwards is where
    // the readings earn their place, so it still carries them.
    await expect(page.locator("rt").first()).toHaveText("がくせい");

    await page.getByRole("button", { name: "Next question →" }).click();
    // And the next question, which is not asking for a reading, has them back.
    await expect(page.locator("rt").first()).toHaveText("としょかん");
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

  test("an exam withholds every verdict until the last question is in", async ({ page }) => {
    await stubConvex(page);
    const getRequest = await stubGeneration(page, sampleQuestions());

    // A `seconds` alongside `examSeconds` is the case worth pinning: the two are
    // alternatives, and the run's budget is what wins rather than a per-question
    // limit quietly running underneath it.
    await page.goto(
      "/study/quizzes/session?sources=rules&count=3" +
        "&types=multiple-choice,fill-blanks,input&seconds=45&examSeconds=600"
    );
    await expectHydrated(page);

    await expect(page.getByText("What does 学生 mean?")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-slot="exam-clock"]')).toHaveText(/10:00 left/);

    const body = getRequest() as { config: { mode: string; timeLimitEnabled: boolean } };
    expect(body.config.mode).toBe("exam");
    expect(body.config.timeLimitEnabled).toBe(false);

    // Answering moves straight on: no verdict, and no feedback card to sit on.
    await page.getByRole("button", { name: "student" }).click();
    await expect(page.getByText("Question 2 of 3")).toBeVisible();
    await expect(page.getByText("Correct!", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Next question →" })).toHaveCount(0);

    // Question 2, answered wrong on purpose. Still nothing said about it.
    await page.getByRole("button", { name: "が", exact: true }).click();
    await expect(page.getByText("Question 3 of 3")).toBeVisible();
    await expect(page.getByText("Not quite")).toHaveCount(0);

    // The typing question, answered right — and submitting it ends the run.
    await page.locator('[data-slot="quiz-answer-input"]').fill("がくせい");
    await page.getByRole("button", { name: "Submit answer" }).click();

    // Every verdict at once, in the order the questions were asked.
    await expect(page.getByText("Exam complete!")).toBeVisible();
    await expect(page.getByText("2 of 3 correct (67%)")).toBeVisible();

    const rows = page.locator('[data-slot="exam-review-row"]');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("What does 学生 mean?");
    await expect(rows.nth(1)).toContainText("Fill in the missing particle.");
    await expect(rows.nth(2)).toContainText("How is 学生 read?");

    // And the verdict on each, matched exactly so "Correct answer:" on the
    // wrong one is not mistaken for its badge.
    await expect(rows.nth(0).getByText("Correct", { exact: true })).toBeVisible();
    await expect(rows.nth(1).getByText("Incorrect", { exact: true })).toBeVisible();
    await expect(rows.nth(2).getByText("Correct", { exact: true })).toBeVisible();
    await expect(rows.nth(1)).toContainText("Correct answer: は");
    await expect(rows.nth(1)).toContainText("you said “が”");
  });

  test("answering a question does not restart the exam clock", async ({ page }) => {
    await stubConvex(page);
    await stubGeneration(page, sampleQuestions());

    // Ten minutes, so the budget cannot run out underneath the test.
    await page.goto(
      "/study/quizzes/session?sources=rules&count=3" +
        "&types=multiple-choice,fill-blanks,input&examSeconds=600"
    );
    await expectHydrated(page);

    const clock = page.locator('[data-slot="exam-clock"]');
    await expect(clock).toHaveText(/10:00 left/, { timeout: 15_000 });

    // Let the clock actually move before answering, so that "it is no longer at
    // 10:00" cannot be satisfied by a clock that never started.
    await expect.poll(() => clock.textContent(), { timeout: 15_000 }).not.toMatch(/10:00 left/);

    await page.getByRole("button", { name: "student" }).click();
    await expect(page.getByText("Question 2 of 3")).toBeVisible();

    // Still counting down from where it was: the budget is the run's, so an
    // answer neither pauses it nor hands back the time it has already spent.
    await expect(clock).not.toHaveText(/10:00 left/);
    await expect(clock).toHaveText(/9:\d\d left/);
  });

  test("the exam ends when its budget runs out, leaving the rest unanswered", async ({ page }) => {
    await stubConvex(page);
    await stubGeneration(page, sampleQuestions());

    // Five seconds rather than a builder-sized budget: the route accepts any
    // length, so the expiry path can be watched instead of waited out.
    await page.goto(
      "/study/quizzes/session?sources=rules&count=3" +
        "&types=multiple-choice,fill-blanks,input&examSeconds=5"
    );
    await expectHydrated(page);

    await expect(page.getByText("What does 学生 mean?")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-slot="exam-clock"]')).toHaveText(/0:0\d left/);
    // The header names the budget in the unit it was given in: the builder only
    // sends whole minutes, but the route accepts any length, and this is one.
    await expect(page.getByText("5s exam")).toBeVisible();

    // Never answer: the budget should end the run on its own.
    await expect(page.getByText("Exam complete!")).toBeVisible({ timeout: 20_000 });
    // The denominator is the questions asked, so a run cut short cannot score
    // 100% by never reaching the questions it did not answer.
    await expect(page.getByText("0 of 3 correct (0%)")).toBeVisible();
    await expect(page.getByText("3 not answered")).toBeVisible();

    const rows = page.locator('[data-slot="exam-review-row"]');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0).getByText("Not answered", { exact: true })).toBeVisible();
    await expect(rows.nth(2).getByText("Not answered", { exact: true })).toBeVisible();
  });

  test("reports a skipped model when Gemini is rate limited", async ({ page }) => {
    await stubConvex(page);
    // This mirrors what the server returns when a Gemini 429 short-circuits the
    // chain: the remaining Gemini models are marked as skipped, and the next
    // row — OpenRouter's Gemma — answers.
    await stubGeneration(page, sampleQuestions(), {
      model: "google/gemma-4-26b-a4b-it:free",
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
        { model: "google/gemma-4-26b-a4b-it:free", provider: "openrouter", outcome: "ok", ms: 1200 },
      ],
    });

    await page.goto("/study/quizzes/session?sources=rules&count=3&types=multiple-choice");
    await expectHydrated(page);

    // The model that actually answered is named in the header.
    await expect(page.getByText("google/gemma-4-26b-a4b-it:free")).toBeVisible({
      timeout: 15_000,
    });
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
        { type: "attempt", model: "gemini-3.8-flash", index: 4, total: 14 },
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
        {
          type: "attempt",
          model: "inclusionai/ling-3.0-flash-vl:free",
          index: 11,
          total: 14,
        },
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
        { type: "attempt", model: "gemini-3.6-flash", index: 6, total: 14 },
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
