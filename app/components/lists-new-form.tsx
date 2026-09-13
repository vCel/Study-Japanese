"use client";

import * as React from "react";
import { Form, Link, useActionData, useNavigate, useNavigation } from "react-router";
import { useAuthToken } from "@convex-dev/auth/react";

import { isAuthConfigured } from "~/components/convex-provider";
import { Button } from "~/components/lightswind/button";
import { Card, CardContent } from "~/components/lightswind/card";
import { Input, Label } from "~/components/lightswind/input";
import { FormMessage } from "~/components/form-message";
import { JsonFillAccordion } from "~/components/json-fill-accordion";
import { useActionToast } from "~/components/action-toast";
import { useReturnTo } from "~/lib/return-to";
import {
  fromDrafts,
  isDraftComplete,
  newRow,
  toDrafts,
  VocabRowsEditor,
  type VocabRowDraft,
} from "~/components/vocab-rows-editor";
import { parseVocabRows } from "~/lib/vocab-rows";
import { SAMPLE_JSON } from "~/lib/vocab";

export interface ListsNewActionData {
  ok: boolean;
  error?: string;
  needsSignIn?: boolean;
  listId?: number;
  title?: string;
  wordsInserted?: number;
}

/**
 * Create a word list: title/tags/description plus draggable word rows (each with
 * its meanings and example sentences). The JSON accordion *fills those rows* —
 * nothing is written until the form is submitted.
 */
export function ListsNewForm() {
  const navigation = useNavigation();
  const actionData = useActionData() as ListsNewActionData | undefined;
  const token = useAuthToken();
  const configured = isAuthConfigured();
  const busy = navigation.state === "submitting" || navigation.state === "loading";
  const navigate = useNavigate();
  // The new list appears on the screen the reader came from, so that is where
  // they are sent once it is created.
  const returnTo = useReturnTo("/");
  const [rows, setRows] = React.useState<VocabRowDraft[]>(() => [newRow()]);

  useActionToast(actionData, (data) =>
    data.ok
      ? {
          title: "Word list created",
          description: data.title,
          variant: "success",
        }
      : data.error
        ? { title: data.error, variant: "error" }
        : null
  );

  React.useEffect(() => {
    if (!actionData?.ok) return;
    navigate(returnTo, { replace: true });
  }, [actionData, navigate, returnTo]);

  if (!configured) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Auth is not configured yet, so creating lists is unavailable.
        </CardContent>
      </Card>
    );
  }

  const complete = rows.filter(isDraftComplete).length;

  return (
    <div className="space-y-5">
      <Form method="post" className="space-y-5">
        <input type="hidden" name="convexToken" value={token ?? ""} />
        <input type="hidden" name="wordsJson" value={JSON.stringify(fromDrafts(rows))} />

        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="title">Word list title *</Label>
                <Input
                  id="title"
                  name="title"
                  required
                  maxLength={120}
                  placeholder="e.g. Kitchen vocabulary"
                  className="mt-2"
                />
              </div>
              <div>
                <Label htmlFor="tags">Tags (comma separated)</Label>
                <Input id="tags" name="tags" placeholder="e.g. food, daily" className="mt-2" />
              </div>
            </div>
            <div>
              <Label htmlFor="description">Description (optional)</Label>
              <Input
                id="description"
                name="description"
                maxLength={500}
                placeholder="What is this list about?"
                className="mt-2"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold">Words *</p>
              <p className="text-xs text-muted-foreground">
                {complete} of {rows.length} ready. Drag the handle to reorder.
              </p>
            </div>
            <VocabRowsEditor kind="words" drafts={rows} onChange={setRows} />
          </CardContent>
        </Card>

        <JsonFillAccordion
          sample={SAMPLE_JSON}
          placeholder='{"word": "食べる", "kana": "たべる", "meanings": ["to eat"], "notes": "…", "forms": [{"name": "ます", "value": "食べます"}], "examples": [{"japanese": "…", "translation": "…"}]}'
          hint="A single object or an array both work; key aliases are accepted (kanji, reading, definitions, sentences, …). Filling replaces the rows above with one per entry, using the list title, tags and description as you typed them."
          onFill={(text) => {
            const parsed = parseVocabRows(text);
            if (!parsed.ok) return { ok: false, error: parsed.error };
            setRows(toDrafts(parsed.rows));
            return {
              ok: true,
              message: `Filled in ${parsed.rows.length} word${parsed.rows.length === 1 ? "" : "s"}. Review them above, then create the list.`,
            };
          }}
        />

        {actionData && !actionData.ok && (
          <FormMessage tone="error">{actionData.error}</FormMessage>
        )}
        {actionData?.ok && actionData.listId && (
          <FormMessage tone="success">
            Created{" "}
            <Link to={`/lists/${actionData.listId}`} className="font-semibold underline">
              {actionData.title}
            </Link>{" "}
            with {actionData.wordsInserted} words.
          </FormMessage>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? "Creating…" : "Create word list"}
          </Button>
        </div>
      </Form>
    </div>
  );
}
