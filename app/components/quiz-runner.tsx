import * as React from "react";
import { Link } from "react-router";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ExternalLink, Loader2, RotateCcw, Sparkles, Timer, X } from "lucide-react";

import type { GenerationAttempt, QuizQuestion, QuizSourceKind } from "~/lib/quiz-types";
import { QUIZ_SOURCE_KIND_LABELS, QUIZ_TYPE_LABELS } from "~/lib/quiz-types";
import { useQuizStats } from "~/lib/use-quiz-stats";
import { Button, buttonVariants } from "~/components/lightswind/button";
import { Badge } from "~/components/lightswind/badge";
import { Card, CardContent } from "~/components/lightswind/card";
import { Tooltip } from "~/components/lightswind/tooltip";
import { toast } from "~/components/lightswind/toast";
import { cn } from "~/lib/utils";

export interface QuizRunConfig {
  /** Which slices of the library this quiz draws on — one or more. */
  sources: QuizSourceKind[];
  questionCount: number;
  /** null = untimed. */
  timeLimitSeconds: number | null;
  types: string[];
  difficulty: string;
  distribution: string;
  focus: string;
  ruleKind: string | null;
  pos: string | null;
  listIds: number[];
  starredOnly: boolean;
  /** Drawn only from the items the user has answered wrong before. */
  retryMissed: boolean;
  /**
   * The ids to scope each kind to when retrying misses. Rule ids and word ids
   * are separate sequences, so they travel separately rather than as one list.
   */
  missedWordIds: number[];
  missedRuleIds: number[];
}

/** One answer as it was given, kept for the results review. */
interface Answer {
  question: QuizQuestion;
  given: string;
  correct: boolean;
  /** Seconds spent, or null for an untimed question. */
  seconds: number | null;
  /** True when the timer expired before the user submitted. */
  timedOut: boolean;
}

type Phase = "generating" | "question" | "feedback" | "complete" | "error";

/** Loose answer comparison: trim, case-fold, and ignore Japanese punctuation. */
function answersMatch(given: string, question: QuizQuestion): boolean {
  const normalize = (value: string) =>
    value
      .trim()
      .toLowerCase()
      // Full-width spaces and the sentence-final 。 are never the point of a
      // question, so they don't count against the user.
      .replace(/[\s　]/g, "")
      .replace(/[。．.、,，!！?？]/g, "");

  const target = normalize(question.answer);
  const attempt = normalize(given);
  if (attempt === target) return true;
  return (question.acceptableAnswers ?? []).some((alt) => normalize(alt) === attempt);
}

/**
 * What a question's `sourceId` points at.
 *
 * Rule ids and word ids are separate sequences, so a quiz spanning both cannot
 * tell them apart from the number alone — the model reports `sourceKind` per
 * question. Single-source quizzes may omit it, and the quiz's own sources then
 * settle the ambiguity.
 */
function sourceKindOf(question: QuizQuestion, config: QuizRunConfig): "word" | "rule" | null {
  if (question.sourceKind) return question.sourceKind;
  if (config.sources.length === 1) return config.sources[0] === "rules" ? "rule" : "word";
  return null;
}

/** Where the "open the source page" link for a question goes, if anywhere. */
function sourceHref(question: QuizQuestion, config: QuizRunConfig): string | null {
  if (!question.sourceId) return null;
  const kind = sourceKindOf(question, config);
  if (!kind) return null;
  return `/${kind === "rule" ? "rules" : "words"}/${question.sourceId}`;
}

/**
 * The quiz runner: asks the API to generate the configured questions, then
 * walks the user through them with an optional per-question timer.
 *
 * Generation happens here (after mount) rather than in the route loader, so the
 * navigation is instant and the wait is shown as a progress panel the user can
 * read — including which model is being tried when the first one fails.
 */
