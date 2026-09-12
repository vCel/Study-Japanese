import * as React from "react";
import { Form, useActionData, useFetcher, useNavigate, useNavigation } from "react-router";
import { useAuthToken } from "@convex-dev/auth/react";
import { Pencil, Trash2 } from "lucide-react";

import { isConvexClientConfigured } from "~/components/convex-provider";
import { Button } from "~/components/lightswind/button";
import { Card, CardContent } from "~/components/lightswind/card";
import { Input, Label } from "~/components/lightswind/input";
import { toast } from "~/components/lightswind/toast";
import { okMessage, useActionToast } from "~/components/action-toast";
import { useReturnTo } from "~/lib/return-to";
import type { WordListSummary, WordSummary } from "~/lib/db.server";
import type { ListEditActionData } from "~/routes/list-edit";

/** Lets the route's delete button submit this form from outside it. */
export const LIST_EDIT_FORM_ID = "list-edit-form";

export function ListEditForm({
  list,
  deleteSlot,
}: {
  list: Pick<WordListSummary, "id" | "title" | "description" | "tags"> & {
    /** The saved entries, so each one can be detached from the list below. */
    words?: WordSummary[];
  };
  /** Rendered next to the submit button (the Delete control). */
  deleteSlot?: React.ReactNode;
}) {
  const navigation = useNavigation();
  const actionData = useActionData() as ListEditActionData | undefined;
  const token = useAuthToken();
  const configured = isConvexClientConfigured();
  const busy = navigation.state === "submitting" || navigation.state === "loading";
  const navigate = useNavigate();
  // Saving hands the reader back to the screen they came from.
  const returnTo = useReturnTo(`/lists/${list.id}`);

  // A `remove-words` result is not a save: it leaves the reader on this page.
  const isSaveResult = actionData?.removed === undefined;

  useActionToast(actionData, (data) =>
    data.deleted || data.removed !== undefined ? null : okMessage(data, "Word list saved")
  );

  React.useEffect(() => {
    if (!actionData?.ok || actionData.deleted || actionData.removed !== undefined) return;
    navigate(returnTo, { replace: true });
  }, [actionData, navigate, returnTo]);

  // The list's own entries — each can be taken out of the list without being
  // deleted from the vocabulary.
  const entries = list.words ?? [];

  if (!configured) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Auth is not configured yet, so editing is unavailable.
        </CardContent>
      </Card>
    );
  }

  return (
    <Form method="post" id={LIST_EDIT_FORM_ID} className="space-y-5">
      <input type="hidden" name="convexToken" value={token ?? ""} />

      <Card>
        <CardContent className="space-y-4 p-6">
          <div>
            <Label htmlFor="title">Word list title *</Label>
            <Input
              id="title"
              name="title"
              required
              maxLength={120}
              defaultValue={list.title}
              className="mt-2"
            />
          </div>
          <div>
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              name="description"
              maxLength={500}
              defaultValue={list.description ?? ""}
              placeholder="What is this list about?"
              className="mt-2"
            />
          </div>
          <div>
            <Label htmlFor="tags">Tags (comma separated)</Label>
            <Input
              id="tags"
              name="tags"
              defaultValue={list.tags.join(", ")}
              placeholder="e.g. jlpt, n3, verbs"
              className="mt-2"
            />
          </div>
        </CardContent>
      </Card>

      {/*
        Entries come out one by one. These buttons sit inside the metadata form,
        so they post through a fetcher (`fetcher.submit`) rather than a nested
        <form>, which the browser would silently drop.
      */}
      <Card>
        <CardContent className="p-6">
          <p className="mb-1 text-sm font-semibold">
            Entries in this list{" "}
            <span className="font-normal text-muted-foreground">({entries.length})</span>
          </p>
          <p className="mb-3 text-xs text-muted-foreground">
            Removing an entry detaches the word from this list — the word and its meanings stay
            in your vocabulary.
          </p>
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">This list has no words yet.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {entries.map((word) => (
                <EntryRow key={word.id} word={word} token={token} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {isSaveResult && actionData && !actionData.ok && (
        <p className="rounded-[var(--radius)] border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-600 dark:text-red-400">
          {actionData.error}
        </p>
      )}
      {isSaveResult && actionData?.ok && (
        <p className="rounded-[var(--radius)] border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-600 dark:text-emerald-400">
          Word list saved.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {deleteSlot}
        <Button type="submit" disabled={busy}>
          <Pencil /> {busy ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </Form>
  );
}

/**
 * One saved entry, with a control that takes it out of the list. The word is
 * never deleted — only its link to this list goes away — so the button says
 * "Remove", not "Delete".
 */
function EntryRow({ word, token }: { word: WordSummary; token: string | null }) {
  const fetcher = useFetcher<ListEditActionData>();
  const busy = fetcher.state !== "idle";

  React.useEffect(() => {
    const data = fetcher.data;
    if (!data) return;
    if (data.ok && data.removed) {
      toast({
        title: `Removed “${word.word}” from this list`,
        description: "The word stays in your vocabulary with its meanings.",
        variant: "success",
      });
    } else if (!data.ok && data.error) {
      toast({ title: data.error, variant: "error" });
    }
  }, [fetcher.data, word.word]);

  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{word.word}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {word.kana}
          {word.meaning ? ` · ${word.meaning}` : ""}
        </span>
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          fetcher.submit(
            { action: "remove-words", wordIds: String(word.id), convexToken: token ?? "" },
            { method: "post" }
          )
        }
        aria-label={`Remove ${word.word} from this list`}
        className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-border px-4 text-sm font-medium text-muted-foreground transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:text-red-400"
      >
        <Trash2 className="h-4 w-4" />
        {busy ? "Removing…" : "Remove"}
      </button>
    </li>
  );
}