import * as React from "react";
import { useNavigate } from "react-router";
import { FolderOpen, GraduationCap, ListChecks, Save } from "lucide-react";

import type { TagInfo, WordListSummary } from "~/lib/db.server";
import { useStarredIds, type StarredIds } from "~/lib/use-stars";
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
import { Switch } from "~/components/lightswind/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/lightswind/tabs";
import { toast } from "~/components/lightswind/toast";
import { Tooltip } from "~/components/lightswind/tooltip";
import { cn } from "~/lib/utils";
import {
  DEFAULT_STUDY_CONFIG,
  FRONT_READING_KEY,
  loadPreference,
  loadSessions,
  loadStudyConfigs,
  newSessionId,
  replaceSessionsOfKind,
  REPETITION_KEY,
  savePreference,
  saveSessions,
  saveStudyConfigs,
  sessionsOfKind,
  STUDY_KIND_LABELS,
  type SavedSession,
  type StudyConfig,
  type StudyConfigs,
  type StudyKind,
  type StudyRuleKind,
} from "~/lib/study-prefs";

/** Only the types a word-only deck can be narrowed to (phrases live in their own tab). */
const POS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "noun", label: "Nouns" },
  { value: "verb", label: "Verbs" },
  { value: "adjective", label: "Adjectives" },
  { value: "adverb", label: "Adverbs" },
];

const RULE_KIND_OPTIONS: { value: StudyRuleKind; label: string }[] = [
  { value: "", label: "All rules" },
  { value: "word", label: "Word rules / forms" },
  { value: "sentence", label: "Sentence rules" },
];

const DECK_SIZES = [10, 20, 40, 100];

const OPTION_ORDER: StudyKind[] = ["words", "phrases", "forms"];

const pill = (active: boolean) =>
  cn(
    "cursor-pointer rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
    active
      ? "border-primarylw bg-primarylw/15 text-primarylw"
      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
  );

/** One-line summary of what a saved session will drill. */
function describeSession(session: SavedSession): string {
  const parts: string[] = [];
  if (session.kind === "forms") {
    parts.push(
      session.ruleKind
        ? session.ruleKind === "word"
          ? "word rules only"
          : "sentence rules only"
        : "all rules"
    );
  } else {
    parts.push(
      session.lists.length > 0
        ? `${session.lists.length} list${session.lists.length === 1 ? "" : "s"}`
        : session.tags.length > 0
          ? `tags: ${session.tags.map((tag) => `#${tag}`).join(" ")}`
          : "all lists"
    );
    if (session.pos) parts.push(session.pos);
  }
  if (session.important) parts.push("★ starred only");
  parts.push(session.fixedSize ? "all cards" : `${session.limit} cards`);
  // Only the off-default is worth a word: a shuffled deck needs no saying.
  if (!session.shuffle) parts.push("in list order");
  return parts.join(" · ");
}

/**
 * Study session configurator with three independent sections — words, phrases
 * and grammar forms. Each tab keeps its own selection *and* its own saved
 * sessions, so switching tabs never mixes decks up.
 *
 * The source-selection steps get a card each; the single-setting choices
 * (priority, deck size and order, review schedule) share one "Options" card
 * instead of one near-empty card each.
 */
