import { Link, useActionData, useLoaderData } from "react-router";
import { Pencil } from "lucide-react";

import type { Route } from "./+types/list-edit";
import { deleteWordList, getWordList, removeWordsFromList, updateWordList } from "~/lib/db.server";
import { ownerContext } from "~/lib/owner.server";
import { enforceRateLimit, getClientIp } from "~/lib/ratelimit.server";
import { Button } from "~/components/lightswind/button";
import { DeleteButton } from "~/components/delete-button";
import { PageHeader } from "~/components/page-header";
import { ListEditForm, LIST_EDIT_FORM_ID } from "~/components/edit-list-form";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Edit word list · 日本語Vocab" }];
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const id = Number.parseInt(params.id ?? "", 10);
  if (Number.isNaN(id)) {
    throw new Response("Invalid list id", { status: 400 });
  }
  const owner = context.get(ownerContext);
  const ownerId = owner?.ownerId ?? "anonymous";
  const list = await getWordList(ownerId, id);
  if (!list) {
    throw new Response("Word list not found", { status: 404 });
  }
  return { list };
}

export interface ListEditActionData {
  ok: boolean;
  error?: string;
  deleted?: boolean;
  /** Entries detached from the list by the `remove-words` action. */
  removed?: number;
}

const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 32;

function parseTags(raw: FormDataEntryValue | null): string[] {
  if (typeof raw !== "string") return [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const tag = part.trim().toLowerCase().slice(0, MAX_TAG_LENGTH);
    if (tag.length > 0 && seen.size < MAX_TAGS) seen.add(tag);
  }
  return [...seen];
}

export async function action({ request, params, context }: Route.ActionArgs): Promise<ListEditActionData> {
  const listId = Number.parseInt(params.id ?? "", 10);
  if (Number.isNaN(listId)) {
    return { ok: false, error: "Invalid list id." };
  }

  const limit = await enforceRateLimit("UPLOAD_LIMITER", getClientIp(request), "upload");
  if (!limit.allowed) {
    return { ok: false, error: "Too many requests. Please wait a moment and try again." };
  }

  const owner = context.get(ownerContext);
  if (!owner) {
    return { ok: false, error: "Could not identify your library." };
  }

  const form = await request.formData();

  if (form.get("action") === "delete") {
    const removed = await deleteWordList(owner.ownerId, listId);
    if (!removed) {
      return { ok: false, error: "Word list not found." };
    }
    return { ok: true, deleted: true };
  }

  // Detach entries from the list. The words themselves survive with their
  // meanings — the same outcome as deleting the whole list — and the update is
  // scoped to this list id, so an entry of another list can never be pulled out.
  if (form.get("action") === "remove-words") {
    const ids = String(form.get("wordIds") ?? "")
      .split(",")
      .map((part) => Number.parseInt(part.trim(), 10))
      .filter((id) => !Number.isNaN(id));
    const removed = await removeWordsFromList(owner.ownerId, listId, ids);
    if (removed === 0) {
      return { ok: false, error: "That entry is not part of this word list." };
    }
    return { ok: true, removed };
  }

  const title = typeof form.get("title") === "string" ? (form.get("title") as string).trim() : "";
  if (!title) {
    return { ok: false, error: "The word list needs a title." };
  }
  if (title.length > 120) {
    return { ok: false, error: "The list title is too long (max 120 characters)." };
  }
  const descriptionRaw = form.get("description");
  const description =
    typeof descriptionRaw === "string" && descriptionRaw.trim().length > 0
      ? descriptionRaw.trim().slice(0, 500)
      : null;
  const tags = parseTags(form.get("tags"));

  const updated = await updateWordList(owner.ownerId, listId, title, description, tags);
  if (!updated) {
    return { ok: false, error: "Word list not found." };
  }
  return { ok: true };
}

export default function ListEdit() {
  const { list } = useLoaderData<typeof loader>();
  const actionData = useActionData() as ListEditActionData | undefined;

  return (
    <div className="w-full">
      <PageHeader
        title="Edit word list"
        icon={Pencil}
        breadcrumbs={[
          { label: "Word lists", to: "/" },
          { label: list.title, to: `/lists/${list.id}` },
        ]}
        description="Your lists are private — only you can edit this list."
      />
      <ListEditForm
        list={list}
        deleteSlot={
          <DeleteButton
            formId={LIST_EDIT_FORM_ID}
            label="word list"
            redirectTo="/lists"
            deleted={actionData?.deleted}
            description="Its words are kept, but they will no longer belong to a list."
          />
        }
      />
    </div>
  );
}