export function QuizRunner({
  config,
  starredIds,
}: {
  config: QuizRunConfig;
  starredIds: number[];
}) {
  const { record } = useQuizStats();

  const [phase, setPhase] = React.useState<Phase>("generating");
  const [questions, setQuestions] = React.useState<QuizQuestion[]>([]);
  const [model, setModel] = React.useState("");
  const [attempts, setAttempts] = React.useState<GenerationAttempt[]>([]);
  const [error, setError] = React.useState("");
  /** Every answer of the current run, owned here so the results can read it. */
  const [answers, setAnswers] = React.useState<Answer[]>([]);
  /** Which attempt index is currently in flight, for the loading bar. */
  const [activeAttempt, setActiveAttempt] = React.useState(0);
  const [retryNote, setRetryNote] = React.useState<string | null>(null);

  // Generation is kicked off exactly once, even under StrictMode's double
  // effect invocation.
  const startedRef = React.useRef(false);

  const generate = React.useCallback(async () => {
    setPhase("generating");
    setError("");
    setRetryNote(null);
    setActiveAttempt(0);
    setAnswers([]);

    // The server owns the fallback chain; this just animates while we wait.
    const ticker = window.setInterval(() => {
      setActiveAttempt((index) => Math.min(index + 1, 4));
    }, 6000);

    try {
      const response = await fetch("/api/quiz/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          config: {
            sources: config.sources,
            focus: config.focus,
            lists: config.listIds,
            tags: [],
            pos: config.pos ?? "",
            ruleKind: config.ruleKind ?? "",
            questionCount: config.questionCount,
            timeLimitEnabled: config.timeLimitSeconds !== null,
            timeLimitSeconds: config.timeLimitSeconds ?? 30,
            types: config.types,
            distribution: config.distribution,
            difficulty: config.difficulty,
            retryMissed: config.retryMissed,
          },
          starredIds,
          missedWordIds: config.missedWordIds,
          missedRuleIds: config.missedRuleIds,
        }),
      });

      const body = (await response.json()) as {
        questions?: QuizQuestion[];
        model?: string;
        attempts?: GenerationAttempt[];
        error?: string;
      };

      if (!response.ok || !body.questions) {
        setError(body.error ?? "We could not generate a quiz just now.");
        setPhase("error");
        return;
      }

      setQuestions(body.questions);
      setModel(body.model ?? "");
      setAttempts(body.attempts ?? []);
      setPhase("question");
    } catch {
      setError("Could not reach the quiz service. Check your connection and try again.");
      setPhase("error");
    } finally {
      window.clearInterval(ticker);
    }
  }, [config, starredIds]);

  React.useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void generate();
  }, [generate]);

  return (
    <div>
      {phase === "generating" && (
        <GeneratingPanel config={config} activeAttempt={activeAttempt} retryNote={retryNote} />
      )}

      {phase === "error" && (
        <ErrorPanel
          message={error}
          attempts={attempts}
          onRetry={() => void generate()}
          config={config}
        />
      )}

      {(phase === "question" || phase === "feedback") && (
        <QuestionFlow
          questions={questions}
          model={model}
          attempts={attempts}
          config={config}
          timeLimitSeconds={config.timeLimitSeconds}
          onAnswer={(answer) => setAnswers((prev) => [...prev, answer])}
          onFinished={() => {
            setPhase("complete");
            // Fold this session's answers into the per-item log. Only questions
            // that cite a library item have anywhere to go, and a question whose
            // kind cannot be determined is skipped rather than logged wrongly —
            // a rule id and a word id can collide.
            void record(
              answers.flatMap((answer) => {
                const { sourceId } = answer.question;
                if (!sourceId) return [];
                const kind = sourceKindOf(answer.question, config);
                if (!kind) return [];
                return [
                  {
                    kind,
                    itemId: sourceId,
                    correct: answer.correct ? 1 : 0,
                    wrong: answer.correct ? 0 : 1,
                  },
                ];
              })
            );
          }}
        />
      )}

      {phase === "complete" && (
        <ResultsPanel
          config={config}
          model={model}
          attempts={attempts}
          answers={answers}
          onRestart={() => void generate()}
        />
      )}
    </div>
  );
}

/** Number of models in the chain, for the loading bar's segments. */
const CHAIN_LENGTH = 5;

const CHAIN_LABELS = [
  "Gemini 3.8 Flash",
  "Gemini 3.7 Flash",
  "Gemini 3.6 Flash",
  "GLM 4.7 Flash",
  "GLM 4.5 Flash",
];

/**
 * The waiting screen. Because the fallback walk can take a while, this doubles
 * as an explanation of what is happening — including why a model was skipped
 * when the first choice is rate limited.
 */
