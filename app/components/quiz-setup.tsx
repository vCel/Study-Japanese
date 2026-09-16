import * as React from "react";
import { useNavigate } from "react-router";
import { BookMarked, Check, FolderOpen, ListChecks, Minus, Save, Search, Sparkles } from "lucide-react";

import type { RuleChoice, TagInfo, WordListSummary } from "~/lib/db.server";
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

/** How many tags a rule row shows before the rest collapse into "+x". */
const MAX_VISIBLE_RULE_TAGS = 3;

/**
 * `disabled` is for a pill whose source is switched off in step 1. It stays on
 * screen rather than disappearing — an option that vanishes when you untick a
 * source is one you cannot discover, and the greyed pill is what says why the
 * setting has stopped applying.
 */
const pill = (active: boolean, disabled = false) =>
  cn(
    "rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
    disabled
      ? "cursor-not-allowed border-border/60 text-muted-foreground/50"
      : active
        ? "cursor-pointer border-primarylw bg-primarylw/15 text-primarylw"
        : "cursor-pointer border-border text-muted-foreground hover:bg-muted hover:text-foreground"
  );

/**
 * One setting: its label (and hint) beside the control it drives.
 *
 * Stacks below `sm`. Side by side at a 390px viewport the label was left about
 * 130px by the fixed-width control beside it, so "Seconds per question" broke
 * over three lines while its slider stayed put.
 */
