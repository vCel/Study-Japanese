import { Link } from "react-router";
import type { Route } from "./+types/study-session";
import {
  countRules,
  countWordsInLists,
  getRuleStudyDeck,
  getStudyDeck,
  listAllListIds,
  listIdsByTags,
  type RuleKind,
} from "~/lib/db.server";
import { isValidPos } from "~/components/pos-filter";
import { ruleToStudyCard, wordToStudyCard, type StudyCard } from "~/lib/study-cards";
import { STUDY_KIND_LABELS, type StudyKind } from "~/lib/study-prefs";
import { Button } from "~/components/lightswind/button";
import { Flashcards } from "~/components/flashcards";
import { PageHeader } from "~/components/page-header";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Study session · 日本語Vocab" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const kindParam = url.searchParams.get("kind");
  const listsParam = url.searchParams.get("lists") ?? "";
  const tagsParam = url.searchParams.get("tags") ?? "";
  const posParam = url.searchParams.get("pos");
  const ruleKindParam = url.searchParams.get("ruleKind");
  const ruleKind: RuleKind | null =
    ruleKindParam === "word" || ruleKindParam === "sentence" ? ruleKindParam : null;
  const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "40", 10);
  const limit = Number.isNaN(limitParam) ? 40 : Math.min(Math.max(limitParam, 5), 100);

  const explicitLists = listsParam
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((id) => !Number.isNaN(id));
  const tagNames = tagsParam
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);

  // Explicit lists → lists matching tags → everything.
  let listIds: number[];
  if (explicitLists.length > 0) {
    listIds = explicitLists;
  } else if (tagNames.length > 0) {
    listIds = await listIdsByTags(tagNames);
  } else {
    listIds = await listAllListIds();
  }

  let kind: StudyKind;
  if (kindParam === "words" || kindParam === "phrases" || kindParam === "forms") {
    kind = kindParam;
  } else {
    // Deep links (`/study/session?lists=N`) don't say which tab they came from,
    // so pick whichever the selected lists actually contain.
    const [wordCount, phraseCount] = await Promise.all([
      countWordsInLists(listIds, null, "words"),
      countWordsInLists(listIds, null, "phrases"),
    ]);
    kind = phraseCount > wordCount ? "phrases" : "words";
  }

  if (kind === "forms") {
    const [totalAvailable, rules] = await Promise.all([
      countRules(ruleKind),
      getRuleStudyDeck(limit, ruleKind),
    ]);
    return {
      kind,
      deck: rules.map(ruleToStudyCard),
      listIds: [],
      pos: null,
      ruleKind,
      limit,
      totalAvailable,
    };
  }

  // Phrases are all `pos = 'phrase'`, so the part-of-speech filter only applies
  // to the words tab.
  const pos = kind === "words" && isValidPos(posParam) ? posParam : null;
  const [totalAvailable, words] = await Promise.all([
    countWordsInLists(listIds, pos, kind),
    getStudyDeck(listIds, limit, pos, kind),
  ]);

  return {
    kind,
    deck: words.map(wordToStudyCard) as StudyCard[],
    listIds,
    pos,
    ruleKind: null,
    limit,
    totalAvailable,
  };
}

export default function StudySession({ loaderData }: Route.ComponentProps) {
  const { deck, kind, listIds, pos, ruleKind, limit, totalAvailable } = loaderData;

  const scope =
    kind === "forms"
      ? `${totalAvailable} ${ruleKind ? `${ruleKind} ` : ""}rules`
      : `${listIds.length} list${listIds.length === 1 ? "" : "s"}${pos ? ` · ${pos} only` : ""} · ${totalAvailable} available`;

  return (
    <div className="w-full">
      <PageHeader
        title={`Flashcards · ${STUDY_KIND_LABELS[kind]}`}
        breadcrumbs={[{ label: "Study", to: `/study?kind=${kind}` }]}
        description={`${scope} · drew ${deck.length} random card${deck.length === 1 ? "" : "s"}. Click the card or press Space to flip.`}
      />

      {deck.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-border p-10 text-center text-muted-foreground">
          No {pos ? `${pos} ` : ""}cards available for this session.{" "}
          <Link to={`/study?kind=${kind}`} className="text-primarylw hover:underline">
            Adjust your session settings
          </Link>
          .
        </div>
      ) : (
        <Flashcards deck={deck} />
      )}

      <p className="mt-4 text-center text-xs text-muted-foreground">Deck size {limit} cards</p>
    </div>
  );
}