function GeneratingPanel({
  config,
  activeAttempt,
  retryNote,
}: {
  config: QuizRunConfig;
  activeAttempt: number;
  retryNote: string | null;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-6 p-10 text-center">
        <div className="relative flex h-16 w-16 items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-primarylw" />
          <Sparkles className="absolute h-4 w-4 text-primarylw" />
        </div>

        <div>
          <h2 className="text-lg font-semibold">Writing your quiz…</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {config.questionCount} question{config.questionCount === 1 ? "" : "s"} ·{" "}
            {config.types.length} type{config.types.length === 1 ? "" : "s"} ·{" "}
            {config.difficulty}
          </p>
        </div>

        {/* Progress through the fallback chain. */}
        <div className="w-full max-w-md">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primarylw transition-all duration-700 ease-out"
              style={{ width: `${((activeAttempt + 1) / CHAIN_LENGTH) * 100}%` }}
            />
          </div>
          <div className="mt-2 flex justify-between text-xs text-muted-foreground">
            <span>
              Trying <span className="font-medium text-foreground">{CHAIN_LABELS[activeAttempt]}</span>
            </span>
            <span>
              model {Math.min(activeAttempt + 1, CHAIN_LENGTH)} of {CHAIN_LENGTH}
            </span>
          </div>
        </div>

        {retryNote && (
          <p className="rounded-[var(--radius)] border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-600 dark:text-amber-400">
            {retryNote}
          </p>
        )}

        <p className="max-w-md text-xs text-muted-foreground">
          If a model is busy or rate limited, the next one in the chain is tried automatically —
          this can take up to a minute.
        </p>
      </CardContent>
    </Card>
  );
}

