import { Link, useActionData, useLoaderData } from "react-router";
import { Pencil } from "lucide-react";

import type { Route } from "./+types/word-edit";
import { canEditWord, deleteWord, getWord, updateWord } from "~/lib/db.server";
import { ownerContext } from "~/lib/owner.server";
import { enforceRateLimit, getClientIp } from "~/lib/ratelimit.server";
import { resolvePosSubtype } from "~/lib/vocab";
import { Button } from "~/components/lightswind/button";
import { DeleteButton } from "~/components/delete-button";
import { PageHeader } from "~/components/page-header";
import { WordEditForm, WORD_EDIT_FORM_ID } from "~/components/edit-word-form";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Edit word · 日本語Vocab" }];
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const id = Number.parseInt(params.id ?? "", 10);
  if (Number.isNaN(id)) {
    throw new Response("Invalid word id", { status: 400 });
  }
  const owner = context.get(ownerContext);
  const ownerId = owner?.ownerId ?? "anonymous";
  const word = await getWord(ownerId, id);
  if (!word) {
    throw new Response("Word not found", { status: 404 });
  }
  return { word };
}

export interface WordEditActionData {
  ok: boolean;
  error?: string;
  deleted?: boolean;
}

export async function action({ request, params, context }: Route.ActionArgs): Promise<WordEditActionData> {
  const wordId = Number.parseInt(params.id ?? "", 10);
  if (Number.isNaN(wordId)) {
    return { ok: false, error: "Invalid word id." };
  }

  const limit = await enforceRateLimit("UPLOAD_LIMITER", getClientIp(request), "upload");
  if (!limit.allowed) {
    return { ok: false, error: "Too many requests. Please wait a moment and try again." };
  }

  const owner = context.get(ownerContext);
  if (!owner) {
    return { ok: false, error: "Could not identify your library." };
  }

  // Only the word's owner may edit it (content is private per owner).
  const allowed = await canEditWord(owner.ownerId, wordId);
  if (!allowed) {
    return {
      ok: false,
      error: "You can only edit words in your own library.",
    };
  }

  const form = await request.formData();

  if (form.get("action") === "delete") {
    const removed = await deleteWord(owner.ownerId, wordId);
    if (!removed) {
      return { ok: false, error: "Word not found." };
    }
    return { ok: true, deleted: true };
  }

  const word = typeof form.get("word") === "string" ? (form.get("word") as string).trim() : "";
  const kana = typeof form.get("kana") === "string" ? (form.get("kana") as string).trim() : "";
  if (!word || !kana) {
    return { ok: false, error: "The word and its kana reading are required." };
  }
  if (word.length > 64 || kana.length > 64) {
    return { ok: false, error: "The word or kana reading is too long (max 64 characters)." };
  }

  // The one resolver the import and the bulk rows use too: the route cannot
  // hold a pos the form has no option for, nor a subtype its pos cannot show.
  const { pos, subtype } = resolvePosSubtype(form.get("pos"), form.get("subtype"));

  const meaningsRaw = form.get("meanings");
  const meanings =
    typeof meaningsRaw === "string"
      ? meaningsRaw
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .slice(0, 20)
      : [];
  if (meanings.length === 0) {
    return { ok: false, error: "At least one meaning is required (one per line)." };
  }

  // Examples arrive as JSON: [{ japanese, translation }]
  const examplesRaw = form.get("examplesJson");
  let examples: { japanese: string; translation: string | null }[] = [];
  if (typeof examplesRaw === "string" && examplesRaw.trim().length > 0) {
    try {
      const parsed: unknown = JSON.parse(examplesRaw);
      if (!Array.isArray(parsed)) throw new Error("not an array");
      for (const item of parsed.slice(0, 50)) {
        if (item && typeof item === "object") {
          const obj = item as Record<string, unknown>;
          const japanese = typeof obj.japanese === "string" ? obj.japanese.trim() : "";
          if (!japanese) continue;
          const translation = typeof obj.translation === "string" && obj.translation.trim() ? obj.translation.trim() : null;
          examples.push({ japanese, translation });
        }
      }
    } catch {
      return { ok: false, error: "The example sentences could not be read. Please try again." };
    }
  }

  const notesRaw = form.get("notes");
  const notes =
    typeof notesRaw === "string" && notesRaw.trim().length > 0
      ? notesRaw.trim().slice(0, 2000)
      : null;

  // Conjugation forms arrive as JSON: [{ name, value }]
  const formsRaw = form.get("formsJson");
  const forms: { name: string; value: string }[] = [];
  if (typeof formsRaw === "string" && formsRaw.trim().length > 0) {
    try {
      const parsed: unknown = JSON.parse(formsRaw);
      if (!Array.isArray(parsed)) throw new Error("not an array");
      for (const item of parsed.slice(0, 12)) {
        if (item && typeof item === "object") {
          const obj = item as Record<string, unknown>;
          const name = typeof obj.name === "string" ? obj.name.trim().slice(0, 64) : "";
          const value = typeof obj.value === "string" ? obj.value.trim().slice(0, 128) : "";
          if (name || value) forms.push({ name, value });
        }
      }
    } catch {
      return { ok: false, error: "The conjugation forms could not be read. Please try again." };
    }
  }

  const updated = await updateWord(owner.ownerId, wordId, {
    word,
    kana,
    pos,
    subtype,
    meanings,
    examples,
    notes,
    forms,
  });
  if (!updated) {
    return { ok: false, error: "Word not found." };
  }
  return { ok: true };
}

export default function WordEdit() {
  const { word } = useLoaderData<typeof loader>();
  const actionData = useActionData() as WordEditActionData | undefined;

  return (
    <div className="w-full">
      <PageHeader
        title="Edit word"
        icon={Pencil}
        breadcrumbs={[
          { label: "Words", to: "/words" },
          { label: word.word, to: `/words/${word.id}` },
        ]}
        description="Only the word's creator or the author of its word list can save changes."
      />
      <WordEditForm
        word={word}
        deleteSlot={
          <DeleteButton
            formId={WORD_EDIT_FORM_ID}
            label="word"
            redirectTo="/words"
            deleted={actionData?.deleted}
            description="Its meanings and examples are removed too."
            size="lg"
          />
        }
      />
    </div>
  );
}