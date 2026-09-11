import { Link, useActionData, useLoaderData } from "react-router";
import { Pencil } from "lucide-react";

import type { Route } from "./+types/list-edit";
import { getConvexSession } from "~/lib/auth.server";
import { deleteWordList, getWordList, updateWordList } from "~/lib/db.server";
import { enforceRateLimit, getClientIp } from "~/lib/ratelimit.server";
import { Button } from "~/components/lightswind/button";
import { DeleteButton } from "~/components/delete-button";
import { PageHeader } from "~/components/page-header";
import { ListEditForm, LIST_EDIT_FORM_ID } from "~/components/edit-list-form";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Edit word list · 日本語Vocab" }];
}

export async function loader({ params }: Route.LoaderArgs) {
  const id = Number.parseInt(params.id ?? "", 10);
  if (Number.isNaN(id)) {
    throw new Response("Invalid list id", { status: 400 });
  }
  const list = await getWordList(id);
  if (!list) {
    throw new Response("Word list not found", { status: 404 });
  }
  return { list };
}

export interface ListEditActionData {
  ok: boolean;
  error?: string;
  needsSignIn?: boolean;
  deleted?: boolean;
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

export async function action({ request, params }: Route.ActionArgs): Promise<ListEditActionData> {
  const listId = Number.parseInt(params.id ?? "", 10);
  if (Number.isNaN(listId)) {
    return { ok: false, error: "Invalid list id." };
  }

  const limit = await enforceRateLimit("UPLOAD_LIMITER", getClientIp(request), "upload");
  if (!limit.allowed) {
    return { ok: false, error: "Too many requests. Please wait a moment and try again." };
  }

  const form = await request.formData();
  const token = form.get("convexToken");
  const tokenString = typeof token === "string" && token.length > 0 ? token : null;

  const session = await getConvexSession(tokenString);
  if (!session) {
    return { ok: false, needsSignIn: true, error: "You must be signed in to edit word lists." };
  }

  const list = await getWordList(listId);
  if (!list) {
    return { ok: false, error: "Word list not found." };
  }
  if (list.createdBy !== session.user.id && !session.isAdmin) {
    return {
      ok: false,
      error: "Only the author of this word list or an admin can edit it.",
    };
  }

  if (form.get("action") === "delete") {
    const removed = await deleteWordList(listId);
    if (!removed) {
      return { ok: false, error: "Word list not found." };
    }
    return { ok: true, deleted: true };
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

  const updated = await updateWordList(listId, title, description, tags);
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
        description="Only the author of this list can save changes."
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