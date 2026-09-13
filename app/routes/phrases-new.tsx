import type { Route } from "./+types/phrases-new";
import { createWordList, insertVocabEntries } from "~/lib/db.server";
import { ownerContext } from "~/lib/owner.server";
import { enforceRateLimit, getClientIp } from "~/lib/ratelimit.server";
import { parseTags } from "~/lib/tags";
import { readVocabRows, toEntries } from "~/lib/vocab-rows";
import { PhraseForm, type PhraseFormActionData } from "~/components/phrase-form";
import { PageHeader } from "~/components/page-header";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Add phrases · 日本語Vocab" }];
}

/**
 * Add phrases from the form's own rows (part of speech is always "phrase"). The
 * JSON accordion only *fills* those rows on the client, so there is a single
 * write path. An optional list title groups the phrases into a new phrase list.
 * Phrases are private to the submitting owner (a signed-in account or a device).
 */
export async function action({ request, context }: Route.ActionArgs): Promise<PhraseFormActionData> {
  const limit = await enforceRateLimit("UPLOAD_LIMITER", getClientIp(request), "upload");
  if (!limit.allowed) {
    return { ok: false, error: "Too many requests. Please wait a moment and try again." };
  }

  const form = await request.formData();

  const owner = context.get(ownerContext);
  if (!owner) {
    return { ok: false, error: "Could not identify your library." };
  }

  const rowsRaw = form.get("phrasesJson");
  const rows = readVocabRows(typeof rowsRaw === "string" ? rowsRaw : "", { forcePos: "phrase" });
  if (!rows.ok) {
    return { ok: false, error: rows.error };
  }

  const entries = toEntries(rows.rows, { forcePos: "phrase" });
  if (entries.length === 0) {
    return {
      ok: false,
      error: "Add at least one phrase (phrase, kana and meaning are required).",
    };
  }

  const titleRaw = form.get("title");
  const title = typeof titleRaw === "string" ? titleRaw.trim().slice(0, 120) : "";
  const tags = parseTags(form.get("tags"));

  try {
    let listId: number | null = null;
    if (title) {
      listId = await createWordList(owner.ownerId, title, null, tags);
    }
    const result = await insertVocabEntries(owner.ownerId, entries, listId);
    return {
      ok: true,
      phrasesInserted: result.wordsInserted,
      listId: listId ?? undefined,
      listTitle: title || undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown database error";
    return { ok: false, error: `Database error while saving: ${message}` };
  }
}

export default function PhrasesNew() {
  return (
    <div className="w-full">
      <PageHeader
        title="Add phrases"
        breadcrumbs={[{ label: "Phrases", to: "/phrases" }]}
        description="Add phrases with meanings and optional example sentences, or paste JSON to fill the form in."      />
      <PhraseForm />
    </div>
  );
}
