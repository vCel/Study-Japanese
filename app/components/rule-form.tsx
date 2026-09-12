import * as React from "react";
import { Form, useActionData, useNavigate, useNavigation } from "react-router";
import { useAuthToken } from "@convex-dev/auth/react";
import { Plus, Trash2, X } from "lucide-react";

// Both the create and the edit form gate on the same check — the env-var one
// (`isAuthConfigured`), not the browser-only client instance. The server has no
// Convex client, so gating on that made the server render "auth is not
// configured" while the browser rendered the form: a hydration mismatch that
// made React discard and re-render the whole tree.
import { isAuthConfigured as isConvexClientConfigured } from "~/components/convex-provider";
import { Button } from "~/components/lightswind/button";
import { Badge } from "~/components/lightswind/badge";
import { Card, CardContent } from "~/components/lightswind/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "~/components/lightswind/accordion";
import { Input, Label, Textarea } from "~/components/lightswind/input";
import { ReorderList, ReorderRow } from "~/components/lightswind/reorder";
import { JsonFillAccordion } from "~/components/json-fill-accordion";
import { FormMessage } from "~/components/form-message";
import { okMessage, useActionToast } from "~/components/action-toast";
import { useReturnTo } from "~/lib/return-to";
import { RulePoint } from "~/components/rule-point";
import { SelectField } from "~/components/select-field";
import { toast } from "~/components/lightswind/toast";
import { cn } from "~/lib/utils";
import type { RuleDetail, RuleKind } from "~/lib/db.server";
import {
  draftToRulePayload,
  EMPTY_RULE_DRAFT,
  MAX_POINTS,
  parseRuleJson,
  type RuleDraft,
} from "~/lib/rule-draft";

export interface RuleFormActionData {
  ok: boolean;
  error?: string;
  ruleId?: number;
  created?: number;
  deleted?: boolean;
}

/** Lets the route's delete button submit this form from outside it. */
export const RULE_FORM_ID = "rule-form";

/** A rule as offered by the "related rules" picker. */
export interface RuleOption {
  id: number;
  title: string;
}

export const RULES_SAMPLE_JSON = `[
  {
    "kind": "word",
    "title": "Polite て-form",
    "points": ["Verb て-form", "Drop ます and add て"],
    "explanation": "The て-form connects clauses and forms requests.",
    "examples": [
      { "japanese": "食べてください。", "english": "Please eat." }
    ]
  }
]`;

const KIND_OPTIONS = [
  { value: "word", label: "Word rule / form" },
  { value: "sentence", label: "Sentence rule" },
];

/** One editable example row inside a draft. */
interface ExampleRow {
  id: string;
  japanese: string;
  english: string;
}

/** One editable ポイント (point!) row inside a draft. */
interface PointRow {
  id: string;
  value: string;
}

/** A draft plus the row ids / accordion key the UI needs. */
interface Draft extends Omit<RuleDraft, "examples" | "points"> {
  id: string;
  points: PointRow[];
  examples: ExampleRow[];
}

let draftCounter = 0;
let pointCounter = 0;

function nextPointId(): string {
  pointCounter += 1;
  return `point-${pointCounter}`;
}

function toDraft(draft: RuleDraft): Draft {
  draftCounter += 1;
  const key = draftCounter;
  const points = draft.points.slice(0, MAX_POINTS).map((value) => ({
    id: nextPointId(),
    value,
  }));
  return {
    ...draft,
    id: `rule-${key}`,
    // Keep one (possibly empty) row so the first ポイント callout is always
    // visible, mirroring the rule page.
    points: points.length > 0 ? points : [{ id: nextPointId(), value: "" }],
    examples: draft.examples.map((example, index) => ({
      id: `x${index}-${key}`,
      japanese: example.japanese,
      english: example.english,
    })),
  };
}

/** The plain, serialisable draft behind the UI rows. */
function toRuleDraft(draft: Draft): RuleDraft {
  return {
    kind: draft.kind,
    title: draft.title,
    explanation: draft.explanation,
    tags: draft.tags,
    points: draft.points.map((point) => point.value),
    examples: draft.examples.map((example) => ({
      japanese: example.japanese,
      english: example.english,
    })),
    relatedIds: draft.relatedIds,
  };
}

