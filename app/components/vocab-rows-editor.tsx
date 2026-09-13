"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";

import { Button } from "~/components/lightswind/button";
import { Input } from "~/components/lightswind/input";
import { ReorderList, ReorderRow } from "~/components/lightswind/reorder";
import { SelectField } from "~/components/select-field";
import { subtypeOptionsFor } from "~/lib/vocab";
import { POS_OPTIONS, type VocabRow } from "~/lib/vocab-rows";

/**
 * The draggable row editor used by the word-list and phrase create forms. Each
 * row is one word/phrase with its reading, part of speech (words only), every
 * meaning and any example sentences — the same information the JSON importer
 * carries, so filling the form never drops data.
 */

export interface MeaningDraft {
  id: string;
  value: string;
}

export interface ExampleDraft {
  id: string;
  japanese: string;
  translation: string;
}

export interface FormDraft {
  id: string;
  name: string;
  value: string;
}

export interface VocabRowDraft {
  id: string;
  word: string;
  kana: string;
  pos: string;
  /** Refines pos (verb → "group1", adjective → "i-adjective", …). "" = unset. */
  subtype: string;
  meanings: MeaningDraft[];
  examples: ExampleDraft[];
  notes: string;
  forms: FormDraft[];
}

let rowCounter = 0;
let partCounter = 0;

export function newRow(overrides: Partial<VocabRow> = {}): VocabRowDraft {
  rowCounter += 1;
  partCounter += 1;
  const key = rowCounter;
  return {
    id: `row-${key}`,
    word: overrides.word ?? "",
    kana: overrides.kana ?? "",
    pos: overrides.pos ?? "",
    subtype: overrides.subtype ?? "",
    meanings: [{ id: `m-${key}`, value: overrides.meanings?.[0] ?? "" }],
    examples: (overrides.examples ?? []).map((example, index) => ({
      id: `e-${key}-${index}`,
      japanese: example.japanese,
      translation: example.translation,
    })),
    notes: overrides.notes ?? "",
    forms: (overrides.forms ?? []).map((form, index) => ({
      id: `f-${key}-${index}`,
      name: form.name,
      value: form.value,
    })),
  };
}

/** Rows that arrived from JSON become editable drafts. */
export function toDrafts(rows: VocabRow[]): VocabRowDraft[] {
  return rows.map((row) => {
    rowCounter += 1;
    partCounter += 1;
    const key = rowCounter;
    return {
      id: `row-${key}`,
      word: row.word,
      kana: row.kana,
      pos: row.pos,
      subtype: row.subtype,
      meanings: (row.meanings.length > 0 ? row.meanings : [""]).map((value, index) => ({
        id: `m-${key}-${index}`,
        value,
      })),
      examples: row.examples.map((example, index) => ({
        id: `e-${key}-${index}`,
        japanese: example.japanese,
        translation: example.translation,
      })),
      notes: row.notes,
      forms: row.forms.map((form, index) => ({
        id: `f-${key}-${index}`,
        name: form.name,
        value: form.value,
      })),
    };
  });
}

/** Drafts → the plain shape the route action receives. */
export function fromDrafts(drafts: VocabRowDraft[]): VocabRow[] {
  return drafts.map((draft) => ({
    word: draft.word,
    kana: draft.kana,
    pos: draft.pos,
    subtype: draft.subtype,
    meanings: draft.meanings.map((meaning) => meaning.value),
    examples: draft.examples.map((example) => ({
      japanese: example.japanese,
      translation: example.translation,
    })),
    notes: draft.notes,
    forms: draft.forms.map((form) => ({ name: form.name, value: form.value })),
  }));
}

/** Same rule as `isRowComplete`, for the row drafts the editor holds. */
export function isDraftComplete(draft: VocabRowDraft): boolean {
  return (
    draft.word.trim().length > 0 &&
    draft.kana.trim().length > 0 &&
    draft.meanings.some((meaning) => meaning.value.trim().length > 0)
  );
}

