import type { Route } from "./+types/lists-new";
import { createWordList, insertVocabEntries } from "~/lib/db.server";
import { ownerContext } from "~/lib/owner.server";
import { enforceRateLimit, getClientIp } from "~/lib/ratelimit.server";
import { parseTags } from "~/lib/tags";
import { readVocabRows, toEntries } from "~/lib/vocab-rows";
import { ListsNewForm, type ListsNewActionData } from "~/components/lists-new-form";
import { PageHeader } from "~/components/page-header";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Add word list · 日本語Vocab" }];
}

/**
 * Create a word list from the form's own rows. The JSON accordion only *fills*
 * those rows on the client, so there is a single write path: the title, tags and
 * description as typed, plus every complete word row (with all of its meanings
 * and example sentences). Lists are private to the submitting owner (a signed-in
 * account or a device).
 */
export async function action({ request, context }: Route.ActionArgs): Promise<ListsNewActionData> {
  const limit = await enforceRateLimit("UPLOAD_LIMITER", getClientIp(request), "upload");
  if (!limit.allowed) {
    return { ok: false, error: "Too many requests. Please wait a moment and try again." };
  }

  const form = await request.formData();

  const owner = context.get(ownerContext);
  if (!owner) {
    return { ok: false, error: "Could not identify your library." };
  }

  const title = typeof form.get("title") === "string" ? (form.get("title") as string).trim() : "";
  if (!title) {
    return { ok: false, error: "Please give your word list a title." };
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

  const rowsRaw = form.get("wordsJson");
  const rows = readVocabRows(typeof rowsRaw === "string" ? rowsRaw : "");
  if (!rows.ok) {
    return { ok: false, error: rows.error };
  }

  const entries = toEntries(rows.rows);
  if (entries.length === 0) {
    return {
      ok: false,
      error: "Add at least one word (word, kana and meaning are required).",
    };
  }

  try {
    const listId = await createWordList(owner.ownerId, title, description, tags);
    const result = await insertVocabEntries(owner.ownerId, entries, listId);
    return { ok: true, listId, title, wordsInserted: result.wordsInserted };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown database error";
    return { ok: false, error: `Database error while saving: ${message}` };
  }
}

export default function ListsNew() {
  return (
    <div className="w-full">
      <PageHeader
        title="Add word list"
        breadcrumbs={[{ label: "Word lists", to: "/" }]}
        description="Build a list word by word, with meanings and example sentences, or paste JSON to fill the form in."
      />
      <ListsNewForm />
    </div>
  );
}