/** What the server receives (row ids are UI-only, so they're dropped). */
function serialize(drafts: Draft[]): string {
  return JSON.stringify(
    drafts.map((draft) => {
      const plain = toRuleDraft(draft);
      return {
        ...plain,
        examples: plain.examples.filter((example) => example.japanese.trim().length > 0),
      };
    })
  );
}

/**
 * The fields for a single rule. Shared by the edit form (one rule) and the
 * create form (many rules, one per accordion), so both look identical.
 */
/**
 * One field group inside a rule. Standalone pages (the edit form) get a card;
 * inside the create form's accordion panel the groups are separated by dividers
 * instead, so the panel stays the only surface.
 *
 * Declared at module scope on purpose: a component defined *during* render is a
 * new element type on every pass, which remounts the inputs underneath and makes
 * typing drop focus after each keystroke.
 */
function RuleGroup({
  flat,
  className,
  children,
}: {
  flat: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  if (!flat) {
    return (
      <Card>
        <CardContent className={cn("p-6", className)}>{children}</CardContent>
      </Card>
    );
  }
  return (
    <div className={cn("border-t border-border pt-5 first:border-t-0 first:pt-0", className)}>
      {children}
    </div>
  );
}

function RuleFields({
  draft,
  idPrefix,
  index,
  onChange,
  flat = false,
  ruleOptions,
  selfId,
}: {
  draft: Draft;
  idPrefix: string;
  /** Shown in the labels only when there is more than one rule. */
  index?: number;
  onChange: (patch: Partial<Draft>) => void;
  /**
   * Inside the create form each rule already sits in an accordion panel — a card
   * of its own — so the field groups are separated by dividers rather than
   * wrapped in a second layer of boxes.
   */
  flat?: boolean;
  /** Every rule, for the "related rules" picker. */
  ruleOptions?: RuleOption[];
  /** On the edit form, the rule being edited — it cannot relate to itself. */
  selfId?: number;
}) {
  const suffix = index === undefined ? "" : ` ${index + 1}`;
  const id = (name: string) => `${idPrefix}-${name}`;

  const options = (ruleOptions ?? []).filter((option) => option.id !== selfId);
  const related = options.filter((option) => draft.relatedIds.includes(option.id));
  const addableOptions = options
    .filter((option) => !draft.relatedIds.includes(option.id))
    .map((option) => ({ value: String(option.id), label: option.title }));

  const updateExample = (rowId: string, patch: Partial<ExampleRow>) =>
    onChange({
      examples: draft.examples.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    });

  const updatePoint = (rowId: string, value: string) =>
    onChange({
      points: draft.points.map((row) => (row.id === rowId ? { ...row, value } : row)),
    });

  return (
    <div className="space-y-5">
      {/* Metadata — the rule page header, but editable */}
      <RuleGroup flat={flat} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor={id("kind")}>Rule type *</Label>
            <SelectField
              id={id("kind")}
              ariaLabel={`Rule type${suffix}`}
              value={draft.kind}
              onValueChange={(kind) =>
                onChange({ kind: kind === "sentence" ? "sentence" : "word" })
              }
              className="mt-2"
              options={KIND_OPTIONS}
            />
          </div>
          <div>
            <Label htmlFor={id("tags")}>Tags (comma separated)</Label>
            <Input
              id={id("tags")}
              value={draft.tags}
              onChange={(event) => onChange({ tags: event.target.value })}
              placeholder="e.g. verbs, jlpt"
              className="mt-2"
            />
          </div>
        </div>

        <div>
          <Label htmlFor={id("title")}>Title *</Label>
          <Input
            id={id("title")}
            value={draft.title}
            onChange={(event) => onChange({ title: event.target.value })}
            required
            maxLength={120}
            placeholder="e.g. Polite ます-form"
            className="mt-2"
          />
        </div>
      </RuleGroup>

      {/* The same ポイント callouts the rule page renders, one input each */}
      <RuleGroup flat={flat} className="space-y-5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">
            Points{" "}
            <span className="font-normal text-muted-foreground">
              ({draft.points.length}/{MAX_POINTS})
            </span>
          </p>
          <button
            type="button"
            className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-primarylw hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
            disabled={draft.points.length >= MAX_POINTS}
            onClick={() =>
              onChange({
                points: [...draft.points, { id: nextPointId(), value: "" }],
              })
            }
          >
            <Plus className="h-3.5 w-3.5" /> Add point
          </button>
        </div>
        {draft.points.map((point, pointIndex) => (
          <div key={point.id} className="relative">
            <RulePoint>
              <Label htmlFor={id(`point-${pointIndex}`)} className="sr-only">
                {`Point ${pointIndex + 1}`}
              </Label>
              <Input
                id={id(`point-${pointIndex}`)}
                value={point.value}
                onChange={(event) => updatePoint(point.id, event.target.value)}
                maxLength={200}
                placeholder="Point (optional), e.g. Verb stem + ます"
                aria-label={`Point ${pointIndex + 1}${suffix}`}
                className="border-0 bg-transparent px-0 text-sm font-semibold shadow-none focus-visible:ring-0"
              />
            </RulePoint>
            {draft.points.length > 1 && (
              <button
                type="button"
                aria-label={`Remove point ${pointIndex + 1}${suffix}`}
                onClick={() =>
                  onChange({ points: draft.points.filter((row) => row.id !== point.id) })
                }
                className="absolute -right-2 -top-2 inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:border-red-500/40 hover:text-red-500"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </RuleGroup>

      <RuleGroup flat={flat} className="space-y-3">
        <Label htmlFor={id("explanation")}>Explanation *</Label>
        <Textarea
          id={id("explanation")}
          value={draft.explanation}
          onChange={(event) => onChange({ explanation: event.target.value })}
          required
          maxLength={2000}
          placeholder="Explain the rule in plain English…"
          className="resize-y font-sans text-sm"
        />
      </RuleGroup>

      <RuleGroup flat={flat} className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Examples (Japanese + English equivalent)</p>
          <button
            type="button"
            className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-primarylw hover:underline"
            onClick={() =>
              onChange({
                examples: [
                  ...draft.examples,
                  { id: `new-${draft.id}-${draft.examples.length}`, japanese: "", english: "" },
                ],
              })
            }
          >
            <Plus className="h-3.5 w-3.5" /> Add example
          </button>
        </div>
        {draft.examples.length === 0 ? (
          <p className="text-xs text-muted-foreground">No examples yet.</p>
        ) : (
          <ReorderList values={draft.examples} onReorder={(examples) => onChange({ examples })}>
            {draft.examples.map((example, exampleIndex) => (
              <ReorderRow
                key={example.id}
                value={example}
                removeLabel={`Remove example ${exampleIndex + 1}${suffix}`}
                onRemove={() =>
                  onChange({
                    examples: draft.examples.filter((row) => row.id !== example.id),
                  })
                }
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    value={example.japanese}
                    onChange={(event) =>
                      updateExample(example.id, { japanese: event.target.value })
                    }
                    placeholder="日本語の例"
                    aria-label={`Example ${exampleIndex + 1} (Japanese)${suffix}`}
                  />
                  <Input
                    value={example.english}
                    onChange={(event) =>
                      updateExample(example.id, { english: event.target.value })
                    }
                    placeholder="English equivalent"
                    aria-label={`Example ${exampleIndex + 1} (English)${suffix}`}
                  />
                </div>
              </ReorderRow>
            ))}
          </ReorderList>
        )}
      </RuleGroup>

      {/* Related rules are picked by hand — nothing is inferred. */}
      <RuleGroup flat={flat} className="space-y-3">
        <div>
          <p className="text-sm font-semibold">Related rules</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Link the rules that go with this one, e.g. other forms that use the same stem.
          </p>
        </div>

        {related.length === 0 ? (
          <p className="text-xs text-muted-foreground">No related rules yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {related.map((option) => (
              <span
                key={option.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-border py-1 pl-3 pr-1.5 text-xs font-medium"
              >
                {option.title}
                <button
                  type="button"
                  aria-label={`Remove related rule ${option.title}${suffix}`}
                  onClick={() =>
                    onChange({
                      relatedIds: draft.relatedIds.filter((id) => id !== option.id),
                    })
                  }
                  className="cursor-pointer rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        {addableOptions.length > 0 && (
          <SelectField
            ariaLabel={`Add a related rule${suffix}`}
            placeholder="Add a related rule…"
            options={addableOptions}
            value=""
            onValueChange={(value) =>
              onChange({ relatedIds: [...draft.relatedIds, Number.parseInt(value, 10)] })
            }
            triggerClassName="w-full sm:w-80"
          />
        )}
      </RuleGroup>
    </div>
  );
}

/** Shown when Convex isn't configured, so neither form renders. */
function NotConfigured() {
  return (
    <Card>
      <CardContent className="p-8 text-center text-sm text-muted-foreground">
        Auth is not configured yet, so rule management is unavailable.
      </CardContent>
    </Card>
  );
}

/**
 * Create form: **one submission can hold many rules**. Each rule lives in its
 * own accordion, *Add rule* appends another, and *Fill form from JSON* turns a
 * pasted array into editable rules instead of writing them straight to the
 * database.
 */
export function RulesCreateForm({
  defaultKind = "word",
  ruleOptions = [],
}: {
  defaultKind?: RuleKind;
  /** Every rule, for the "related rules" picker. */
  ruleOptions?: RuleOption[];
}) {
  const navigation = useNavigation();
  const actionData = useActionData() as RuleFormActionData | undefined;
  const token = useAuthToken();
  const configured = isConvexClientConfigured();
  const busy = navigation.state === "submitting" || navigation.state === "loading";
  const navigate = useNavigate();
  // Creating is the end of the flow: send the reader back where they started.
  const returnTo = useReturnTo("/rules");

  const blank = React.useCallback(
    () => toDraft({ ...EMPTY_RULE_DRAFT, kind: defaultKind }),
    [defaultKind]
  );

  const [drafts, setDrafts] = React.useState<Draft[]>(() => [blank()]);
  // `drafts` is initialised above, so the first rule can start expanded — its
  // fields would otherwise be inert behind a collapsed panel.
  const [openIds, setOpenIds] = React.useState<string[]>(() => drafts.map((draft) => draft.id));

  // Reset after a successful create so the next batch starts from a clean form.
  const handled = React.useRef<RuleFormActionData | undefined>(undefined);
  React.useEffect(() => {
    if (!actionData?.ok || handled.current === actionData) return;
    handled.current = actionData;
    toast({
      title:
        (actionData.created ?? 1) === 1 ? "Rule created" : `Created ${actionData.created} rules`,
      variant: "success",
    });
    const fresh = blank();
    setDrafts([fresh]);
    setOpenIds([fresh.id]);
  }, [actionData, blank]);

  // …and hand the reader back to the screen they came from.
  React.useEffect(() => {
    if (!actionData?.ok) return;
    navigate(returnTo, { replace: true });
  }, [actionData, navigate, returnTo]);

  const updateDraft = (draftId: string, patch: Partial<Draft>) =>
    setDrafts((prev) =>
      prev.map((draft) => (draft.id === draftId ? { ...draft, ...patch } : draft))
    );

  const addDraft = () => {
    const next = blank();
    setDrafts((prev) => [...prev, next]);
    setOpenIds((prev) => [...prev, next.id]);
  };

  const removeDraft = (draftId: string) =>
    setDrafts((prev) =>
      prev.length === 1 ? prev : prev.filter((draft) => draft.id !== draftId)
    );

  if (!configured) return <NotConfigured />;

  const count = drafts.length;
  const incomplete = drafts.filter((draft) => !draftToRulePayload(toRuleDraft(draft)).ok).length;

  return (
    <div className="space-y-5">
      <Form method="post" id={RULE_FORM_ID} className="space-y-5">
        <input type="hidden" name="convexToken" value={token ?? ""} />
        <input type="hidden" name="rulesJson" value={serialize(drafts)} />

        <JsonFillAccordion
          sample={RULES_SAMPLE_JSON}
          placeholder='[{ "kind": "word", "title": "…", "explanation": "…", "examples": [{ "japanese": "…", "english": "…" }] }]'
          hint="Paste up to 100 rules, then press Fill form from JSON. Each rule becomes an editable panel below; nothing is saved until you press Create."
          onFill={(text) => {
            const parsed = parseRuleJson(text);
            if (!parsed.ok) return { ok: false, error: parsed.error };
            const next = parsed.drafts.map((draft) => toDraft(draft));
            setDrafts(next);
            setOpenIds(next.map((draft) => draft.id));
            return {
              ok: true,
              message: `Filled in ${next.length} rule${next.length === 1 ? "" : "s"} from JSON. Review them below, then create.`,
            };
          }}
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">
            {count} rule{count === 1 ? "" : "s"}
            {incomplete > 0 && (
              <span className="ml-2 font-normal text-muted-foreground">
                ({incomplete} still missing a title or explanation)
              </span>
            )}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={addDraft}>
            <Plus /> Add rule
          </Button>
        </div>

        <Accordion type="multiple" value={openIds} onValueChange={setOpenIds} className="space-y-3">
          {drafts.map((draft, index) => (
            <AccordionItem
              key={draft.id}
              value={draft.id}
              className="rounded-[var(--radius)] border border-border bg-card px-4"
            >
              <AccordionTrigger className="py-4 hover:no-underline">
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <Badge variant="secondary">{index + 1}</Badge>
                  <span className="truncate text-sm font-semibold">
                    {draft.title.trim() || "Untitled rule"}
                  </span>
                  {draftToRulePayload(toRuleDraft(draft)).ok ? null : (
                    <span className="shrink-0 text-xs text-amber-500/90">incomplete</span>
                  )}
                </span>
              </AccordionTrigger>
              <AccordionContent className="pb-4">
                <RuleFields
                  draft={draft}
                  index={count > 1 ? index : undefined}
                  idPrefix={`rule-${index}`}
                  flat
                  ruleOptions={ruleOptions}
                  onChange={(patch) => updateDraft(draft.id, patch)}
                />
                {count > 1 && (
                  <div className="mt-5 flex justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-red-500 hover:bg-red-500/10"
                      onClick={() => removeDraft(draft.id)}
                    >
                      <Trash2 /> Remove
                    </Button>
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>

        {actionData && !actionData.ok && <FormMessage tone="error">{actionData.error}</FormMessage>}
        {actionData?.ok && (
          <FormMessage tone="success">
            Created {actionData.created ?? 1} rule{actionData.created === 1 ? "" : "s"}.
          </FormMessage>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? "Creating…" : count === 1 ? "Create rule" : `Create ${count} rules`}
          </Button>
        </div>
      </Form>
    </div>
  );
}

/**
 * Edit form: exactly one rule, mirroring the rule detail page's structure with
 * the text swapped for inputs.
 */
export function RuleForm({
  rule,
  deleteSlot,
  ruleOptions = [],
}: {
  rule: RuleDetail;
  /** Rendered next to the submit button (the edit page's Delete control). */
  deleteSlot?: React.ReactNode;
  /** Every rule, for the "related rules" picker. */
  ruleOptions?: RuleOption[];
}) {
  const navigation = useNavigation();
  const actionData = useActionData() as RuleFormActionData | undefined;
  const token = useAuthToken();
  const configured = isConvexClientConfigured();
  const busy = navigation.state === "submitting" || navigation.state === "loading";
  const navigate = useNavigate();
  // Saving hands the reader back to the screen they came from.
  const returnTo = useReturnTo(`/rules/${rule.id}`);

  useActionToast(actionData, (data) => (data.deleted ? null : okMessage(data, "Rule updated")));

  React.useEffect(() => {
    if (!actionData?.ok || actionData.deleted) return;
    navigate(returnTo, { replace: true });
  }, [actionData, navigate, returnTo]);

  const [draft, setDraft] = React.useState<Draft>(() =>
    toDraft({
      kind: rule.kind,
      title: rule.title,
      points: rule.points,
      explanation: rule.explanation,
      tags: rule.tags.join(", "),
      examples: rule.examples,
      relatedIds: rule.related.map((related) => related.id),
    })
  );

  if (!configured) return <NotConfigured />;

  return (
    <div className="space-y-5">
      <Form method="post" id={RULE_FORM_ID} className="space-y-5">
        <input type="hidden" name="convexToken" value={token ?? ""} />
        <input type="hidden" name="ruleJson" value={serialize([draft])} />

        <RuleFields
          draft={draft}
          idPrefix="rule"
          ruleOptions={ruleOptions}
          selfId={rule.id}
          onChange={(patch) => setDraft((prev) => ({ ...prev, ...patch }))}
        />

        {actionData && !actionData.ok && <FormMessage tone="error">{actionData.error}</FormMessage>}
        {actionData?.ok && <FormMessage tone="success">Rule saved.</FormMessage>}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {deleteSlot}
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </Form>
    </div>
  );
}
