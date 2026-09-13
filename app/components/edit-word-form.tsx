import * as React from "react";
import { Form, useActionData, useNavigate, useNavigation } from "react-router";
import { useAuthToken } from "@convex-dev/auth/react";
import { Plus, Pencil } from "lucide-react";

import { isAuthConfigured } from "~/components/convex-provider";
import { Button } from "~/components/lightswind/button";
import { Card, CardContent } from "~/components/lightswind/card";
import { Input, Label } from "~/components/lightswind/input";
import { ReorderList, ReorderRow } from "~/components/lightswind/reorder";
import { FormMessage } from "~/components/form-message";
import { okMessage, useActionToast } from "~/components/action-toast";
import { SelectField } from "~/components/select-field";
import { subtypeOptionsFor } from "~/lib/vocab";
import { useReturnTo } from "~/lib/return-to";
import type { WordDetail } from "~/lib/db.server";
import type { WordEditActionData } from "~/routes/word-edit";

const POS_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "noun", label: "Noun" },
  { value: "verb", label: "Verb" },
  { value: "adjective", label: "Adjective" },
  { value: "adverb", label: "Adverb" },
  { value: "phrase", label: "Phrase" },
  { value: "other", label: "Other" },
];

interface MeaningRow {
  id: string;
  value: string;
}

interface ExampleRow {
  id: string;
  japanese: string;
  translation: string;
}

interface FormRow {
  id: string;
  name: string;
  value: string;
}

/** Lets the route's delete button submit this form from outside it. */
export const WORD_EDIT_FORM_ID = "word-edit-form";

/**
 * Edit form for a single word. It mirrors the word detail page's structure
 * (core fields → meanings → example sentences) with the text swapped for
 * inputs, and the meanings/examples are drag-reorderable lists.
 */
