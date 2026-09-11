"use client";

import * as React from "react";
import { Form, Link, useActionData, useNavigation } from "react-router";
import { useAuthToken } from "@convex-dev/auth/react";

import { isConvexClientConfigured } from "~/components/convex-provider";
import { Button } from "~/components/lightswind/button";
import { Card, CardContent } from "~/components/lightswind/card";
import { Input, Label } from "~/components/lightswind/input";
import { FormMessage } from "~/components/form-message";
import { JsonFillAccordion } from "~/components/json-fill-accordion";
import { useActionToast } from "~/components/action-toast";
import {
  fromDrafts,
  isDraftComplete,
  newRow,
  toDrafts,
  VocabRowsEditor,
  type VocabRowDraft,
} from "~/components/vocab-rows-editor";
import { parseVocabRows } from "~/lib/vocab-rows";

export interface PhraseFormActionData {
  ok: boolean;
  error?: string;
  needsSignIn?: boolean;
  phrasesInserted?: number;
  listId?: number;
  listTitle?: string;
}

export const PHRASES_SAMPLE_JSON = `[
  {
    "word": "おはようございます",
    "kana": "おはようございます",
    "meanings": ["Good morning (polite)"],
    "examples": [
      { "japanese": "おはようございます、田中さん。", "translation": "Good morning, Mr. Tanaka." }
    ]
  }
]`;

/**
 * Add phrases: an optional phrase-list title for grouping, plus draggable phrase
 * rows (each with meanings and example sentences). The JSON accordion *fills
 * those rows* — nothing is written until the form is submitted.
 */
export function PhraseForm() {
  const navigation = useNavigation();
  const actionData = useActionData() as PhraseFormActionData | undefined;
  const token = useAuthToken();
  const configured = isConvexClientConfigured();
  const busy = navigation.state === "submitting" || navigation.state === "loading";
  const [rows, setRows] = React.useState<VocabRowDraft[]>(() => [newRow()]);

  useActionToast(actionData, (data) =>
    data.ok
      ? {
          title: `Added ${data.phrasesInserted ?? 0} phrases`,
          description: data.listTitle ? `Word list: ${data.listTitle}` : undefined,
          variant: "success",
        }
      : data.error
        ? { title: data.error, variant: "error" }
        : null
  );

  if (!configured) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Auth is not configured yet, so adding phrases is unavailable.
        </CardContent>
      </Card>
    );
  }

  const complete = rows.filter(isDraftComplete).length;

  return (
    <div className="space-y-5">
      <Form method="post" className="space-y-5">
        <input type="hidden" name="convexToken" value={token ?? ""} />
        <input type="hidden" name="phrasesJson" value={JSON.stringify(fromDrafts(rows))} />

        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="title">Phrase list title (optional)</Label>
                <Input
                  id="title"
                  name="title"
                  maxLength={120}
                  placeholder="e.g. Restaurant phrases"
                  className="mt-2"
                />
              </div>
              <div>
                <Label htmlFor="tags">Tags (comma separated)</Label>
                <Input id="tags" name="tags" placeholder="e.g. phrases, daily" className="mt-2" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Give the phrases a list title to group them into a new phrase list, or leave it
              blank to add standalone phrases.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold">Phrases *</p>
              <p className="text-xs text-muted-foreground">
                {complete} of {rows.length} ready. Drag the handle to reorder.
              </p>
            </div>
            <VocabRowsEditor kind="phrases" drafts={rows} onChange={setRows} />
          </CardContent>
        </Card>

        <JsonFillAccordion
          sample={PHRASES_SAMPLE_JSON}
          placeholder='{"word": "ありがとうございます", "kana": "ありがとうございます", "meanings": ["Thank you very much"], "examples": [{"japanese": "…", "translation": "…"}]}'
          hint="Every entry becomes a phrase (part of speech is forced to “phrase”). Filling replaces the rows above with one per entry, using the list title and tags as you typed them."
          onFill={(text) => {
            const parsed = parseVocabRows(text, { forcePos: "phrase" });
            if (!parsed.ok) return { ok: false, error: parsed.error };
            setRows(toDrafts(parsed.rows));
            return {
              ok: true,
              message: `Filled in ${parsed.rows.length} phrase${parsed.rows.length === 1 ? "" : "s"}. Review them above, then add them.`,
            };
          }}
        />

        {actionData && !actionData.ok && (
          <FormMessage tone="error">{actionData.error}</FormMessage>
        )}
        {actionData?.ok && (
          <FormMessage tone="success">
            Added {actionData.phrasesInserted} phrases
            {actionData.listId && actionData.listTitle ? (
              <>
                {" to "}
                <Link to={`/lists/${actionData.listId}`} className="font-semibold underline">
                  {actionData.listTitle}
                </Link>
              </>
            ) : null}
            .
          </FormMessage>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? "Adding…" : "Add phrases"}
          </Button>
        </div>
      </Form>
    </div>
  );
}
