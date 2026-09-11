import * as React from "react";
import { Form, useActionData, useNavigation } from "react-router";
import { useAuthToken } from "@convex-dev/auth/react";
import { Pencil } from "lucide-react";

import { isConvexClientConfigured } from "~/components/convex-provider";
import { Button } from "~/components/lightswind/button";
import { Card, CardContent } from "~/components/lightswind/card";
import { Input, Label } from "~/components/lightswind/input";
import { okMessage, useActionToast } from "~/components/action-toast";
import type { WordListSummary } from "~/lib/db.server";
import type { ListEditActionData } from "~/routes/list-edit";

/** Lets the route's delete button submit this form from outside it. */
export const LIST_EDIT_FORM_ID = "list-edit-form";

export function ListEditForm({
  list,
  deleteSlot,
}: {
  list: Pick<WordListSummary, "id" | "title" | "description" | "tags">;
  /** Rendered next to the submit button (the Delete control). */
  deleteSlot?: React.ReactNode;
}) {
  const navigation = useNavigation();
  const actionData = useActionData() as ListEditActionData | undefined;
  const token = useAuthToken();
  const configured = isConvexClientConfigured();
  const busy = navigation.state === "submitting" || navigation.state === "loading";

  useActionToast(actionData, (data) =>
    data.deleted ? null : okMessage(data, "Word list saved")
  );

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

      {actionData && !actionData.ok && (
        <p className="rounded-[var(--radius)] border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-600 dark:text-red-400">
          {actionData.error}
        </p>
      )}
      {actionData?.ok && (
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