export function WordEditForm({
  word,
  deleteSlot,
}: {
  word: WordDetail;
  /** Rendered next to the submit button (the Delete control). */
  deleteSlot?: React.ReactNode;
}) {
  const navigation = useNavigation();
  const actionData = useActionData() as WordEditActionData | undefined;
  const token = useAuthToken();
  const configured = isAuthConfigured();
  const busy = navigation.state === "submitting" || navigation.state === "loading";
  const navigate = useNavigate();
  // Saving is the end of this flow: hand the reader back to the screen they came
  // from instead of leaving them sitting on the form.
  const returnTo = useReturnTo(`/words/${word.id}`);

  useActionToast(actionData, (data) =>
    data.deleted ? null : okMessage(data, "Word saved")
  );

  React.useEffect(() => {
    if (!actionData?.ok || actionData.deleted) return;
    navigate(returnTo, { replace: true });
  }, [actionData, navigate, returnTo]);

  // Deterministic ids keep SSR and hydration in sync. New rows are only added
  // on the client, so the counters can safely start past the initial list.
  const [meanings, setMeanings] = React.useState<MeaningRow[]>(() =>
    word.meanings.map((value, index) => ({ id: `m${index}`, value }))
  );
  const [examples, setExamples] = React.useState<ExampleRow[]>(() =>
    word.examples.map((example, index) => ({
      id: `e${index}`,
      japanese: example.japanese,
      translation: example.translation ?? "",
    }))
  );
  const [notes, setNotes] = React.useState<string>(word.notes ?? "");
  const [forms, setForms] = React.useState<FormRow[]>(() =>
    word.forms.map((form, index) => ({
      id: `f${index}`,
      name: form.name,
      value: form.value,
    }))
  );
  const nextMeaningId = React.useRef(meanings.length);
  const nextExampleId = React.useRef(examples.length);
  const nextFormId = React.useRef(forms.length);

  if (!configured) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Auth is not configured yet, so editing is unavailable.
        </CardContent>
      </Card>
    );
  }

  // Submitted as hidden fields, so the server action is unchanged.
  const meaningsValue = meanings
    .map((row) => row.value.trim())
    .filter((value) => value.length > 0)
    .join("\n");
  const examplesJson = JSON.stringify(
    examples
      .filter((row) => row.japanese.trim().length > 0)
      .map((row) => ({ japanese: row.japanese, translation: row.translation }))
  );
  const formsJson = JSON.stringify(
    forms
      .filter((row) => row.name.trim().length > 0 || row.value.trim().length > 0)
      .map((row) => ({ name: row.name, value: row.value }))
  );

  return (
    <div className="space-y-5">
      <Form method="post" id={WORD_EDIT_FORM_ID} className="space-y-5">
        <input type="hidden" name="convexToken" value={token ?? ""} />
        <input type="hidden" name="meanings" value={meaningsValue} />
        <input type="hidden" name="examplesJson" value={examplesJson} />
        <input type="hidden" name="notes" value={notes} />
        <input type="hidden" name="formsJson" value={formsJson} />

        <Card>
          <CardContent
            className={`grid gap-4 p-6 ${
              subtypeOptionsFor(word.pos).length > 0 ? "md:grid-cols-4" : "md:grid-cols-3"
            }`}
          >
            <div>
              <Label htmlFor="word">Word *</Label>
              <Input
                id="word"
                name="word"
                required
                maxLength={64}
                defaultValue={word.word}
                className="mt-2"
              />
            </div>
            <div>
              <Label htmlFor="kana">Kana reading *</Label>
              <Input
                id="kana"
                name="kana"
                required
                maxLength={64}
                defaultValue={word.kana}
                className="mt-2"
              />
            </div>
            <div>
              <Label htmlFor="pos">Part of speech</Label>
              <SelectField
                id="pos"
                name="pos"
                ariaLabel="Part of speech"
                defaultValue={word.pos ?? ""}
                className="mt-2"
                options={POS_OPTIONS}
              />
            </div>
            {subtypeOptionsFor(word.pos).length > 0 && (
              <div>
                <Label htmlFor="subtype">Subtype</Label>
                <SelectField
                  id="subtype"
                  name="subtype"
                  ariaLabel="Subtype"
                  defaultValue={word.subtype ?? ""}
                  className="mt-2"
                  options={[{ value: "", label: "—" }, ...subtypeOptionsFor(word.pos)]}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-6">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Meanings *</p>
              <button
                type="button"
                className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-primarylw hover:underline"
                onClick={() =>
                  setMeanings((prev) => [
                    ...prev,
                    { id: `m${nextMeaningId.current++}`, value: "" },
                  ])
                }
              >
                <Plus className="h-3.5 w-3.5" /> Add meaning
              </button>
            </div>
            {meanings.length === 0 ? (
              <p className="text-xs text-muted-foreground">No meanings yet.</p>
            ) : (
              <ReorderList values={meanings} onReorder={setMeanings}>
                {meanings.map((row) => (
                  <ReorderRow
                    key={row.id}
                    value={row}
                    removeLabel="Remove meaning"
                    onRemove={() =>
                      setMeanings((prev) => prev.filter((item) => item.id !== row.id))
                    }
                  >
                    <Input
                      value={row.value}
                      onChange={(event) =>
                        setMeanings((prev) =>
                          prev.map((item) =>
                            item.id === row.id ? { ...item, value: event.target.value } : item
                          )
                        )
                      }
                      placeholder="Meaning"
                      aria-label="Meaning"
                    />
                  </ReorderRow>
                ))}
              </ReorderList>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-6">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Example sentences</p>
              <button
                type="button"
                className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-primarylw hover:underline"
                onClick={() =>
                  setExamples((prev) => [
                    ...prev,
                    { id: `e${nextExampleId.current++}`, japanese: "", translation: "" },
                  ])
                }
              >
                <Plus className="h-3.5 w-3.5" /> Add example
              </button>
            </div>
            {examples.length === 0 ? (
              <p className="text-xs text-muted-foreground">No example sentences yet.</p>
            ) : (
              <ReorderList values={examples} onReorder={setExamples}>
                {examples.map((row, index) => (
                  <ReorderRow
                    key={row.id}
                    value={row}
                    removeLabel={`Remove example ${index + 1}`}
                    onRemove={() =>
                      setExamples((prev) => prev.filter((item) => item.id !== row.id))
                    }
                  >
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input
                        value={row.japanese}
                        onChange={(event) =>
                          setExamples((prev) =>
                            prev.map((item) =>
                              item.id === row.id
                                ? { ...item, japanese: event.target.value }
                                : item
                            )
                          )
                        }
                        placeholder="日本語の例文"
                        aria-label={`Example ${index + 1} (Japanese)`}
                      />
                      <Input
                        value={row.translation}
                        onChange={(event) =>
                          setExamples((prev) =>
                            prev.map((item) =>
                              item.id === row.id
                                ? { ...item, translation: event.target.value }
                                : item
                            )
                          )
                        }
                        placeholder="English translation (optional)"
                        aria-label={`Example ${index + 1} (translation)`}
                      />
                    </div>
                  </ReorderRow>
                ))}
              </ReorderList>
            )}
          </CardContent>
        </Card>

        {/* Notes */}
        <Card>
          <CardContent className="space-y-3 p-6">
            <p className="text-sm font-semibold">Notes</p>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Clarify readings, usage, mnemonics…"
              name="notesInput"
              aria-label="Notes"
              rows={3}
              maxLength={2000}
              className="w-full resize-y rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primarylw/40"
            />
          </CardContent>
        </Card>

        {/* Conjugation forms */}
        <Card>
          <CardContent className="space-y-3 p-6">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">
                Forms{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  (dictionary / masu / te / ta / nai …)
                </span>
              </p>
              <button
                type="button"
                className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-primarylw hover:underline"
                onClick={() =>
                  setForms((prev) => [
                    ...prev,
                    { id: `f${nextFormId.current++}`, name: "", value: "" },
                  ])
                }
              >
                <Plus className="h-3.5 w-3.5" /> Add form
              </button>
            </div>
            {forms.length === 0 ? (
              <p className="text-xs text-muted-foreground">No forms yet. e.g. ます-form → 食べます</p>
            ) : (
              <ReorderList values={forms} onReorder={setForms}>
                {forms.map((row, index) => (
                  <ReorderRow
                    key={row.id}
                    value={row}
                    removeLabel={`Remove form ${index + 1}`}
                    onRemove={() => setForms((prev) => prev.filter((item) => item.id !== row.id))}
                  >
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input
                        value={row.name}
                        onChange={(event) =>
                          setForms((prev) =>
                            prev.map((item) =>
                              item.id === row.id ? { ...item, name: event.target.value } : item
                            )
                          )
                        }
                        placeholder="Form name (ます, te, …)"
                        aria-label={`Form ${index + 1} (name)`}
                      />
                      <Input
                        value={row.value}
                        onChange={(event) =>
                          setForms((prev) =>
                            prev.map((item) =>
                              item.id === row.id ? { ...item, value: event.target.value } : item
                            )
                          )
                        }
                        placeholder="Form (食べます)"
                        aria-label={`Form ${index + 1} (value)`}
                      />
                    </div>
                  </ReorderRow>
                ))}
              </ReorderList>
            )}
          </CardContent>
        </Card>

        {actionData && !actionData.ok && (
          <FormMessage tone="error">{actionData.error}</FormMessage>
        )}
        {actionData?.ok && <FormMessage tone="success">Word saved.</FormMessage>}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {deleteSlot}
          <Button type="submit" size="lg" disabled={busy}>
            <Pencil /> {busy ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </Form>
    </div>
  );
}