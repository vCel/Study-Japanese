import * as React from "react";
import { useNavigate } from "react-router";
import { FolderOpen, GraduationCap, RotateCcw, Save, Tags, Trash2 } from "lucide-react";

import type { TagInfo, WordListSummary } from "~/lib/db.server";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/lightswind/tabs";
import { toast } from "~/components/lightswind/toast";
import { cn } from "~/lib/utils";
import {
  DEFAULT_STUDY_CONFIG,
  loadPreference,
  loadSessions,
  newSessionId,
  replaceSessionsOfKind,
  REPETITION_KEY,
  savePreference,
  saveSessions,
  sessionsOfKind,
  STUDY_KIND_LABELS,
  type SavedSession,
  type StudyConfig,
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
  parts.push(`${session.limit} cards`);
  return parts.join(" · ");
}

/**
 * Study session configurator with three independent sections — words, phrases
 * and grammar forms. Each tab keeps its own selection *and* its own saved
 * sessions, so switching tabs never mixes decks up.
 */
export function StudySetup({
  wordLists,
  phraseLists,
  tags,
  ruleCounts,
  preselectedLists,
  initialKind,
}: {
  wordLists: WordListSummary[];
  phraseLists: WordListSummary[];
  tags: TagInfo[];
  ruleCounts: { all: number; word: number; sentence: number };
  preselectedLists: number[];
  initialKind: StudyKind;
}) {
  const [configs, setConfigs] = React.useState<Record<StudyKind, StudyConfig>>(() => ({
    words: { ...DEFAULT_STUDY_CONFIG, lists: preselectedLists },
    phrases: { ...DEFAULT_STUDY_CONFIG },
    forms: { ...DEFAULT_STUDY_CONFIG },
  }));
  const [sessions, setSessions] = React.useState<SavedSession[]>(() => loadSessions());
  const [repetition, setRepetition] = React.useState(
    () => loadPreference(REPETITION_KEY, "1", ["1", "0"]) === "1"
  );

  const updateConfig = (kind: StudyKind, patch: Partial<StudyConfig>) =>
    setConfigs((prev) => ({ ...prev, [kind]: { ...prev[kind], ...patch } }));

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
            ruleCounts={ruleCounts}
            config={configs[kind]}
            onChange={(patch) => updateConfig(kind, patch)}
            sessions={sessionsOfKind(sessions, kind)}
            onSessionsChange={(next) => updateSessions(kind, next)}
            repetition={repetition}
            onToggleRepetition={toggleRepetition}
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
  ruleCounts,
  config,
  onChange,
  sessions,
  onSessionsChange,
  repetition,
  onToggleRepetition,
}: {
  kind: StudyKind;
  lists: WordListSummary[];
  tags: TagInfo[];
  ruleCounts: { all: number; word: number; sentence: number };
  config: StudyConfig;
  onChange: (patch: Partial<StudyConfig>) => void;
  sessions: SavedSession[];
  onSessionsChange: (next: SavedSession[]) => void;
  repetition: boolean;
  onToggleRepetition: () => void;
}) {
  const navigate = useNavigate();
  const isForms = kind === "forms";
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

  const matchCount = isForms
    ? config.ruleKind
      ? ruleCounts[config.ruleKind]
      : ruleCounts.all
    : eligible.reduce((sum, list) => sum + list.wordCount, 0);

  const noun = isForms ? "rule" : kind === "phrases" ? "phrase" : "word";

  const suggestedName = isForms
    ? `${config.ruleKind ? RULE_KIND_OPTIONS.find((o) => o.value === config.ruleKind)?.label : "All rules"} · ${config.limit} cards`
    : `${eligible.length} list${eligible.length === 1 ? "" : "s"}${config.pos ? ` · ${config.pos}` : ""} · ${config.limit} cards`;

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
      limit: config.limit,
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
      limit: session.limit,
    });
    setLoadOpen(false);
    toast({ title: `Loaded “${session.name}”`, description: describeSession(session), variant: "info" });
  };

  const start = () => {
    if (matchCount === 0) return;
    const qs = new URLSearchParams({ kind, limit: String(config.limit) });
    if (isForms) {
      if (config.ruleKind) qs.set("ruleKind", config.ruleKind);
    } else {
      if (config.lists.length > 0) qs.set("lists", config.lists.join(","));
      if (config.tags.length > 0) qs.set("tags", config.tags.join(","));
      if (kind === "words" && config.pos) qs.set("pos", config.pos);
    }
    navigate(`/study/session?${qs.toString()}`);
  };

  // The numbered steps differ per section, so build them as a list.
  const steps: { title: string; body: React.ReactNode }[] = [];

  if (isForms) {
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
    steps.push({
      title: "Tags (optional)",
      body:
        tags.length === 0 ? (
          <p className="text-xs text-muted-foreground">No tags in the collection yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => {
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
        ),
    });

    steps.push({
      title: kind === "phrases" ? "Phrase lists" : "Word lists",
      body:
        tagFiltered.length === 0 ? (
          <p className="text-xs text-muted-foreground">No lists match the selected tags.</p>
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

  steps.push({
    title: "Deck size",
    body: (
      <div className="flex flex-wrap gap-1.5">
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
    ),
  });

  steps.push({
    title: "Review schedule",
    body: (
      <>
        <button
          type="button"
          onClick={onToggleRepetition}
          aria-pressed={repetition}
          className={cn(
            "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
            repetition
              ? "border-primarylw/50 bg-primarylw/15 text-primarylw"
              : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
          title="Spaced repetition: cards you struggle with come back more often, at growing intervals"
        >
          <RotateCcw className="h-4 w-4" />
          Spaced repetition {repetition ? "on" : "off"}
        </button>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Cards you answer "Again" on are rescheduled at growing intervals and come back more
          often.
        </p>
      </>
    ),
  });

  return (
    <div className="space-y-6">
      {steps.map((step, index) => (
        <Card key={step.title}>
          <CardContent className="p-6">
            <p className="mb-3 text-sm font-semibold">
              {index + 1} · {step.title}
            </p>
            {step.body}
          </CardContent>
        </Card>
      ))}

      {/* Summary + save / load / start */}
      <div className="flex flex-col items-center justify-between gap-4 rounded-[var(--radius)] border border-primarylw/40 bg-card p-6 md:flex-row">
        <div className="text-center md:text-left">
          <p className="font-semibold">
            {isForms
              ? `${matchCount} ${noun}${matchCount === 1 ? "" : "s"}${config.ruleKind ? ` · ${config.ruleKind} rules only` : ""}`
              : `${eligible.length} list${eligible.length === 1 ? "" : "s"} · ≈${matchCount} matching ${noun}s${config.pos ? ` · ${config.pos} only` : ""}`}
          </p>
          <p className="text-xs text-muted-foreground">
            Deck of up to {config.limit} random {config.pos ? `${config.pos} ` : ""}cards, drawn
            from your selection.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Drawer open={saveOpen} onOpenChange={openSaveDrawer}>
            <DrawerTrigger asChild>
              <Button
                variant="outline"
                disabled={matchCount === 0}
                title="Save this configuration to reuse later"
              >
                <Save /> Save session
              </Button>
            </DrawerTrigger>
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
            <DrawerTrigger asChild>
              <Button variant="outline" title="Load a saved session" disabled={sessions.length === 0}>
                <FolderOpen /> Load
              </Button>
            </DrawerTrigger>
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