function ErrorPanel({
  message,
  attempts,
  onRetry,
  config,
}: {
  message: string;
  attempts: GenerationAttempt[];
  onRetry: () => void;
  config: QuizRunConfig;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-5 p-10 text-center">
        <div className="text-4xl">😕</div>
        <div>
          <h2 className="text-lg font-semibold">The quiz could not be generated</h2>
          <p className="mt-1 max-w-lg text-sm text-muted-foreground">{message}</p>
        </div>

        {attempts.length > 0 && <AttemptList attempts={attempts} />}

        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={onRetry}>
            <RotateCcw /> Try again
          </Button>
          <Link
            to={`/study/quizzes?kind=${config.sources.join(",")}`}
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            Adjust the setup
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

/** Which models were tried and how each one failed. */
function AttemptList({ attempts }: { attempts: GenerationAttempt[] }) {
  if (attempts.length === 0) return null;
  return (
    <div className="w-full max-w-md space-y-1.5 text-left">
      {attempts.map((attempt, index) => (
        <div
          key={`${attempt.model}-${index}`}
          className="flex items-start justify-between gap-3 rounded-[var(--radius)] border border-border px-3 py-2 text-xs"
        >
          <span className="min-w-0">
            <span className="block font-medium">{attempt.model}</span>
            {attempt.detail && (
              <span className="block truncate text-muted-foreground">{attempt.detail}</span>
            )}
          </span>
          <Badge
            variant={
              attempt.outcome === "ok"
                ? "success"
                : attempt.outcome === "ratelimit"
                  ? "outline"
                  : "secondary"
            }
            className={cn("shrink-0", attempt.outcome !== "ok" && "text-red-500")}
          >
            {attempt.outcome}
          </Badge>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Question flow
// ---------------------------------------------------------------------------

function QuestionFlow({
  questions,
  model,
  attempts,
  config,
  timeLimitSeconds,
  onAnswer,
  onFinished,
}: {
  questions: QuizQuestion[];
  model: string;
  attempts: GenerationAttempt[];
  config: QuizRunConfig;
  timeLimitSeconds: number | null;
  onAnswer: (answer: Answer) => void;
  onFinished: () => void;
}) {
  const [index, setIndex] = React.useState(0);
  /** This run's answers, for the running score badges. */
  const [answers, setAnswers] = React.useState<Answer[]>([]);
  const [given, setGiven] = React.useState("");
  const [submitted, setSubmitted] = React.useState<Answer | null>(null);
  const [secondsLeft, setSecondsLeft] = React.useState(timeLimitSeconds ?? 0);

  const question = questions[index];

  /** Commit an answer and show the feedback card. */
  const submit = React.useCallback(
    (value: string, timedOut = false) => {
      if (submitted) return;
      const correct = !timedOut && answersMatch(value, question);
      const answer: Answer = {
        question,
        given: value,
        correct,
        seconds: timeLimitSeconds === null ? null : timeLimitSeconds - secondsLeft,
        timedOut,
      };
      setSubmitted(answer);
      setAnswers((prev) => [...prev, answer]);
      // The runner owns the full run's answers — this keeps them in one place.
      onAnswer(answer);
    },
    [question, submitted, timeLimitSeconds, secondsLeft, onAnswer]
  );

  // Reset per-question state whenever a new question comes up.
  React.useEffect(() => {
    setGiven("");
    setSubmitted(null);
    setSecondsLeft(timeLimitSeconds ?? 0);
  }, [index, timeLimitSeconds]);

  // Countdown. Runs only while a question is unanswered and timed.
  React.useEffect(() => {
    if (timeLimitSeconds === null || submitted) return;
    if (secondsLeft <= 0) {
      submit("", true);
      return;
    }
    const timer = window.setTimeout(() => setSecondsLeft((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [secondsLeft, timeLimitSeconds, submitted, submit]);

  const advance = () => {
    if (index + 1 >= questions.length) {
      onFinished();
      return;
    }
    setIndex((value) => value + 1);
  };

  const isLast = index + 1 >= questions.length;
  const progress = ((index + (submitted ? 1 : 0)) / questions.length) * 100;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <span className="min-w-0 truncate">
          Question {index + 1} of {questions.length} ·{" "}
          {QUIZ_TYPE_LABELS[question.type]}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {model && (
            <Tooltip content={<AttemptList attempts={attempts} />}>
              <Badge variant="kana">{model}</Badge>
            </Tooltip>
          )}
          <Badge variant="success">{answers.filter((a) => a.correct).length}</Badge>
          <Badge variant="outline" className="text-red-500">
            {answers.filter((a) => !a.correct).length}
          </Badge>
        </div>
      </div>

      {/* Progress, plus the countdown bar while a question is timed. */}
      <div className="mb-6 space-y-1.5">
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primarylw transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        {timeLimitSeconds !== null && (
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full transition-all duration-1000 ease-linear",
                secondsLeft <= 5 ? "bg-red-500" : "bg-primarylw/60"
              )}
              style={{ width: `${(secondsLeft / timeLimitSeconds) * 100}%` }}
            />
          </div>
        )}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={question.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          <Card>
            <CardContent className="p-6 md:p-8">
              <div className="mb-4 flex items-start justify-between gap-4">
                <p className="text-lg leading-relaxed font-medium whitespace-pre-line">
                  {question.prompt}
                </p>
                {timeLimitSeconds !== null && !submitted && (
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium tabular-nums",
                      secondsLeft <= 5
                        ? "border-red-500/50 text-red-500"
                        : "border-border text-muted-foreground"
                    )}
                  >
                    <Timer className="h-3.5 w-3.5" />
                    {secondsLeft}s
                  </span>
                )}
              </div>

              {question.type === "fill-blanks" && question.sentence && (
                <p className="mb-5 rounded-[var(--radius)] border border-border bg-muted/40 p-4 text-lg leading-loose">
                  {renderSentence(question.sentence, submitted?.given ?? null, submitted?.question.answer ?? null)}
                </p>
              )}

              <QuestionInput
                question={question}
                given={given}
                onGivenChange={setGiven}
                submitted={submitted}
                onSubmit={submit}
              />

              {submitted && (
                <Feedback answer={submitted} onNext={advance} isLast={isLast} config={config} />
              )}            </CardContent>
          </Card>
        </motion.div>
      </AnimatePresence>

      {!submitted && question.type === "input" && (
        <div className="mt-6 flex justify-center">
          <SubmitButton given={given} onClick={() => submit(given)} />
        </div>
      )}
    </div>
  );
}

/**
 * The sentence with its gaps. Before answering, blank underscores; after, the
 * gap shows what the user put (green when right, red when wrong).
 */
function renderSentence(
  sentence: string,
  given: string | null,
  answer: string | null
): React.ReactNode {
  const parts = sentence.split(/_{2,}/g);
  if (parts.length === 1) return sentence;

  const givenParts = given ? given.split(/\s*,\s*/) : [];
  const answerParts = answer ? answer.split(/\s*,\s*/) : [];

  return parts.map((part, index) => {
    const isLast = index === parts.length - 1;
    return (
      <React.Fragment key={index}>
        {part}
        {!isLast && (
          <span
            className={cn(
              "mx-1 inline-block min-w-14 rounded border-b-2 px-2 text-center align-middle font-semibold",
              given === null
                ? "border-primarylw/60 text-primarylw"
                : givenParts[index] === answerParts[index]
                  ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
                  : "border-red-500 text-red-500"
            )}
          >
            {given === null ? "＿" : (givenParts[index] ?? "—")}
          </span>
        )}
      </React.Fragment>
    );
  });
}

function SubmitButton({ given, onClick }: { given: string; onClick: () => void }) {
  return (
    <Button onClick={onClick} disabled={given.trim().length === 0}>
      <Check /> Check answer
    </Button>
  );
}

/** The per-type answer control. */
function QuestionInput({
  question,
  given,
  onGivenChange,
  submitted,
  onSubmit,
}: {
  question: QuizQuestion;
  given: string;
  onGivenChange: (value: string) => void;
  submitted: Answer | null;
  onSubmit: (value: string) => void;
}) {
  // Fill-in-the-blanks: an unordered bank of buttons that fill the next gap.
  const [picked, setPicked] = React.useState<string[]>([]);

  React.useEffect(() => {
    setPicked([]);
  }, [question.id]);

  if (question.type === "multiple-choice" || question.type === "true-false") {
    const options =
      question.type === "true-false" ? ["true", "false"] : (question.options ?? []);
    const labels =
      question.type === "true-false"
        ? ["✓ Correct", "✗ Incorrect"]
        : options;

    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option, index) => {
          const isCorrect = option === question.answer;
          const isChosen = submitted?.given === option;
          return (
            <button
              key={`${option}-${index}`}
              type="button"
              // Once answered, the buttons become the review — no more clicks.
              disabled={submitted !== null}
              onClick={() => onSubmit(option)}
              className={cn(
                "flex items-center justify-between gap-3 rounded-[var(--radius)] border p-4 text-left transition-colors",
                submitted === null
                  ? "cursor-pointer border-border hover:border-primarylw/50 hover:bg-muted/50"
                  : isCorrect
                    ? "border-emerald-500/60 bg-emerald-500/10"
                    : isChosen
                      ? "border-red-500/60 bg-red-500/10"
                      : "border-border opacity-60"
              )}
            >
              <span className="text-sm font-medium">{labels[index]}</span>
              {submitted !== null && isCorrect && (
                <Check className="h-4 w-4 shrink-0 text-emerald-500" />
              )}
              {submitted !== null && isChosen && !isCorrect && (
                <X className="h-4 w-4 shrink-0 text-red-500" />
              )}
            </button>
          );
        })}
      </div>
    );
  }

  if (question.type === "fill-blanks") {
    const blanks = question.blanks ?? 1;
    const options = question.options ?? [];

    const pick = (option: string) => {
      const next = [...picked, option];
      setPicked(next);
      if (next.length >= blanks) onSubmit(next.join(", "));
    };

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: blanks }).map((_, index) => (
            <span
              key={index}
              className="rounded-[var(--radius)] border border-dashed border-primarylw/60 px-4 py-2 text-sm font-semibold text-primarylw"
            >
              {picked[index] ?? `gap ${index + 1}`}
            </span>
          ))}
        </div>

        {options.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {options.map((option, index) => {
              const used = picked.includes(option);
              return (
                <button
                  key={`${option}-${index}`}
                  type="button"
                  disabled={used || submitted !== null}
                  onClick={() => pick(option)}
                  className={cn(
                    "rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
                    used
                      ? "cursor-not-allowed border-border/60 text-muted-foreground/40 line-through"
                      : "cursor-pointer border-border hover:border-primarylw/50 hover:bg-muted"
                  )}
                >
                  {option}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              value={given}
              onChange={(event) => onGivenChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onSubmit(given);
              }}
              placeholder="Type the missing words, separated by commas"
              className="w-full rounded-[var(--radius)] border border-border bg-background px-4 py-2 text-sm outline-none focus:border-primarylw"
            />
            <Button onClick={() => onSubmit(given)} disabled={given.trim().length === 0}>
              <Check />
            </Button>
          </div>
        )}

        {picked.length > 0 && submitted === null && (
          <button
            type="button"
            onClick={() => setPicked([])}
            className="cursor-pointer text-xs text-muted-foreground hover:text-foreground"
          >
            Clear the gaps
          </button>
        )}
      </div>
    );
  }

  // input
  return (
    <input
      value={given}
      onChange={(event) => onGivenChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") onSubmit(given);
      }}
      disabled={submitted !== null}
      autoFocus
      placeholder="Type your answer — kana or romaji"
      className={cn(
        "w-full rounded-[var(--radius)] border bg-background px-4 py-3 text-lg outline-none",
        submitted === null
          ? "border-border focus:border-primarylw"
          : submitted.correct
            ? "border-emerald-500/60"
            : "border-red-500/60"
      )}
    />
  );
}

