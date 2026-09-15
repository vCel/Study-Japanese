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

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

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
      const events = [
        { type: "attempt", model: "gemini-3.8-flash", index: 0, total: 5 },
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
        { type: "attempt", model: "gemini-3.6-flash", index: 2, total: 5 },
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
