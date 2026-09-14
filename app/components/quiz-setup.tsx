import * as React from "react";
import { useNavigate } from "react-router";
import { FolderOpen, ListChecks, Save, Sparkles } from "lucide-react";

import type { TagInfo, WordListSummary } from "~/lib/db.server";
import { useStarredIds, type StarredIds } from "~/lib/use-stars";
import { useQuizStats } from "~/lib/use-quiz-stats";
import { SettingLabel } from "~/components/setting-label";
import { Badge } from "~/components/lightswind/badge";
import { Button } from "~/components/lightswind/button";
import { Card, CardContent } from "~/components/lightswind/card";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "~/components/lightswind/drawer";
import { Input, Label } from "~/components/lightswind/input";
import { ReorderList, ReorderRow } from "~/components/lightswind/reorder";
import { ScrollArea } from "~/components/lightswind/scroll-area";
import { Slider } from "~/components/lightswind/slider";
import { Switch } from "~/components/lightswind/switch";
import { toast } from "~/components/lightswind/toast";
import { Tooltip } from "~/components/lightswind/tooltip";
import { cn } from "~/lib/utils";
import {
  loadQuizConfig,
  loadQuizSessions,
  newQuizSessionId,
  saveQuizConfig,
  saveQuizSessions,
  totalQuizAnswers,
  weakestIds,
  type SavedQuizSession,
} from "~/lib/quiz-prefs";
import {
  QUIZ_DIFFICULTIES,
  QUIZ_DIFFICULTY_HINTS,
  QUIZ_DIFFICULTY_LABELS,
  QUIZ_DISTRIBUTIONS,
  QUIZ_DISTRIBUTION_HINTS,
  QUIZ_DISTRIBUTION_LABELS,
  QUIZ_QUESTION_TYPES,
  QUIZ_SIZES,
  QUIZ_SOURCE_KINDS,
  QUIZ_SOURCE_KIND_HINTS,
  QUIZ_SOURCE_KIND_LABELS,
  QUIZ_TIME_LIMITS,
  QUIZ_TYPE_HINTS,
  QUIZ_TYPE_LABELS,
  WORD_FOCUS_OPTIONS,
  type QuizConfig,
  type QuizDifficulty,
  type QuizQuestionType,
  type QuizSourceKind,
  type WordQuizFocus,
} from "~/lib/quiz-types";

const POS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "noun", label: "Nouns" },
  { value: "verb", label: "Verbs" },
  { value: "adjective", label: "Adjectives" },
  { value: "adverb", label: "Adverbs" },
];

const RULE_KIND_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All rules" },
  { value: "word", label: "Word rules / forms" },
  { value: "sentence", label: "Sentence rules" },
];

const pill = (active: boolean) =>
  cn(
    "cursor-pointer rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
    active
      ? "border-primarylw bg-primarylw/15 text-primarylw"
      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
  );