/** Correct/incorrect, the canonical answer, and the explanation. */
function Feedback({
  answer,
  onNext,
  isLast,
  config,
}: {
  answer: Answer;
  onNext: () => void;
  isLast: boolean;
  config: QuizRunConfig;
}) {
  const { question, correct, given, timedOut } = answer;
  const href = sourceHref(question, config);

  return (
    <div
      className={cn(
        "mt-6 rounded-[var(--radius)] border p-4",
        correct
          ? "border-emerald-500/50 bg-emerald-500/10"
          : "border-red-500/50 bg-red-500/10"
      )}
    >
      <div className="flex items-center gap-2">
        {correct ? (
          <Check className="h-4 w-4 text-emerald-500" />
        ) : (
          <X className="h-4 w-4 text-red-500" />
        )}
        <p className="text-sm font-semibold">
          {correct ? "Correct!" : timedOut ? "Time ran out" : "Not quite"}
        </p>
      </div>

      {!correct && (
        <p className="mt-2 text-sm">
          <span className="text-muted-foreground">Correct answer: </span>
          <span className="font-semibold">{question.answer}</span>
          {given.trim().length > 0 && (
            <span className="text-muted-foreground"> · you said “{given}”</span>
          )}
        </p>
      )}

      {question.explanation && (
        <p className="mt-2 text-sm text-muted-foreground">{question.explanation}</p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        {href ? (
          <Link
            to={href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-primarylw"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Open the source page
          </Link>
        ) : (
          <span />
        )}
        <Button onClick={onNext}>{isLast ? "See results" : "Next question →"}</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function ResultsPanel({
  config,
  model,
  attempts,
  answers,
  onRestart,
}: {
  config: QuizRunConfig;
  model: string;
  attempts: GenerationAttempt[];
  answers: Answer[];
  onRestart: () => void;
}) {
  const total = answers.length;
  const correct = answers.filter((answer) => answer.correct).length;
  const timedOut = answers.filter((answer) => answer.timedOut).length;
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
  const missed = answers.filter((answer) => !answer.correct);
  // Average time per answered question, when the run was timed at all.
  const timed = answers.filter((answer) => answer.seconds !== null);
  const averageSeconds =
    timed.length > 0
      ? Math.round(timed.reduce((sum, answer) => sum + (answer.seconds ?? 0), 0) / timed.length)
      : null;

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-5 p-10 text-center">
        <div className="text-5xl">{pct >= 80 ? "🎉" : pct >= 50 ? "👍" : "📚"}</div>
        <div>
          <h2 className="text-xl font-semibold">Quiz complete!</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {correct} of {total} correct ({pct}%)
            {timedOut > 0 && ` · ${timedOut} ran out of time`}
            {averageSeconds !== null && ` · ${averageSeconds}s average per question`}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={onRestart}>
            <RotateCcw /> New questions
          </Button>
          <Link
            to={`/study/quizzes?kind=${config.sources.join(",")}`}
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            Change the setup
          </Link>
        </div>

        <p className="text-xs text-muted-foreground">
          Generated by {model || "the fallback chain"}.
          {config.questionCount !== total &&
            ` ${total} of ${config.questionCount} requested questions were usable.`}
        </p>

        {/* Every question the user got wrong, so the review is actionable. */}
        {missed.length > 0 && (
          <div className="w-full max-w-lg space-y-2 text-left">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Worth another look
            </p>
            {missed.map((answer) => (
              <div
                key={answer.question.id}
                className="rounded-[var(--radius)] border border-border p-3 text-sm"
              >
                <p className="font-medium whitespace-pre-line">{answer.question.prompt}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Correct answer: <span className="text-foreground">{answer.question.answer}</span>
                  {answer.timedOut ? " · timed out" : ` · you said “${answer.given}”`}
                </p>
                {(() => {
                  const href = sourceHref(answer.question, config);
                  if (!href) return null;
                  return (
                    <Link
                      to={href}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-primarylw"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> Open the source page
                    </Link>
                  );
                })()}
              </div>
            ))}
          </div>
        )}

        {attempts.some((attempt) => attempt.outcome !== "ok") && (
          <AttemptList attempts={attempts.filter((attempt) => attempt.outcome !== "ok")} />
        )}
      </CardContent>
    </Card>
  );
}