const settingRow =
  "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4";

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
  }
  // Both directions are worth naming: "#n5" and "not #archived" describe
  // different quizzes, and a saved session is only recognisable if it says
  // which one it is.
  if (config.tags.length > 0) {
    parts.push(`tags: ${config.tags.map((tag) => `#${tag}`).join(" ")}`);
  }
  if (config.excludedTags.length > 0) {
    parts.push(`without: ${config.excludedTags.map((tag) => `#${tag}`).join(" ")}`);
  }
  parts.push(listWords(kinds.map((kind) => QUIZ_SOURCE_KIND_LABELS[kind].toLowerCase())));
  if (hasLists && config.focus !== "all") parts.push(config.focus);
  if (kinds.includes("rules") && config.ruleIds !== null) {
    parts.push(`${config.ruleIds.length} rule${config.ruleIds.length === 1 ? "" : "s"}`);
  }
  if (config.starredOnly) parts.push("starred only");
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
  rules,
  preselectedLists,
  initialSources,
}: {
  wordLists: WordListSummary[];
  phraseLists: WordListSummary[];
  tags: TagInfo[];
  ruleTags: TagInfo[];
  ruleCounts: { all: number; word: number; sentence: number };
  rules: RuleChoice[];
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
      rules={rules}
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
  rules,
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
  rules: RuleChoice[];
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
  // spanning both shows the union. A name in both registries has its counts
  // summed rather than deduped — the chip is answering "how much is tagged
  // this?", and either one alone would understate it.
  const panelTags = React.useMemo(() => {
    const counts = new Map<string, number>();
    const add = (list: TagInfo[]) => {
      for (const tag of list) counts.set(tag.name, (counts.get(tag.name) ?? 0) + tag.listCount);
    };
    if (wantsLists) add(tags);
    if (wantsRules) add(ruleTags);
    return [...counts].map(([name, listCount]) => ({ name, listCount }));
  }, [tags, ruleTags, wantsLists, wantsRules]);

  const [tagQuery, setTagQuery] = React.useState("");
  /** Narrows the rule *list*, never the quiz — see `shownRules`. */
  const [ruleQuery, setRuleQuery] = React.useState("");
  const tagsActive = config.tags.length > 0 || config.excludedTags.length > 0;

  const tagModeOf = (name: string): "off" | "include" | "exclude" =>
    config.excludedTags.includes(name) ? "exclude" : config.tags.includes(name) ? "include" : "off";

  /**
   * The chips to draw: the whole registry, narrowed by what was typed — plus
   * any tag that is already active, matching or not.
   *
   * Without the second half, searching for "part" after selecting `#n5` hides
   * the `#n5` chip while it goes on filtering the quiz, and the only trace left
   * is a count in the summary line. A filter you cannot see is one you cannot
   * turn off.
   */
  const visibleTags = React.useMemo(() => {
    const query = tagQuery.trim().toLowerCase();
    if (!query) return panelTags;
    return panelTags.filter(
      (tag) => tag.name.toLowerCase().includes(query) || tagModeOf(tag.name) !== "off"
    );
  }, [panelTags, tagQuery, config.tags, config.excludedTags]);

  /**
   * Whether an item is in scope under the tag filter.
   *
   * Include is a union — any one of the named tags is enough — and exclude is a
   * subtraction applied afterwards, so excluding a tag removes an item that
   * matched an include. With no include tags this is "everything except the
   * excluded ones", which is why exclusion alone has to be a working filter
   * rather than a no-op.
   */
  const matchesTagFilter = React.useCallback(
    (itemTags: string[]): boolean => {
      if (config.tags.length > 0 && !itemTags.some((tag) => config.tags.includes(tag))) {
        return false;
      }
      return !itemTags.some((tag) => config.excludedTags.includes(tag));
    },
    [config.tags, config.excludedTags]
  );

  /**
   * One click per state, in the order the user is likely to want them: off →
   * include → exclude → off. Both lists are rebuilt without the tag first, so
   * the two can never end up naming it at once.
   */
  const cycleTag = (name: string) => {
    const mode = tagModeOf(name);
    const nextTags = config.tags.filter((tag) => tag !== name);
    const nextExcluded = config.excludedTags.filter((tag) => tag !== name);
    if (mode === "off") nextTags.push(name);
    else if (mode === "include") nextExcluded.push(name);
    onChange({ tags: nextTags, excludedTags: nextExcluded });
  };

  const clearTags = () => onChange({ tags: [], excludedTags: [] });

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

  const tagFiltered = mergedLists.filter((list) => matchesTagFilter(list.tags));

  /**
   * How many rules of each kind survive the tag filter.
   *
   * Counted here rather than asked of the server, because the rule-kind pills
   * and the match total are drawn while the user is still moving tags around —
   * a round-trip per click would make the number lag the chip it belongs to.
   * `rules` is the full list the picker already holds, so this is the same
   * arithmetic the picker does.
   */
  const taggedRuleCounts = React.useMemo(() => {
    const tagged = rules.filter((rule) => matchesTagFilter(rule.tags));
    return {
      all: tagged.length,
      word: tagged.filter((rule) => rule.kind === "word").length,
      sentence: tagged.filter((rule) => rule.kind === "sentence").length,
    };
  }, [rules, matchesTagFilter]);

  /**
   * `ruleCounts` from the loader is an unfiltered count of the whole
   * collection, so it is only the honest answer while nothing is filtering the
   * rules. With tags on, the tagged counts are what the quiz can actually draw
   * from — and showing the untagged number beside an active filter is how a
   * builder ends up promising questions it cannot ask.
   */
  const effectiveRuleCounts = tagsActive ? taggedRuleCounts : ruleCounts;

  const eligible =
    config.lists.length > 0
      ? tagFiltered.filter((list) => config.lists.includes(list.id))
      : tagFiltered;

  const listsMatch = eligible.reduce((sum, list) => sum + list.count, 0);

  /**
   * The rules the picker offers.
   *
   * Scoped to the selected rule type *and* the tag filter, so what the user
   * ticks is exactly what the quiz can draw on. Both narrowings matter for the
   * same reason: a picker listing sentence rules while the type filter says
   * "word rules" — or rules the tag filter has already excluded — could only
   * ever produce a quiz that does not match what the builder promised.
   */
  const visibleRules = React.useMemo(
    () =>
      rules.filter(
        (rule) =>
          (!config.ruleKind || rule.kind === config.ruleKind) && matchesTagFilter(rule.tags)
      ),
    [rules, config.ruleKind, matchesTagFilter]
  );
  const visibleRuleIds = React.useMemo(() => visibleRules.map((rule) => rule.id), [visibleRules]);

  /**
   * The rules the list actually draws: `visibleRules` narrowed by the search
   * box, matching a title or any of the rule's points.
   *
   * Display only — deliberately not folded into `visibleRules`. That list is
   * the scope (what the quiz can draw from, what "select all" ticks, what the
   * counts and the session query are measured against), and a search that
   * quietly rewrote it would shrink the quiz to whatever happened to be typed
   * in the box. Searching is a way to find a rule, not a way to exclude one.
   */
  const shownRules = React.useMemo(() => {
    const query = ruleQuery.trim().toLowerCase();
    if (!query) return visibleRules;
    return visibleRules.filter(
      (rule) =>
        rule.title.toLowerCase().includes(query) ||
        rule.points.some((point) => point.toLowerCase().includes(query))
    );
  }, [visibleRules, ruleQuery]);

  /**
   * `null` means "every rule" — the default, and the representation that stays
   * correct when a rule is added later. An explicit list means exactly those.
   */
  const allRulesSelected =
    config.ruleIds === null || visibleRuleIds.every((id) => config.ruleIds!.includes(id));
  const selectedRuleCount =
    config.ruleIds === null
      ? visibleRules.length
      : visibleRules.filter((rule) => config.ruleIds!.includes(rule.id)).length;

  const toggleRule = (id: number) => {
    // Unticking while "all" is selected starts from the full set, so it narrows
    // the selection rather than replacing it with that single rule.
    const current = config.ruleIds ?? visibleRuleIds;
    const next = current.includes(id)
      ? current.filter((value) => value !== id)
      : [...current, id];
    // Re-ticking everything collapses back to "all", so rules added later are
    // picked up without the user having to revisit this screen.
    onChange({
      ruleIds: visibleRuleIds.every((value) => next.includes(value)) ? null : next,
    });
  };

  /**
   * One pill, two labels: rules can be cleared (`[]`) as well as all-selected
   * (`null`). Lists only ever get the one label — see `allListsSelected`.
   */
  const toggleSelectAllRules = () => onChange({ ruleIds: allRulesSelected ? [] : null });

  const rulesMatch = !wantsRules
    ? 0
    : config.ruleIds === null
      ? config.ruleKind === "word"
        ? effectiveRuleCounts.word
        : config.ruleKind === "sentence"
          ? effectiveRuleCounts.sentence
          : effectiveRuleCounts.all
      : selectedRuleCount;

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

  const toggleList = (id: number) => {
    // An empty `lists` means "every list" and every card reads as selected, so
    // resolve it to the concrete ids first — otherwise clicking a card that
    // looks chosen would make it the *only* selection.
    const current = config.lists.length === 0 ? selectableLists : config.lists;
    const next = current.includes(id)
      ? current.filter((value) => value !== id)
      : [...current, id];
    // Like the source and type pills, the selection is never emptied: a quiz
    // drawing on no lists has nothing to ask about, so removing the last one
    // falls back to the "every list" sentinel.
    onChange({ lists: next.length === 0 ? [] : next });
  };

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
    // A filter whose section just disappeared would silently stop applying, and
    // a rule selection made against the old rule type would come back stale the
    // next time rules are switched on.
    const patch: Partial<QuizConfig> = { sources: next };
    if (kind === "rules" && !next.includes("rules")) {
      patch.ruleKind = "";
      patch.ruleIds = null;
    }
    if (kind === "words" && !next.includes("words")) patch.pos = "";
    onChange(patch);
  };

  const selectableLists = tagFiltered.filter((list) => list.count > 0).map((list) => list.id);
  /**
   * An empty `lists` is the "every list" sentinel rather than an empty
   * selection, so it counts as fully selected — the same way `ruleIds === null`
   * does above. Read the other way round, the header said "Every list is
   * included" while the pill offered to select them all and no card looked
   * chosen.
   *
   * Lists deliberately have no "clear": `[]` already means everything, and a
   * quiz drawing on no lists is expressed by switching the Words/Phrases
   * sources off in step 1.
   */
  const allListsSelected =
    config.lists.length === 0 ||
    (selectableLists.length > 0 && selectableLists.every((id) => config.lists.includes(id)));
  /**
   * Resets to the `[]` sentinel rather than enumerating every id, so a list
   * created later is included too and the header returns to "Every list is
   * included" — the same state as a fresh builder.
   */
  const toggleSelectAllLists = () => onChange({ lists: [] });

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
    if (config.excludedTags.length > 0) qs.set("excludedTags", config.excludedTags.join(","));
    if (wantsRules && config.ruleKind) qs.set("ruleKind", config.ruleKind);
    // No `ruleIds` param at all means "every rule"; an empty value is an
    // explicit "none", and the session route tells the two apart.
    if (wantsRules && config.ruleIds !== null) qs.set("ruleIds", config.ruleIds.join(","));
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
    } else if (config.starredOnly && starredIds.size > 0) {
      // Only an explicit opt-in narrows a quiz to starred items. Starring
      // something used to scope every quiz silently — hence the flag, sent
      // alongside the ids rather than letting the server infer it from them.
      qs.set("starred", "1");
      qs.set("starredIds", [...starredIds].join(","));
    }
    navigate(`/study/quizzes/session?${qs.toString()}`);
  };

  const tagChipClass = (mode: "off" | "include" | "exclude") =>
    cn(
      "inline-flex cursor-pointer items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
      mode === "include"
        ? "border-primarylw bg-primarylw/15 text-primarylw"
        : mode === "exclude"
          ? "border-red-500/60 bg-red-500/10 text-red-600 dark:text-red-400"
          : "border-border text-muted-foreground hover:border-primarylw/40 hover:text-foreground"
    );

  const tagModeHint = (mode: "off" | "include" | "exclude") =>
    mode === "include"
      ? "Included — click to exclude it instead"
      : mode === "exclude"
        ? "Excluded — click to clear it"
        : "Click to include this tag";

  const activeTagCount = config.tags.length + config.excludedTags.length;

  const tagsStepBody =
    panelTags.length === 0 ? (
      <p className="text-xs text-muted-foreground">No tags in the collection yet.</p>
    ) : (
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={tagQuery}
            onChange={(event) => setTagQuery(event.target.value)}
            placeholder="Search tags…"
            aria-label="Search tags"
            data-slot="quiz-tag-search"
            className="w-full rounded-[var(--radius)] border border-border bg-background py-2 pr-3 pl-9 text-sm outline-none focus:border-primarylw"
          />
        </div>

        {visibleTags.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No tags match “{tagQuery.trim()}”.
          </p>
        ) : (
          <ScrollArea maxHeight={200} className="pr-1">
            <div className="flex flex-wrap gap-1.5">
              {visibleTags.map((tag) => {
                const mode = tagModeOf(tag.name);
                return (
                  <button
                    key={tag.name}
                    type="button"
                    onClick={() => cycleTag(tag.name)}
                    aria-pressed={mode !== "off"}
                    // The three states are also the three test hooks — a chip's
                    // mode is what the specs assert on, not its colour.
                    data-tag-mode={mode}
                    title={tagModeHint(mode)}
                    className={tagChipClass(mode)}
                  >
                    {mode === "include" && <Check className="h-3 w-3 shrink-0" />}
                    {mode === "exclude" && <Minus className="h-3 w-3 shrink-0" />}
                    #{tag.name} <span className="opacity-60">{tag.listCount}</span>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        )}

        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {activeTagCount === 0
              ? "Click a tag to include it, again to exclude it, again to clear it."
              : `${config.tags.length} included · ${config.excludedTags.length} excluded — items without the included tags are hidden, and any carrying an excluded one are dropped.`}
          </p>
          {activeTagCount > 0 && (
            <button
              type="button"
              onClick={clearTags}
              data-slot="quiz-tag-clear"
              className="shrink-0 cursor-pointer text-xs text-muted-foreground hover:text-foreground"
            >
              Clear tags
            </button>
          )}
        </div>
      </div>
    );

  /**
   * One section of the shared "Sources" card. Sections are separated by a tinted
   * panel and spacing rather than a divider, so the lists and the rules read as
   * two groups inside one container.
   */
  const sectionClass = "rounded-[var(--radius)] bg-muted/40 p-4";

  const listsSection: React.ReactNode = !wantsLists ? null : (
    <section className={sectionClass}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {wantsWords && wantsPhrases
              ? "Word & phrase lists"
              : wantsPhrases
                ? "Phrase lists"
                : "Word lists"}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {config.lists.length === 0
              ? `Every list is included (${tagFiltered.length}).`
              : `${config.lists.length} of ${tagFiltered.length} lists selected.`}
          </p>
        </div>
        {/* Offered only when it has something to do — see `allListsSelected`. */}
        {!allListsSelected &&
          selectAllPill(
            false,
            toggleSelectAllLists,
            "Select all lists",
            selectableLists.length === 0
          )}
      </div>

      {tagFiltered.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {mergedLists.length === 0
            ? "No lists yet — create one and it appears here."
            : "No lists match the selected tags."}
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {tagFiltered.map((list) => {
            const active = config.lists.length === 0 || config.lists.includes(list.id);
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
      )}
    </section>
  );

  const rulesSection: React.ReactNode = !wantsRules ? null : (
    <section className={sectionClass}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Rules</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {config.ruleIds === null
              ? `Every ${config.ruleKind ? `${config.ruleKind} ` : ""}rule is included (${visibleRules.length}).`
              : `${selectedRuleCount} of ${visibleRules.length} rules selected.`}
          </p>
        </div>
        {selectAllPill(
          allRulesSelected,
          toggleSelectAllRules,
          "Select all rules",
          visibleRules.length === 0
        )}
      </div>

      {/* Rule type belongs with the rules it filters, not in a step of its own. */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {RULE_KIND_OPTIONS.map((option) => (
          <button
            key={option.value || "all"}
            type="button"
            // Changing the type changes which rules exist to pick from, so the
            // selection resets to "all of them" rather than keeping ids that
            // are no longer on screen.
            onClick={() => onChange({ ruleKind: option.value, ruleIds: null })}
            aria-pressed={config.ruleKind === option.value}
            className={pill(config.ruleKind === option.value)}
          >
            {option.label}
            <span className="ml-1.5 opacity-60">
              {option.value === "word"
                ? effectiveRuleCounts.word
                : option.value === "sentence"
                  ? effectiveRuleCounts.sentence
                  : effectiveRuleCounts.all}
            </span>
          </button>
        ))}
      </div>

      {visibleRules.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {rules.length === 0
            ? "No rules yet — create one and it appears here."
            : tagsActive
              ? "No rules match the selected tags."
              : "No rules of this type."}
        </p>
      ) : (
        <div className="space-y-2">
          {/* Offered whenever there is anything to search, like the tag chips'
              box above: a rule title and its points are both searchable, and
              the list can run to hundreds of rows. */}
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={ruleQuery}
              onChange={(event) => setRuleQuery(event.target.value)}
              placeholder="Search rules… (title or points)"
              aria-label="Search rules"
              data-slot="quiz-rule-search"
              className="w-full rounded-[var(--radius)] border border-border bg-background py-2 pr-3 pl-9 text-sm outline-none focus:border-primarylw"
            />
          </div>

          {/* The search hides rows, so it says so: a list that silently drops
              entries while the header keeps counting them all reads as a bug. */}
          {ruleQuery.trim() !== "" && (
            <p className="text-xs text-muted-foreground">
              {shownRules.length === 0
                ? `No rules match “${ruleQuery.trim()}”.`
                : `Showing ${shownRules.length} of ${visibleRules.length} — searching only narrows this list, not the quiz.`}
            </p>
          )}

          {shownRules.length > 0 && (
            <ScrollArea maxHeight={280} className="pr-1">
              <ul className="space-y-1.5">
                {shownRules.map((rule) => {
                  const active = config.ruleIds === null || config.ruleIds.includes(rule.id);
                  return (
                    <li key={rule.id}>
                      {/*
                        One row per rule rather than a chip in a wrapped cloud:
                        the title is a name ("Polite ます-form") and which forms
                        it actually covers is its ポイント lines, so both belong
                        on the same line the user is deciding about. The old
                        chips truncated that title and showed none of the points.
                      */}
                      <button
                        type="button"
                        onClick={() => toggleRule(rule.id)}
                        aria-pressed={active}
                        data-slot="quiz-rule"
                        className={cn(
                          "flex w-full cursor-pointer items-start gap-3 rounded-[var(--radius)] border p-3 text-left transition-colors",
                          active
                            ? "border-primarylw/60 bg-primarylw/10"
                            : "border-border hover:border-primarylw/40"
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
                            active
                              ? "border-primarylw bg-primarylw text-white"
                              : "border-muted-foreground/50"
                          )}
                        >
                          {active && <Check className="h-3 w-3" />}
                        </span>

                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-sm font-medium">{rule.title}</span>
                            {/* The kind is only news when the picker is not
                                already narrowed to one of the two. */}
                            {!config.ruleKind && (
                              <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                                {rule.kind === "sentence" ? "Sentence" : "Word"}
                              </span>
                            )}
                            {/* A rule's points say what it covers; its examples
                                are the material a question can be written from.
                                A rule with points but no examples generates far
                                worse questions, so the count belongs on the line
                                the user is judging the rule on. */}
                            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                              <BookMarked className="h-3 w-3" />
                              {rule.exampleCount} example{rule.exampleCount === 1 ? "" : "s"}
                            </span>
                          </span>

                          {rule.points.length > 0 && (
                            <span className="mt-1.5 flex flex-wrap items-center gap-1">
                              <span className="text-[10px] font-bold tracking-wide text-muted-foreground/70">
                                ポイント
                              </span>
                              {rule.points.map((point, index) => (
                                // Deliberately *not* clamped to one line. A
                                // clamped chip needs a hover to reveal the rest,
                                // and there is no hover on a touch screen — the
                                // point simply became unreadable on a phone. The
                                // whole reason these are on screen is to be read,
                                // so a long one makes its row taller instead.
                                <span
                                  key={index}
                                  className="min-w-0 rounded-[4px] border border-dashed border-muted-foreground/40 px-1.5 py-0.5 text-xs break-words text-muted-foreground"
                                >
                                  {point}
                                </span>
                              ))}
                            </span>
                          )}
                        </span>

                        {rule.tags.length > 0 && (
                          <span className="hidden shrink-0 flex-wrap justify-end gap-1 sm:flex">
                            {rule.tags.slice(0, MAX_VISIBLE_RULE_TAGS).map((tag) => (
                              <span
                                key={tag}
                                className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
                              >
                                #{tag}
                              </span>
                            ))}
                            {rule.tags.length > MAX_VISIBLE_RULE_TAGS && (
                              <span
                                title={rule.tags
                                  .slice(MAX_VISIBLE_RULE_TAGS)
                                  .map((tag) => `#${tag}`)
                                  .join(", ")}
                                className="rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground"
                              >
                                +{rule.tags.length - MAX_VISIBLE_RULE_TAGS}
                              </span>
                            )}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
          )}
        </div>
      )}
    </section>
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

  // 2. Tags. Placed directly after the sources because they are the broadest
  // filter the user has — a tag narrows every source at once, so choosing it
  // before the lists and rules means the pickers below already show only what
  // is still in scope, instead of the user picking from a list that the next
  // step would then silently shrink.
  steps.push({ title: "Tags (optional)", body: tagsStepBody });

  // 3. Which lists and which rules — one container, one section each.
  if (wantsLists || wantsRules) {
    steps.push({
      title: wantsLists && wantsRules ? "Lists & rules" : wantsLists ? "Lists" : "Rules",
      body: (
        <div className="space-y-3">
          {listsSection}
          {rulesSection}
        </div>
      ),
    });
  }

  /**
   * What a question may be built from, for whichever sources are switched on.
   *
   * These were two steps ("Types of words" and "What to ask about"). They are
   * answering one question — which words and phrases a question may draw on,
   * and what about them — so they share a card and are separated the way the
   * lists and the rules are: one tinted panel each.
   *
   * A panel whose source is off in step 1 stays on screen and greys out rather
   * than disappearing. An option that vanishes when you untick a source is one
   * you cannot discover, and the greyed pills are what explain why the setting
   * has stopped applying.
   */
  steps.push({
    title: "What to ask about — rules, words & phrases",
    body: (
      <div className="space-y-3">
        <section
          className={sectionClass}
          data-slot="quiz-facet-panel"
          data-source="words"
          data-disabled={!wantsWords}
        >
          <div className="mb-3">
            <p className={cn("text-sm font-medium", !wantsWords && "text-muted-foreground")}>
              Types of words
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {wantsWords
                ? "Words — which parts of speech a question may be drawn from."
                : "Words are off in step 1 — turn them on to use this."}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {POS_OPTIONS.map((option) => (
              <button
                key={option.value || "all"}
                type="button"
                disabled={!wantsWords}
                onClick={() => onChange({ pos: option.value })}
                aria-pressed={config.pos === option.value}
                className={pill(config.pos === option.value, !wantsWords)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        <section
          className={sectionClass}
          data-slot="quiz-facet-panel"
          data-source="lists"
          data-disabled={!wantsLists}
        >
          <div className="mb-3">
            <p className={cn("text-sm font-medium", !wantsLists && "text-muted-foreground")}>
              What to ask about
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {wantsLists
                ? "Words and phrases — the facet each question should test."
                : "Words and phrases are off in step 1 — turn one on to use this."}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {WORD_FOCUS_OPTIONS.map((option) => (
              <Tooltip key={option.value} content={option.hint}>
                <button
                  type="button"
                  disabled={!wantsLists}
                  onClick={() => onChange({ focus: option.value as WordQuizFocus })}
                  aria-pressed={config.focus === option.value}
                  className={pill(config.focus === option.value, !wantsLists)}
                >
                  {option.label}
                </button>
              </Tooltip>
            ))}
          </div>
        </section>
      </div>
    ),
  });

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
        </CardContent>
      </Card>

      {/* The single-setting rows share one "Options" card. */}
      <Card data-slot="quiz-options">
        <CardContent className="p-6">
          <p className="mb-5 text-sm font-semibold">{steps.length + 2} · Options</p>

          <div className="space-y-5">
            {/*
              Moved out of the question-types card. It is a setting like the
              rest of these rows and reads better beside the other dials than
              underneath the pills it describes — and it is still only offered
              when there is more than one type to split.
            */}
            {config.types.length > 1 && (
              <div className={settingRow}>
                <SettingLabel
                  label="How to split them"
                  hint={QUIZ_DISTRIBUTION_HINTS[config.distribution]}
                />
                <div className="flex flex-wrap gap-1.5 sm:justify-end">
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

            {/*
              Only offered once the user has actually missed something — a
              "retry my misses" quiz with no misses would be empty.
            */}
            {missedIds.length > 0 && (
              <div className={settingRow}>
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

            {/*
              Only offered when there is something starred to scope to. Off by
              default: starring an item is a bookmark, not a request to narrow
              every future quiz.
            */}
            {starredIds.size > 0 && (
              <div className={settingRow}>
                <SettingLabel
                  label="Starred items only"
                  hint={
                    <>
                      Draw this quiz only from the {listWords(kindNames)} you have starred —{" "}
                      {starredIds.size} starred. Off by default, so starring something never
                      narrows a quiz on its own.
                    </>
                  }
                />
                <Switch
                  checked={config.starredOnly}
                  onCheckedChange={(next) => onChange({ starredOnly: next })}
                  disabled={config.retryMissed}
                  aria-label="Starred items only"
                />
              </div>
            )}

            <div className={settingRow}>
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

            {/* Seconds sits on the label's line like difficulty: slider right,
                current step beside it. */}
            {config.timeLimitEnabled && (
              <div className={settingRow}>
                <SettingLabel
                  label="Seconds per question"
                  hint="How long to allow for each question."
                />
                <div className="flex items-center gap-3 sm:shrink-0">
                  <Slider
                    className="w-36 flex-1 sm:w-52 sm:flex-none"
                    aria-label="Seconds per question"
                    aria-valuetext={`${config.timeLimitSeconds} seconds`}
                    value={[Math.max(0, QUIZ_TIME_LIMITS.indexOf(config.timeLimitSeconds))]}
                    min={0}
                    max={QUIZ_TIME_LIMITS.length - 1}
                    step={1}
                    onValueChange={([index]) => {
                      const seconds = QUIZ_TIME_LIMITS[index];
                      if (seconds !== undefined) onChange({ timeLimitSeconds: seconds });
                    }}
                  />
                  <span className="w-14 text-right text-sm font-medium text-primarylw">
                    {config.timeLimitSeconds}s
                  </span>
                </div>
              </div>
            )}

            {/* Length and difficulty are the two "how much / how hard" dials,
                so they sit together at the end of the card, both sliders over a
                fixed ladder. The count used to be a Select up with the toggles;
                as a ladder slider it reads the same way as its neighbours. */}
            <div className={settingRow}>
              <SettingLabel
                label="Number of questions"
                hint="How many questions the AI should write for this quiz."
              />
              <div className="flex items-center gap-3 sm:shrink-0">
                <Slider
                  className="w-36 flex-1 sm:w-52 sm:flex-none"
                  aria-label="Number of questions"
                  aria-valuetext={`${config.questionCount} questions`}
                  // `Math.max(0, …)`: an off-ladder value (a config saved before
                  // the ladder changed) would otherwise give index -1 and put
                  // the thumb off the track. `normalizeConfig` snaps on load;
                  // this is the belt to its braces.
                  value={[Math.max(0, QUIZ_SIZES.indexOf(config.questionCount))]}
                  min={0}
                  max={QUIZ_SIZES.length - 1}
                  step={1}
                  onValueChange={([index]) => {
                    const size = QUIZ_SIZES[index];
                    if (size !== undefined) onChange({ questionCount: size });
                  }}
                />
                <span className="w-14 text-right text-sm font-medium text-primarylw">
                  {config.questionCount}
                </span>
              </div>
            </div>

            {/* Difficulty sits on the label's line, like every other row: the
                slider to the right of the name, with its current step beside it. */}
            <div className={settingRow}>
              <SettingLabel label="Difficulty" hint={QUIZ_DIFFICULTY_HINTS[config.difficulty]} />
              <div className="flex items-center gap-3 sm:shrink-0">
                <Slider
                  className="w-36 flex-1 sm:w-52 sm:flex-none"
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
            {config.starredOnly && !config.retryMissed ? " · ★ starred only" : ""}
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