export function VocabRowsEditor({
  kind,
  drafts,
  onChange,
}: {
  /** Drives the wording and whether a part of speech can be picked. */
  kind: "words" | "phrases";
  drafts: VocabRowDraft[];
  onChange: (next: VocabRowDraft[]) => void;
}) {
  const noun = kind === "phrases" ? "phrase" : "word";
  const showPos = kind === "words";
  // Conjugation forms only make sense for words (phrases don't conjugate).
  const showForm = kind === "words";

  const patch = (id: string, changes: Partial<VocabRowDraft>) =>
    onChange(drafts.map((draft) => (draft.id === id ? { ...draft, ...changes } : draft)));

  const addRow = () => onChange([...drafts, newRow()]);

  const removeRow = (id: string) =>
    // Always keep one row so the form never looks empty.
    onChange(drafts.length === 1 ? [newRow()] : drafts.filter((draft) => draft.id !== id));

  return (
    <div className="space-y-3">
      <ReorderList values={drafts} onReorder={onChange}>
        {drafts.map((draft, index) => {
          const subtypeOptions = subtypeOptionsFor(draft.pos);
          // The subtype column is always there for words; it greys out when the
          // chosen part of speech has no subtypes to offer.
          const showSubtype = showPos;
          return (
            <ReorderRow
              key={draft.id}
              value={draft}
              removeLabel={`Remove ${noun} ${index + 1}`}
              onRemove={() => removeRow(draft.id)}
            >
              <div className="space-y-3 py-0.5">
                <div
                  className={
                    showSubtype
                      ? "grid gap-2 md:grid-cols-[1.2fr_1.2fr_9rem_9rem]"
                      : "grid gap-2 md:grid-cols-2"
                  }
                >
                  <Input
                    value={draft.word}
                    onChange={(event) => patch(draft.id, { word: event.target.value })}
                    placeholder={kind === "phrases" ? "Phrase (日本語)" : "Word (日本語)"}
                    aria-label={`${kind === "phrases" ? "Phrase" : "Word"} ${index + 1}`}
                  />
                  <Input
                    value={draft.kana}
                    onChange={(event) => patch(draft.id, { kana: event.target.value })}
                    placeholder="Kana reading"
                    aria-label={`${kind === "phrases" ? "Phrase" : "Word"} ${index + 1} (kana)`}
                  />
                  {showPos && (
                    <SelectField
                      ariaLabel={`Word ${index + 1} part of speech`}
                      value={draft.pos}
                      onValueChange={(pos) => patch(draft.id, { pos, subtype: "" })}
                      options={POS_OPTIONS}
                    />
                  )}
                  {showSubtype && (
                    <SelectField
                      ariaLabel={`Word ${index + 1} subtype`}
                      value={draft.subtype}
                      onValueChange={(subtype) => patch(draft.id, { subtype })}
                      placeholder={subtypeOptions.length === 0 ? "—" : "Select"}
                      disabled={subtypeOptions.length === 0}
                      options={
                        subtypeOptions.length === 0
                          ? [{ value: "", label: "—" }]
                          : [{ value: "", label: "—" }, ...subtypeOptions]
                      }
                    />
                  )}
                </div>

                {/* Meanings */}
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Meanings</p>
                  {draft.meanings.map((meaning, meaningIndex) => (
                    <div key={meaning.id} className="flex items-center gap-2">
                      <Input
                        value={meaning.value}
                        onChange={(event) =>
                          patch(draft.id, {
                            meanings: draft.meanings.map((row) =>
                              row.id === meaning.id ? { ...row, value: event.target.value } : row
                            ),
                          })
                        }
                        placeholder="Meaning"
                        aria-label={`${kind === "phrases" ? "Phrase" : "Word"} ${index + 1} meaning ${meaningIndex + 1}`}
                      />
                      {draft.meanings.length > 1 && (
                        <button
                          type="button"
                          aria-label={`Remove ${noun} ${index + 1} meaning ${meaningIndex + 1}`}
                          className="cursor-pointer rounded p-1.5 text-muted-foreground/50 hover:bg-red-500/10 hover:text-red-500"
                          onClick={() =>
                            patch(draft.id, {
                              meanings: draft.meanings.filter((row) => row.id !== meaning.id),
                            })
                          }
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-primarylw hover:underline"
                    onClick={() => {
                      partCounter += 1;
                      patch(draft.id, {
                        meanings: [
                          ...draft.meanings,
                          { id: `m-${draft.id}-${partCounter}`, value: "" },
                        ],
                      });
                    }}
                  >
                    <Plus className="h-3 w-3" /> Add meaning
                  </button>
                </div>

                {/* Examples */}
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Examples</p>
                  {draft.examples.map((example, exampleIndex) => (
                    <div key={example.id} className="flex items-start gap-2">
                      <div className="grid flex-1 gap-2 sm:grid-cols-2">
                        <Input
                          value={example.japanese}
                          onChange={(event) =>
                            patch(draft.id, {
                              examples: draft.examples.map((row) =>
                                row.id === example.id
                                  ? { ...row, japanese: event.target.value }
                                  : row
                              ),
                            })
                          }
                          placeholder="日本語の例"
                          aria-label={`${kind === "phrases" ? "Phrase" : "Word"} ${index + 1} example ${exampleIndex + 1} (Japanese)`}
                        />
                        <Input
                          value={example.translation}
                          onChange={(event) =>
                            patch(draft.id, {
                              examples: draft.examples.map((row) =>
                                row.id === example.id
                                  ? { ...row, translation: event.target.value }
                                  : row
                              ),
                            })
                          }
                          placeholder="English translation"
                          aria-label={`${kind === "phrases" ? "Phrase" : "Word"} ${index + 1} example ${exampleIndex + 1} (English)`}
                        />
                      </div>
                      <button
                        type="button"
                        aria-label={`Remove ${noun} ${index + 1} example ${exampleIndex + 1}`}
                        className="cursor-pointer rounded p-1.5 text-muted-foreground/50 hover:bg-red-500/10 hover:text-red-500"
                        onClick={() =>
                          patch(draft.id, {
                            examples: draft.examples.filter((row) => row.id !== example.id),
                          })
                        }
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-primarylw hover:underline"
                    onClick={() => {
                      partCounter += 1;
                      patch(draft.id, {
                        examples: [
                          ...draft.examples,
                          { id: `e-${draft.id}-${partCounter}`, japanese: "", translation: "" },
                        ],
                      });
                    }}
                  >
                    <Plus className="h-3 w-3" /> Add example
                  </button>
                </div>

                {/* Notes */}
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">
                    Notes{" "}
                    <span className="font-normal normal-case text-muted-foreground/60">
                      (optional)
                    </span>
                  </p>
                  <textarea
                    value={draft.notes}
                    onChange={(event) => patch(draft.id, { notes: event.target.value })}
                    placeholder="Clarify readings, usage, mnemonics…"
                    aria-label={`${kind === "phrases" ? "Phrase" : "Word"} ${index + 1} notes`}
                    rows={2}
                    maxLength={2000}
                    className="w-full resize-y rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm shadow-none transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primarylw/40"
                  />
                </div>

                {/* Conjugation forms — words only (phrases don't conjugate). */}
                {showForm && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-muted-foreground">
                        Forms{" "}
                        <span className="font-normal normal-case text-muted-foreground/60">
                          (dictionary / masu / te / ta / nai …)
                        </span>
                      </p>
                      <button
                        type="button"
                        className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-primarylw hover:underline"
                        onClick={() => {
                          partCounter += 1;
                          patch(draft.id, {
                            forms: [
                              ...draft.forms,
                              { id: `f-${draft.id}-${partCounter}`, name: "", value: "" },
                            ],
                          });
                        }}
                      >
                        <Plus className="h-3 w-3" /> Add form
                      </button>
                    </div>
                    {draft.forms.length === 0 ? (
                      <p className="text-xs text-muted-foreground/60">
                        No forms yet. e.g. ます-form → 食べます
                      </p>
                    ) : (
                      draft.forms.map((form, formIndex) => (
                        <div key={form.id} className="flex items-start gap-2">
                          <div className="grid flex-1 gap-2 sm:grid-cols-2">
                            <Input
                              value={form.name}
                              onChange={(event) =>
                                patch(draft.id, {
                                  forms: draft.forms.map((row) =>
                                    row.id === form.id
                                      ? { ...row, name: event.target.value }
                                      : row
                                  ),
                                })
                              }
                              placeholder="Form name (ます, te, …)"
                              aria-label={`Word ${index + 1} form ${formIndex + 1} name`}
                            />
                            <Input
                              value={form.value}
                              onChange={(event) =>
                                patch(draft.id, {
                                  forms: draft.forms.map((row) =>
                                    row.id === form.id
                                      ? { ...row, value: event.target.value }
                                      : row
                                  ),
                                })
                              }
                              placeholder="Form (食べます)"
                              aria-label={`Word ${index + 1} form ${formIndex + 1} value`}
                            />
                          </div>
                          <button
                            type="button"
                            aria-label={`Remove ${noun} ${index + 1} form ${formIndex + 1}`}
                            className="cursor-pointer rounded p-1.5 text-muted-foreground/50 hover:bg-red-500/10 hover:text-red-500"
                            onClick={() =>
                              patch(draft.id, {
                                forms: draft.forms.filter((row) => row.id !== form.id),
                              })
                            }
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </ReorderRow>
          );
        })}
      </ReorderList>

      <Button type="button" variant="outline" size="sm" onClick={addRow}>
        <Plus /> Add {noun}
      </Button>
    </div>
  );
}