export function StudySetup({
  wordLists,
  phraseLists,
  tags,
  ruleTags,
  ruleCounts,
  preselectedLists,
  initialKind,
}: {
  wordLists: WordListSummary[];
  phraseLists: WordListSummary[];
  tags: TagInfo[];
  ruleTags: TagInfo[];
  ruleCounts: { all: number; word: number; sentence: number };
  preselectedLists: number[];
  initialKind: StudyKind;
}) {
  const [configs, setConfigs] = React.useState<StudyConfigs>(() => ({
    words: { ...DEFAULT_STUDY_CONFIG, lists: preselectedLists },
    phrases: { ...DEFAULT_STUDY_CONFIG },
    forms: { ...DEFAULT_STUDY_CONFIG },
  }));
  const [sessions, setSessions] = React.useState<SavedSession[]>(() => loadSessions());
  const [repetition, setRepetition] = React.useState(
    () => loadPreference(REPETITION_KEY, "1", ["1", "0"]) === "1"
  );
  // Read after the first render, so the switch is not rendered from a value the
  // server could not have known (see `Flashcards`, which reads the same key).
  const [frontReading, setFrontReading] = React.useState(true);
  React.useEffect(() => {
    setFrontReading(loadPreference(FRONT_READING_KEY, "1", ["1", "0"]) === "1");
  }, []);

  /**
   * The remembered config, for the same reason and at the same cost as the
   * switch above: the server cannot read localStorage, so a config read during
   * render makes the client paint a tree the server did not — measured as one
   * hydration failure per visit, with React discarding the whole builder. The
   * price is one frame of the default config, paid only by a user who has
   * changed something.
   *
   * Runs once: a deep link's lists win over the remembered ones on the way in,
   * and the state below belongs to the user from then on.
   */
  React.useEffect(() => {
    const stored = loadStudyConfigs();
    setConfigs({
      words: {
        ...stored.words,
        lists: preselectedLists.length > 0 ? preselectedLists : stored.words.lists,
      },
      phrases: stored.phrases,
      forms: stored.forms,
    });
  }, []);
  // Stars are per-user and live in Convex, so they only arrive in the browser.
  const starred = useStarredIds();

  const updateConfig = (kind: StudyKind, patch: Partial<StudyConfig>) =>
    setConfigs((prev) => {
      const next = { ...prev, [kind]: { ...prev[kind], ...patch } };
      saveStudyConfigs(next);
      return next;
    });

  const updateSessions = (kind: StudyKind, next: SavedSession[]) => {
    const merged = replaceSessionsOfKind(sessions, kind, next);
    setSessions(merged);
    saveSessions(merged);
  };

  const toggleRepetition = () => {
    const next = !repetition;
    setRepetition(next);
    savePreference(REPETITION_KEY, next ? "1" : "0");
  };

  const toggleFrontReading = () => {
    const next = !frontReading;
    setFrontReading(next);
    savePreference(FRONT_READING_KEY, next ? "1" : "0");
  };

  return (
    <Tabs defaultValue={initialKind}>
      <TabsList className="mb-2">
        {OPTION_ORDER.map((kind) => (
          <TabsTrigger key={kind} value={kind}>
            {STUDY_KIND_LABELS[kind]}
          </TabsTrigger>
        ))}
      </TabsList>

      {OPTION_ORDER.map((kind) => (
        <TabsContent key={kind} value={kind}>
          <StudyPanel
            kind={kind}
            lists={kind === "phrases" ? phraseLists : wordLists}
            tags={tags}
            ruleTags={ruleTags}
            ruleCounts={ruleCounts}
            config={configs[kind]}
            onChange={(patch) => updateConfig(kind, patch)}
            starred={starred}
            sessions={sessionsOfKind(sessions, kind)}
            onSessionsChange={(next) => updateSessions(kind, next)}
            repetition={repetition}
            onToggleRepetition={toggleRepetition}
            frontReading={frontReading}
            onToggleFrontReading={toggleFrontReading}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}

function StudyPanel({
  kind,
  lists,
  tags,
  ruleTags,
  ruleCounts,
  config,
  onChange,
  starred,
  sessions,
  onSessionsChange,
  repetition,
  onToggleRepetition,
  frontReading,
  onToggleFrontReading,
}: {
  kind: StudyKind;
  lists: WordListSummary[];
  tags: TagInfo[];
  ruleTags: TagInfo[];
  ruleCounts: { all: number; word: number; sentence: number };
  config: StudyConfig;
  onChange: (patch: Partial<StudyConfig>) => void;
  starred: StarredIds;
  sessions: SavedSession[];
  onSessionsChange: (next: SavedSession[]) => void;
  repetition: boolean;
  onToggleRepetition: () => void;
  frontReading: boolean;
  onToggleFrontReading: () => void;
}) {
  const navigate = useNavigate();
  const isForms = kind === "forms";
  // Rules are tagged separately from word/phrase lists.
  const panelTags = isForms ? ruleTags : tags;
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [loadOpen, setLoadOpen] = React.useState(false);
  const [sessionName, setSessionName] = React.useState("");

  // Lists matching the tag selection (any selected tag).
  const tagFiltered =
    config.tags.length === 0
      ? lists
      : lists.filter((list) => list.tags.some((tag) => config.tags.includes(tag)));

  // Explicitly chosen lists win; otherwise every tag-matched list is in scope.
  const eligible =
    config.lists.length > 0
      ? tagFiltered.filter((list) => config.lists.includes(list.id))
      : tagFiltered;

  // The user's starred ids for this section. Stars are per-user, so the count
  // is the whole library rather than the current selection — the deck itself is
  // still narrowed to whichever of them fall inside the scope.
  const starredIds = isForms ? starred.rules : starred.words;

  // The priority filter narrows the deck to the starred cards only.
  const matchCount = isForms
    ? config.important
      ? starredIds.size
      : config.ruleKind
        ? ruleCounts[config.ruleKind]
        : ruleCounts.all
    : config.important
      ? starredIds.size
      : eligible.reduce((sum, list) => sum + list.wordCount, 0);

  const noun = isForms ? "rule" : kind === "phrases" ? "phrase" : "word";

  // A fixed deck has no size to name; it is whatever the selection holds.
  const deckLabel = config.fixedSize ? "all cards" : `${config.limit} cards`;
  const suggestedName = isForms
    ? `${config.ruleKind ? RULE_KIND_OPTIONS.find((o) => o.value === config.ruleKind)?.label : "All rules"} · ${deckLabel}`
    : `${eligible.length} list${eligible.length === 1 ? "" : "s"}${config.pos ? ` · ${config.pos}` : ""} · ${deckLabel}`;

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

  // "Select all" is a lists-only control: it acts on the word/phrase lists the
  // section offers and sits in the top-right of that card, not on a row of its
  // own above the steps.
  const selectableLists = tagFiltered
    .filter((list) => list.wordCount > 0)
    .map((list) => list.id);
  const allListsSelected =
    selectableLists.length > 0 && selectableLists.every((id) => config.lists.includes(id));
  const toggleSelectAllLists = () =>
    onChange({ lists: allListsSelected ? [] : selectableLists });

  /**
   * Small "select all / clear" pill for the lists card's header. It is always
   * rendered there, just disabled while there is nothing to select yet.
   */
  const selectAllPill = (all: boolean, onToggle: () => void, label: string, empty = false) => (
    <button
      type="button"
      onClick={onToggle}
      disabled={empty}
      data-slot="study-select-all"
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
    const session: SavedSession = {
      id: newSessionId(),
      name: name.slice(0, 60),
      kind,
      lists: config.lists,
      tags: config.tags,
      pos: config.pos,
      ruleKind: config.ruleKind,
      important: config.important,
      limit: config.limit,
      fixedSize: config.fixedSize,
      shuffle: config.shuffle,
      createdAt: Date.now(),
    };
    onSessionsChange([session, ...sessions].slice(0, 30));
    setSaveOpen(false);
    setSessionName("");
    toast({ title: `Saved “${session.name}”`, description: describeSession(session), variant: "success" });
  };

  const deleteSession = (id: string) => {
    const removed = sessions.find((session) => session.id === id);
    onSessionsChange(sessions.filter((session) => session.id !== id));
    if (removed) toast({ title: `Deleted “${removed.name}”`, variant: "info" });
  };

  const loadSession = (session: SavedSession) => {
    onChange({
      lists: session.lists,
      tags: session.tags,
      pos: session.pos,
      ruleKind: session.ruleKind,
      important: session.important,
      limit: session.limit,
      fixedSize: session.fixedSize,
      shuffle: session.shuffle,
    });
    setLoadOpen(false);
    toast({ title: `Loaded “${session.name}”`, description: describeSession(session), variant: "info" });
  };

  const start = () => {
    if (matchCount === 0) return;
    // "all" is the fixed deck: the session loader draws the whole selection
    // instead of a sample of it.
    const qs = new URLSearchParams({
      kind,
      limit: config.fixedSize ? "all" : String(config.limit),
    });
    // Absent means shuffled, so only the off case needs saying.
    if (!config.shuffle) qs.set("shuffle", "0");
    // A starred-only deck is drawn from the user's starred ids; the server
    // intersects them with the selected lists / kind / part of speech.
    if (config.important) qs.set("starredIds", [...starredIds].join(","));
    if (isForms) {
      if (config.ruleKind) qs.set("ruleKind", config.ruleKind);
      if (config.tags.length > 0) qs.set("tags", config.tags.join(","));
    } else {
      if (config.lists.length > 0) qs.set("lists", config.lists.join(","));
      if (config.tags.length > 0) qs.set("tags", config.tags.join(","));
      if (kind === "words" && config.pos) qs.set("pos", config.pos);
    }
    navigate(`/study/flashcards/session?${qs.toString()}`);
  };

  // Tag chips are shared by every section (rules have their own tag set, so
  // `panelTags` picks the right one).
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

  // The numbered steps differ per section, so build them as a list. Tags are
  // always the first step — the same order on every tab — and the lists step on
  // words/phrases carries the "select all" pill in its card header.
  const steps: { title: string; body: React.ReactNode; action?: React.ReactNode }[] = [];

  if (isForms) {
    // No "select all" here: rules are a flat collection with no list picker, so
    // their tags are the only multi-select — a select-all on them reads like it
    // selects the rules themselves. The pill stays a lists-only control.
    steps.push({ title: "Tags (optional)", body: tagsStepBody });

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
                {option.value ? ruleCounts[option.value] : ruleCounts.all}
              </span>
            </button>
          ))}
        </div>
      ),
    });
  } else {
    steps.push({ title: "Tags (optional)", body: tagsStepBody });

    steps.push({
      title: kind === "phrases" ? "Phrase lists" : "Word lists",
      action: selectAllPill(
        allListsSelected,
        toggleSelectAllLists,
        "Select all lists",
        selectableLists.length === 0
      ),
      body:
        tagFiltered.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {lists.length === 0
              ? `No ${kind === "phrases" ? "phrase" : "word"} lists yet — create one and it appears here.`
              : "No lists match the selected tags."}
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {tagFiltered.map((list) => {
              const active = config.lists.includes(list.id);
              const disabled = list.wordCount === 0;
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
                    {list.wordCount}
                  </Badge>
                </button>
              );
            })}
          </div>
        ),
    });

    if (kind === "words") {
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
  }

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

      {/*
        One card, one row per setting, and the help text lives in a hover
        tooltip instead of a paragraph — no dividers needed to separate the
        single-control rows.
      */}
      <Card>
        <CardContent className="p-6">
          <p className="mb-5 text-sm font-semibold">{steps.length + 1} · Options</p>

          <div className="space-y-5">
            <div className="flex items-center justify-between gap-4">
              <SettingLabel
                label="Starred only"
                hint={
                  <>
                    Drills only the cards you starred with the ★ button inside a list (or on the
                    rules page).{" "}
                    {isForms
                      ? `${starredIds.size} rule${starredIds.size === 1 ? "" : "s"} starred so far.`
                      : `${starredIds.size} starred card${starredIds.size === 1 ? "" : "s"} in your library.`}{" "}
                    Only the ones inside the selection above are drawn.
                  </>
                }
              />
              <Switch
                checked={config.important}
                onCheckedChange={(next) => onChange({ important: next })}
                aria-label="Starred only"
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <SettingLabel
                label="Spaced repetition"
                hint={`Cards you answer "Again" on come back more often, at growing intervals.`}
              />
              <Switch
                checked={repetition}
                onCheckedChange={onToggleRepetition}
                aria-label="Spaced repetition"
              />
            </div>

            {/*
              Words and phrases only: a rule card asks about a ポイント, and its
              title is not a reading of that, so the switch has nothing to act
              on. A control that cannot apply is not offered.
            */}
            {!isForms && (
              <div className="flex items-center justify-between gap-4">
                <SettingLabel
                  label="Reading on the front"
                  hint="Shows the kana under the word on the question side, so a kanji word can be attempted without guessing how it is said. A card already written in kana gains nothing, and a card asking for the word never shows the reading — there it is half the answer."
                />
                <Switch
                  checked={frontReading}
                  onCheckedChange={onToggleFrontReading}
                  aria-label="Reading on the front"
                />
              </div>
            )}

            <div className="flex items-center justify-between gap-4">
              <SettingLabel
                label="Fixed deck size"
                hint={`Draws every ${noun} in the current selection, so nothing is left out and there is no deck size to pick. Off, the deck is a sample of the chosen size.`}
              />
              <Switch
                checked={config.fixedSize}
                onCheckedChange={(next) => onChange({ fixedSize: next })}
                aria-label="Fixed deck size"
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <SettingLabel
                label="Shuffle deck"
                hint="Deals the cards in a random order. Turn it off to study them in the order the list shows them — the order of the words in a list, the points in a rule, the rules on the rules page."
              />
              <Switch
                checked={config.shuffle}
                onCheckedChange={(next) => onChange({ shuffle: next })}
                aria-label="Shuffle deck"
              />
            </div>

            {/*
              Last, so the row it removes sits under the switch that removes it:
              a fixed deck is whatever the selection holds, so the size is only a
              question while the deck is sized. The stored limit survives the
              toggle, so turning it back off restores the size picked before.
            */}
            {!config.fixedSize && (
              <div className="flex items-center justify-between gap-4">
                <SettingLabel
                  label="Deck size"
                  hint="How many cards to draw for this session."
                />
                <div className="flex flex-wrap justify-end gap-1.5">
                  {DECK_SIZES.map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => onChange({ limit: size })}
                      aria-pressed={config.limit === size}
                      className={pill(config.limit === size)}
                    >
                      {size} cards
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Summary + save / load / start */}
      <div className="flex flex-col items-center justify-between gap-4 rounded-[var(--radius)] border border-primarylw/40 bg-card p-6 md:flex-row">
        <div className="text-center md:text-left">
          <p className="font-semibold">
            {isForms
              ? config.important
                ? `★ Your starred rules${config.ruleKind ? ` · ${config.ruleKind} only` : ""}`
                : `${matchCount} ${noun}${matchCount === 1 ? "" : "s"}${config.ruleKind ? ` · ${config.ruleKind} rules only` : ""}`
              : config.important
                ? `${eligible.length} list${eligible.length === 1 ? "" : "s"} · ★ your starred ${noun}s`
                : `${eligible.length} list${eligible.length === 1 ? "" : "s"} · ≈${matchCount} matching ${noun}s${config.pos ? ` · ${config.pos} only` : ""}`}
          </p>
          <p className="text-xs text-muted-foreground">
            {config.fixedSize ? "Every" : `Up to ${config.limit}`}{" "}
            {config.important ? "starred " : ""}
            {config.pos ? `${config.pos} ` : ""}
            {config.fixedSize ? "card in your selection." : "cards from your selection."}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Drawer open={saveOpen} onOpenChange={openSaveDrawer}>
            <Tooltip content="Save this configuration to reuse later">
              <DrawerTrigger asChild>
                <Button variant="outline" disabled={matchCount === 0}>
                  <Save /> Save session
                </Button>
              </DrawerTrigger>
            </Tooltip>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>Save session</DrawerTitle>
                <DrawerDescription>
                  Store this {noun} configuration to reuse later.
                </DrawerDescription>
              </DrawerHeader>
              <form
                className="space-y-4 px-4 pb-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveCurrentSession();
                }}
              >
                <div>
                  <Label htmlFor={`${kind}-session-name`}>Session name</Label>
                  <Input
                    id={`${kind}-session-name`}
                    value={sessionName}
                    onChange={(event) => setSessionName(event.target.value)}
                    placeholder="e.g. N5 verbs, 20 cards"
                    maxLength={60}
                    required
                    className="mt-2"
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    Saved in this browser only, under this tab.
                  </p>
                </div>
                <Button type="submit" disabled={!sessionName.trim()}>
                  <Save /> Save session
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
            <Tooltip content="Load a saved session">
              <DrawerTrigger asChild>
                <Button variant="outline" disabled={sessions.length === 0}>
                  <FolderOpen /> Load
                </Button>
              </DrawerTrigger>
            </Tooltip>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>Saved sessions</DrawerTitle>
                <DrawerDescription>
                  Drag the handle to reorder, or tap a session to load it into this tab.
                </DrawerDescription>
              </DrawerHeader>
              <div className="px-4 pb-2">
                {sessions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No saved {noun} sessions yet.
                  </p>
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
                          removeLabel={`Delete saved session ${session.name}`}
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
                              {describeSession(session)}
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

          <Button size="lg" onClick={start} disabled={matchCount === 0}>
            <GraduationCap /> Start studying
          </Button>
        </div>
      </div>
    </div>
  );
}