/** "words and rules", "words, phrases and rules", "rules". */
function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** One-line summary of what a saved quiz will ask. */
function describeQuiz(config: QuizConfig): string {
  const parts: string[] = [];
  const kinds = config.sources;
  const hasLists = kinds.includes("words") || kinds.includes("phrases");

  if (hasLists && config.lists.length > 0) {
    parts.push(`${config.lists.length} list${config.lists.length === 1 ? "" : "s"}`);
  } else if (config.tags.length > 0) {
    parts.push(`tags: ${config.tags.map((tag) => `#${tag}`).join(" ")}`);
  }
  parts.push(listWords(kinds.map((kind) => QUIZ_SOURCE_KIND_LABELS[kind].toLowerCase())));
  if (hasLists && config.focus !== "all") parts.push(config.focus);
  parts.push(`${config.questionCount} questions`);
  parts.push(`${config.types.length} type${config.types.length === 1 ? "" : "s"}`);
  parts.push(config.timeLimitEnabled ? `${config.timeLimitSeconds}s each` : "untimed");
  parts.push(config.difficulty);
  return parts.join(" · ");
}

/**
 * Quiz configurator.
 *
 * Unlike the flashcards builder there are no tabs: a quiz may draw on words,
 * phrases and rules *at once*, so those are togglable buttons rather than
 * mutually exclusive sections, and the panel below shows only the steps that
 * apply to whatever is switched on.
 */
export function QuizSetup({
  wordLists,
  phraseLists,
  tags,
  ruleTags,
  ruleCounts,
  preselectedLists,
  initialSources,
}: {
  wordLists: WordListSummary[];
  phraseLists: WordListSummary[];
  tags: TagInfo[];
  ruleTags: TagInfo[];
  ruleCounts: { all: number; word: number; sentence: number };
  preselectedLists: number[];
  initialSources: QuizSourceKind[];
}) {
  const [config, setConfig] = React.useState<QuizConfig>(() => {
    const remembered = loadQuizConfig();
    return {
      ...remembered,
      // A deep link (?lists=…) wins over whatever was remembered.
      lists: preselectedLists.length > 0 ? preselectedLists : remembered.lists,
      // ?kind=words preselects that source; otherwise keep the remembered one.
      sources: initialSources.length > 0 ? initialSources : remembered.sources,
    };
  });
  const [sessions, setSessions] = React.useState<SavedQuizSession[]>(() => loadQuizSessions());
  const starred = useStarredIds();
  const { stats } = useQuizStats();

  const onChange = (patch: Partial<QuizConfig>) =>
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      saveQuizConfig(next);
      return next;
    });

  const updateSessions = (next: SavedQuizSession[]) => {
    setSessions(next);
    saveQuizSessions(next);
  };

  return (
    <QuizPanel
      wordLists={wordLists}
      phraseLists={phraseLists}
      tags={tags}
      ruleTags={ruleTags}
      ruleCounts={ruleCounts}
      config={config}
      onChange={onChange}
      starred={starred}
      sessions={sessions}
      onSessionsChange={updateSessions}
      stats={stats}
    />
  );
}

function QuizPanel({
  wordLists,
  phraseLists,
  tags,
  ruleTags,
  ruleCounts,
  config,
  onChange,
  starred,
  sessions,
  onSessionsChange,
  stats,
}: {
  wordLists: WordListSummary[];
  phraseLists: WordListSummary[];
  tags: TagInfo[];
  ruleTags: TagInfo[];
  ruleCounts: { all: number; word: number; sentence: number };
  config: QuizConfig;
  onChange: (patch: Partial<QuizConfig>) => void;
  starred: StarredIds;
  sessions: SavedQuizSession[];
  onSessionsChange: (next: SavedQuizSession[]) => void;
  stats: ReturnType<typeof useQuizStats>["stats"];
}) {
  const navigate = useNavigate();
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [loadOpen, setLoadOpen] = React.useState(false);
  const [sessionName, setSessionName] = React.useState("");

  const wantsWords = config.sources.includes("words");
  const wantsPhrases = config.sources.includes("phrases");
  const wantsRules = config.sources.includes("rules");
  const wantsLists = wantsWords || wantsPhrases;

  // The tag chips: list tags and rule tags are separate registries, so a quiz
  // spanning both shows the union and each query filters within its own domain.
  const panelTags = React.useMemo(() => {
    const seen = new Map<string, number>();
    const add = (list: TagInfo[]) => {
      for (const tag of list) {
        if (!seen.has(tag.name)) seen.set(tag.name, tag.listCount);
      }
    };
    if (wantsLists) add(tags);
    if (wantsRules) add(ruleTags);
    return [...seen].map(([name, listCount]) => ({ name, listCount }));
  }, [tags, ruleTags, wantsLists, wantsRules]);

  /**
   * The lists on offer, merged by id. A list can hold both words and phrases,
   * and the counts are summed over whichever kinds are switched on — so one
   * `config.lists` selection scopes both queries correctly.
   */
  const mergedLists = React.useMemo(() => {
    const byId = new Map<
      number,
      { id: number; title: string; tags: string[]; words: number; phrases: number }
    >();
    const merge = (lists: WordListSummary[], key: "words" | "phrases") => {
      for (const list of lists) {
        const entry =
          byId.get(list.id) ??
          { id: list.id, title: list.title, tags: list.tags, words: 0, phrases: 0 };
        entry[key] += list.wordCount;
        byId.set(list.id, entry);
      }
    };
    if (wantsWords) merge(wordLists, "words");
    if (wantsPhrases) merge(phraseLists, "phrases");
    return [...byId.values()].map((entry) => ({
      ...entry,
      count: (wantsWords ? entry.words : 0) + (wantsPhrases ? entry.phrases : 0),
    }));
  }, [wordLists, phraseLists, wantsWords, wantsPhrases]);

  const tagFiltered =
    config.tags.length === 0
      ? mergedLists
      : mergedLists.filter((list) => list.tags.some((tag) => config.tags.includes(tag)));

  const eligible =
    config.lists.length > 0
      ? tagFiltered.filter((list) => config.lists.includes(list.id))
      : tagFiltered;

  const listsMatch = eligible.reduce((sum, list) => sum + list.count, 0);

  const rulesMatch = wantsRules
    ? config.ruleKind === "word"
      ? ruleCounts.word
      : config.ruleKind === "sentence"
        ? ruleCounts.sentence
        : ruleCounts.all
    : 0;

  const matchCount = listsMatch + rulesMatch;

  // The ids this user keeps getting wrong, split by what they point at.
  const missedRuleIds = weakestIds(stats, "rule");
  const missedWordIds = weakestIds(stats, "word");
  const missedIds: number[] = [
    ...(wantsRules ? missedRuleIds : []),
    ...(wantsLists ? missedWordIds : []),
  ];
  // A "retry my misses" quiz can only be as long as the list of misses.
  const retryCount = Math.min(missedIds.length, config.questionCount);

  const starredIds = new Set<number>([
    ...(wantsRules ? starred.rules : []),
    ...(wantsLists ? starred.words : []),
  ]);

  // How much of the log has already been answered, for the summary line.
  const logged = totalQuizAnswers(stats);
  const loggedTotal = logged.correct + logged.wrong;

  // A quiz can't ask for more questions than there is source material.
  const availableCount = config.retryMissed ? retryCount : matchCount;
  const effectiveCount = Math.min(config.questionCount, Math.max(availableCount, 1));

  const kindNames = config.sources.map((kind) => QUIZ_SOURCE_KIND_LABELS[kind].toLowerCase());
  const noun = config.sources.length === 1 ? kindNames[0].replace(/s$/, "") : "item";

  const suggestedName = `${listWords(kindNames)} · ${config.questionCount} questions`;

  const toggleTag = (tag: string) =>
    onChange({
      tags: config.tags.includes(tag)
        ? config.tags.filter((t) => t !== tag)
        : [...config.tags, tag],
    });

  const toggleList = (id: number) =>
    onChange({
      lists: config.lists.includes(id)
        ? config.lists.filter((value) => value !== id)
        : [...config.lists, id],
    });

  /** Multi-select: a quiz may mix question types. At least one must remain. */
  const toggleType = (type: QuizQuestionType) => {
    const next = config.types.includes(type)
      ? config.types.filter((value) => value !== type)
      : [...config.types, type];
    if (next.length === 0) return; // never leave the user with no question types
    onChange({ types: next });
  };

  /** Multi-select: a quiz may span words, phrases and rules. One must remain. */
  const toggleSource = (kind: QuizSourceKind) => {
    const next = config.sources.includes(kind)
      ? config.sources.filter((value) => value !== kind)
      : QUIZ_SOURCE_KINDS.filter((value) => value === kind || config.sources.includes(value));
    if (next.length === 0) return; // never leave the user with nothing to quiz on
    // A filter whose section just disappeared would silently stop applying.
    const patch: Partial<QuizConfig> = { sources: next };
    if (kind === "rules" && !next.includes("rules")) patch.ruleKind = "";
    if (kind === "words" && !next.includes("words")) patch.pos = "";
    onChange(patch);
  };

  const selectableLists = tagFiltered.filter((list) => list.count > 0).map((list) => list.id);
  const allListsSelected =
    selectableLists.length > 0 && selectableLists.every((id) => config.lists.includes(id));
  const toggleSelectAllLists = () => onChange({ lists: allListsSelected ? [] : selectableLists });

  const selectAllPill = (all: boolean, onToggle: () => void, label: string, empty = false) => (
    <button
      type="button"
      onClick={onToggle}
      disabled={empty}
      data-slot="quiz-select-all"
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        empty
          ? "cursor-not-allowed border-border/60 text-muted-foreground/50"
          : all
            ? "cursor-pointer border-primarylw bg-primarylw/15 text-primarylw"
            : "cursor-pointer border-border text-muted-foreground hover:border-primarylw/40 hover:text-foreground"
      )}
    >
      <ListChecks className="h-3.5 w-3.5" />
      {all ? "Clear selection" : label}
    </button>
  );

  const openSaveDrawer = (open: boolean) => {
    if (open) setSessionName((prev) => prev || suggestedName);
    setSaveOpen(open);
  };

  const saveCurrentSession = () => {
    const name = sessionName.trim();
    if (!name) return;
    const session: SavedQuizSession = {
      ...config,
      id: newQuizSessionId(),
      name: name.slice(0, 60),
      createdAt: Date.now(),
    };
    onSessionsChange([session, ...sessions].slice(0, 30));
    setSaveOpen(false);
    setSessionName("");
    toast({
      title: `Saved “${session.name}”`,
      description: describeQuiz(session),
      variant: "success",
    });
  };

  const deleteSession = (id: string) => {
    const removed = sessions.find((session) => session.id === id);
    onSessionsChange(sessions.filter((session) => session.id !== id));
    if (removed) toast({ title: `Deleted “${removed.name}”`, variant: "info" });
  };

  const loadSession = (session: SavedQuizSession) => {
    onChange(session);
    setLoadOpen(false);
    toast({
      title: `Loaded “${session.name}”`,
      description: describeQuiz(session),
      variant: "info",
    });
  };

  /**
   * Hand the whole configuration to the session route. The AI call happens
   * there (after mount), so the user sees a loading panel rather than a frozen
   * navigation while the models are tried.
   */
  const start = () => {
    if (availableCount === 0) return;
    const qs = new URLSearchParams({
      sources: config.sources.join(","),
      count: String(effectiveCount),
      difficulty: config.difficulty,
      distribution: config.distribution,
      types: config.types.join(","),
      focus: config.focus,
    });
    if (config.timeLimitEnabled) qs.set("seconds", String(config.timeLimitSeconds));
    if (wantsLists && config.lists.length > 0) qs.set("lists", config.lists.join(","));
    if (config.tags.length > 0) qs.set("tags", config.tags.join(","));
    if (wantsRules && config.ruleKind) qs.set("ruleKind", config.ruleKind);
    if (wantsWords && config.pos) qs.set("pos", config.pos);
    // "Only what I keep missing" narrows each source to the ids the user has
    // got wrong before. Rule ids and word ids are separate sequences, so they
    // travel as separate params and the server intersects them per kind.
    if (config.retryMissed) {
      if (wantsRules && missedRuleIds.length > 0) {
        qs.set("missedRuleIds", missedRuleIds.join(","));
      }
      if (wantsLists && missedWordIds.length > 0) {
        qs.set("missedWordIds", missedWordIds.join(","));
      }
    } else if (starredIds.size > 0) {
      // Starred ids let the server scope the source material to starred items.
      qs.set("starredIds", [...starredIds].join(","));
    }
    navigate(`/study/quizzes/session?${qs.toString()}`);
  };

  const tagsStepBody =
    panelTags.length === 0 ? (
      <p className="text-xs text-muted-foreground">No tags in the collection yet.</p>
    ) : (
      <div className="flex flex-wrap gap-1.5">
        {panelTags.map((tag) => {
          const active = config.tags.includes(tag.name);
          return (
            <button
              key={tag.name}
              type="button"
              onClick={() => toggleTag(tag.name)}
              aria-pressed={active}
              className={cn(
                "cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                active
                  ? "border-primarylw bg-primarylw/15 text-primarylw"
                  : "border-border text-muted-foreground hover:border-primarylw/40 hover:text-foreground"
              )}
            >
              #{tag.name} <span className="opacity-60">{tag.listCount}</span>
            </button>
          );
        })}
      </div>
    );

  const steps: { title: string; body: React.ReactNode; action?: React.ReactNode }[] = [];

  // 1. What to quiz on — the only step that is always present.
  steps.push({
    title: "What to quiz on",
    body: (
      <>
        <div className="flex flex-wrap gap-1.5">
          {QUIZ_SOURCE_KINDS.map((kind) => (
            <Tooltip key={kind} content={QUIZ_SOURCE_KIND_HINTS[kind]}>
              <button
                type="button"
                onClick={() => toggleSource(kind)}
                aria-pressed={config.sources.includes(kind)}
                className={pill(config.sources.includes(kind))}
              >
                {QUIZ_SOURCE_KIND_LABELS[kind]}
              </button>
            </Tooltip>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Pick as many as you like — one quiz can test words, phrases and rules together. At least
          one is required.
        </p>
      </>
    ),
  });

  if (wantsLists) {
    steps.push({
      title:
        wantsWords && wantsPhrases
          ? "Word & phrase lists"
          : wantsPhrases
            ? "Phrase lists"
            : "Word lists",
      action: selectAllPill(
        allListsSelected,
        toggleSelectAllLists,
        "Select all lists",
        selectableLists.length === 0
      ),
      body:
        tagFiltered.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {mergedLists.length === 0
              ? "No lists yet — create one and it appears here."
              : "No lists match the selected tags."}
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {tagFiltered.map((list) => {
              const active = config.lists.includes(list.id);
              const disabled = list.count === 0;
              return (
                <button
                  key={list.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggleList(list.id)}
                  aria-pressed={active}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-[var(--radius)] border p-3 text-left transition-colors",
                    disabled
                      ? "cursor-not-allowed opacity-40"
                      : active
                        ? "cursor-pointer border-primarylw/60 bg-primarylw/10"
                        : "cursor-pointer border-border hover:border-primarylw/40"
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{list.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {list.tags.map((tag) => `#${tag}`).join(" ") || "no tags"}
                    </span>
                  </span>
                  <Badge variant="secondary" className="shrink-0">
                    {list.count}
                  </Badge>
                </button>
              );
            })}
          </div>
        ),
    });
  }

  if (wantsWords) {
    steps.push({
      title: "Types of words",
      body: (
        <div className="flex flex-wrap gap-1.5">
          {POS_OPTIONS.map((option) => (
            <button
              key={option.value || "all"}
              type="button"
              onClick={() => onChange({ pos: option.value })}
              aria-pressed={config.pos === option.value}
              className={pill(config.pos === option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ),
    });
  }

  // What the questions should ask about each word — meaning, reading, kanji…
  if (wantsLists) {
    steps.push({
      title: "What to ask about",
      body: (
        <div className="flex flex-wrap gap-1.5">
          {WORD_FOCUS_OPTIONS.map((option) => (
            <Tooltip key={option.value} content={option.hint}>
              <button
                type="button"
                onClick={() => onChange({ focus: option.value as WordQuizFocus })}
                aria-pressed={config.focus === option.value}
                className={pill(config.focus === option.value)}
              >
                {option.label}
              </button>
            </Tooltip>
          ))}
        </div>
      ),
    });
  }

  if (wantsRules) {
    steps.push({
      title: "Rule type",
      body: (
        <div className="flex flex-wrap gap-1.5">
          {RULE_KIND_OPTIONS.map((option) => (
            <button
              key={option.value || "all"}
              type="button"
              onClick={() => onChange({ ruleKind: option.value })}
              aria-pressed={config.ruleKind === option.value}
              className={pill(config.ruleKind === option.value)}
            >
              {option.label}
              <span className="ml-1.5 opacity-60">
                {option.value === "word"
                  ? ruleCounts.word
                  : option.value === "sentence"
                    ? ruleCounts.sentence
                    : ruleCounts.all}
              </span>
            </button>
          ))}
        </div>
      ),
    });
  }

  steps.push({ title: "Tags (optional)", body: tagsStepBody });

  return (
    <div className="space-y-6">
      {steps.map((step, index) => (
        <Card key={step.title}>
          <CardContent className="p-6">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">
                {index + 1} · {step.title}
              </p>
              {step.action}
            </div>
            {step.body}
          </CardContent>
        </Card>
      ))}

      {/* Question types — multi-select, so it gets its own card. */}
      <Card>
        <CardContent className="p-6">
          <p className="mb-3 text-sm font-semibold">{steps.length + 1} · Question types</p>
          <div className="flex flex-wrap gap-1.5">
            {QUIZ_QUESTION_TYPES.map((type) => {
              const active = config.types.includes(type);
              return (
                <Tooltip key={type} content={QUIZ_TYPE_HINTS[type]}>
                  <button
                    type="button"
                    onClick={() => toggleType(type)}
                    aria-pressed={active}
                    className={pill(active)}
                  >
                    {QUIZ_TYPE_LABELS[type]}
                  </button>
                </Tooltip>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Pick as many as you like — at least one is required.
          </p>

          {config.types.length > 1 && (
            <div className="mt-5 flex items-center justify-between gap-4">
              <SettingLabel
                label="How to split them"
                hint={QUIZ_DISTRIBUTION_HINTS[config.distribution]}
              />
              <div className="flex flex-wrap justify-end gap-1.5">
                {QUIZ_DISTRIBUTIONS.map((distribution) => (
                  <button
                    key={distribution}
                    type="button"
                    onClick={() => onChange({ distribution })}
                    aria-pressed={config.distribution === distribution}
                    className={pill(config.distribution === distribution)}
                  >
                    {QUIZ_DISTRIBUTION_LABELS[distribution]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* The single-setting rows share one "Options" card. */}
      <Card>
        <CardContent className="p-6">
          <p className="mb-5 text-sm font-semibold">{steps.length + 2} · Options</p>

          <div className="space-y-5">
            {/*
              Only offered once the user has actually missed something — a
              "retry my misses" quiz with no misses would be empty.
            */}
            {missedIds.length > 0 && (
              <div className="flex items-center justify-between gap-4">
                <SettingLabel
                  label="Only what I keep missing"
                  hint={
                    <>
                      Draws this quiz only from the {listWords(kindNames)} you have answered wrong
                      at least once, worst accuracy first. {missedIds.length} to choose from.
                    </>
                  }
                />
                <Switch
                  checked={config.retryMissed}
                  onCheckedChange={(next) => onChange({ retryMissed: next })}
                  aria-label="Only what I keep missing"
                />
              </div>
            )}

            <div className="flex items-center justify-between gap-4">
              <SettingLabel
                label="Number of questions"
                hint="How many questions the AI should write for this quiz."
              />
              <div className="flex flex-wrap justify-end gap-1.5">
                {QUIZ_SIZES.map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => onChange({ questionCount: size })}
                    aria-pressed={config.questionCount === size}
                    className={pill(config.questionCount === size)}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-4">
              <SettingLabel
                label="Time limit per question"
                hint="When on, each question is timed and auto-submits when the clock runs out. Turn it off to answer at your own pace."
              />
              <Switch
                checked={config.timeLimitEnabled}
                onCheckedChange={(next) => onChange({ timeLimitEnabled: next })}
                aria-label="Time limit per question"
              />
            </div>

            {config.timeLimitEnabled && (
              <div className="flex items-center justify-between gap-4">
                <SettingLabel
                  label="Seconds per question"
                  hint="How long to allow for each question."
                />
                <div className="flex flex-wrap justify-end gap-1.5">
                  {QUIZ_TIME_LIMITS.map((seconds) => (
                    <button
                      key={seconds}
                      type="button"
                      onClick={() => onChange({ timeLimitSeconds: seconds })}
                      aria-pressed={config.timeLimitSeconds === seconds}
                      className={pill(config.timeLimitSeconds === seconds)}
                    >
                      {seconds}s
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Difficulty sits on the label's line, like every other row: the
                slider to the right of the name, with its current step beside it. */}
            <div className="flex items-center justify-between gap-4">
              <SettingLabel label="Difficulty" hint={QUIZ_DIFFICULTY_HINTS[config.difficulty]} />
              <div className="flex shrink-0 items-center gap-3">
                <Slider
                  className="w-36 sm:w-52"
                  aria-label="Difficulty"
                  aria-valuetext={QUIZ_DIFFICULTY_LABELS[config.difficulty]}
                  value={[QUIZ_DIFFICULTIES.indexOf(config.difficulty)]}
                  min={0}
                  max={QUIZ_DIFFICULTIES.length - 1}
                  step={1}
                  onValueChange={([index]) => {
                    const difficulty = QUIZ_DIFFICULTIES[index] as QuizDifficulty | undefined;
                    if (difficulty) onChange({ difficulty });
                  }}
                />
                <span className="w-14 text-right text-sm font-medium text-primarylw">
                  {QUIZ_DIFFICULTY_LABELS[config.difficulty]}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary + save / load / start */}
      <div className="flex flex-col items-center justify-between gap-4 rounded-[var(--radius)] border border-primarylw/40 bg-card p-6 md:flex-row">
        <div className="text-center md:text-left">
          <p className="font-semibold">
            {config.retryMissed
              ? `${retryCount} ${noun}${retryCount === 1 ? "" : "s"} you keep missing`
              : `${matchCount} ${noun}${matchCount === 1 ? "" : "s"} · ${listWords(kindNames)}`}
          </p>
          <p className="text-xs text-muted-foreground">
            {effectiveCount} question{effectiveCount === 1 ? "" : "s"} ·{" "}
            {config.timeLimitEnabled ? `${config.timeLimitSeconds}s each` : "untimed"} ·{" "}
            {QUIZ_DIFFICULTY_LABELS[config.difficulty].toLowerCase()} ·{" "}
            {config.types.length} type{config.types.length === 1 ? "" : "s"}
            {loggedTotal > 0 && ` · ${logged.correct}/${loggedTotal} answered correctly so far`}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Drawer open={saveOpen} onOpenChange={openSaveDrawer}>
            <Tooltip content="Save this quiz setup to reuse later">
              <DrawerTrigger asChild>
                <Button variant="outline" disabled={availableCount === 0}>
                  <Save /> Save setup
                </Button>
              </DrawerTrigger>
            </Tooltip>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>Save quiz setup</DrawerTitle>
                <DrawerDescription>Store this configuration to reuse later.</DrawerDescription>
              </DrawerHeader>
              <form
                className="space-y-4 px-4 pb-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveCurrentSession();
                }}
              >
                <div>
                  <Label htmlFor="quiz-name">Setup name</Label>
                  <Input
                    id="quiz-name"
                    value={sessionName}
                    onChange={(event) => setSessionName(event.target.value)}
                    placeholder="e.g. Particles, 10 questions, hard"
                    maxLength={60}
                    required
                    className="mt-2"
                  />
                  <p className="mt-2 text-xs text-muted-foreground">Saved in this browser only.</p>
                </div>
                <Button type="submit" disabled={!sessionName.trim()}>
                  <Save /> Save setup
                </Button>
              </form>
              <DrawerFooter>
                <DrawerClose asChild>
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </DrawerClose>
              </DrawerFooter>
            </DrawerContent>
          </Drawer>

          <Drawer open={loadOpen} onOpenChange={setLoadOpen}>
            <Tooltip content="Load a saved setup">
              <DrawerTrigger asChild>
                <Button variant="outline" disabled={sessions.length === 0}>
                  <FolderOpen /> Load
                </Button>
              </DrawerTrigger>
            </Tooltip>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>Saved quiz setups</DrawerTitle>
                <DrawerDescription>Drag the handle to reorder, or tap to load it.</DrawerDescription>
              </DrawerHeader>
              <div className="px-4 pb-2">
                {sessions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No saved quiz setups yet.</p>
                ) : (
                  <ScrollArea maxHeight={340} className="pr-1">
                    <ReorderList
                      values={sessions}
                      onReorder={(next) => onSessionsChange(next)}
                      className="pb-1"
                    >
                      {sessions.map((session) => (
                        <ReorderRow
                          key={session.id}
                          value={session}
                          onRemove={() => deleteSession(session.id)}
                          removeLabel={`Delete saved setup ${session.name}`}
                        >
                          <button
                            type="button"
                            onClick={() => loadSession(session)}
                            aria-label={`Load ${session.name}`}
                            className="block w-full cursor-pointer rounded-[var(--radius)] px-1 py-0.5 text-left hover:bg-muted/60"
                          >
                            <span className="block truncate text-sm font-medium">
                              {session.name}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {describeQuiz(session)}
                            </span>
                          </button>
                        </ReorderRow>
                      ))}
                    </ReorderList>
                  </ScrollArea>
                )}
              </div>
              <DrawerFooter>
                <DrawerClose asChild>
                  <Button type="button" variant="outline">
                    Close
                  </Button>
                </DrawerClose>
              </DrawerFooter>
            </DrawerContent>
          </Drawer>

          <Button size="lg" onClick={start} disabled={availableCount === 0}>
            <Sparkles /> Generate quiz
          </Button>
        </div>
      </div>
    </div>
  );
}
