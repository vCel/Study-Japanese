import { Link } from "react-router";
import type { Route } from "./+types/study-flashcards-session";
import {
  countRules,
  countWordsInLists,
  getRuleStudyDeck,
  getStudyDeck,
  listAllListIds,
  listIdsByTags,
  type CardIdFilter,
  type RuleKind,
} from "~/lib/db.server";
import { ownerContext } from "~/lib/owner.server";
import { isValidPos } from "~/components/pos-filter";
import {
  randomCardSide,
  ruleToStudyCards,
  shuffle,
  wordToStudyCard,
  type StudyCard,
} from "~/lib/study-cards";
import { STUDY_KIND_LABELS, type StudyKind } from "~/lib/study-prefs";
import { Flashcards } from "~/components/flashcards";
import { PageHeader } from "~/components/page-header";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Flashcards · 日本語Vocab" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const owner = context.get(ownerContext);
  const ownerId = owner?.ownerId ?? "anonymous";
  const kindParam = url.searchParams.get("kind");
  const listsParam = url.searchParams.get("lists") ?? "";
  const tagsParam = url.searchParams.get("tags") ?? "";
  const posParam = url.searchParams.get("pos");
  const ruleKindParam = url.searchParams.get("ruleKind");
  const ruleKind: RuleKind | null =
    ruleKindParam === "word" || ruleKindParam === "sentence" ? ruleKindParam : null;
  const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "40", 10);
  const limit = Number.isNaN(limitParam) ? 40 : Math.min(Math.max(limitParam, 5), 100);

  // Stars are per-user and live in Convex, so the browser passes the signed-in
  // user's starred ids along; the deck is then narrowed to whichever of them
  // fall inside the scope below. No ids = study everything.
  const starredIds = (url.searchParams.get("starredIds") ?? "")
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((id) => !Number.isNaN(id));
  const starredOnly = starredIds.length > 0;
  const filter: CardIdFilter = starredOnly ? starredIds : undefined;

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
    listIds = await listIdsByTags(ownerId, tagNames);
  } else {
    listIds = await listAllListIds(ownerId);
  }

  let kind: StudyKind;
  if (kindParam === "words" || kindParam === "phrases" || kindParam === "forms") {
    kind = kindParam;
  } else {
    // Deep links (`/study/flashcards/session?lists=N`) don't say which tab they came from,
    // so pick whichever the selected lists actually contain.
    const [wordCount, phraseCount] = await Promise.all([
      countWordsInLists(ownerId, listIds, null, "words", filter),
      countWordsInLists(ownerId, listIds, null, "phrases", filter),
    ]);
    kind = phraseCount > wordCount ? "phrases" : "words";
  }

  if (kind === "forms") {
    const [totalAvailable, rules] = await Promise.all([
      countRules(ownerId, ruleKind, filter, tagNames),
      getRuleStudyDeck(ownerId, limit, ruleKind, filter, tagNames),
    ]);
    // Each ポイント of a rule becomes its own card, so one rule can contribute
    // several. The rule list is fetched at the deck size (every rule yields at
    // least one card, so there is always enough to fill the deck), flattened,
    // then re-shuffled and trimmed: without the shuffle a rule's points would
    // arrive as a block and the rule straddling the cut-off would lose its
    // later points to the deck's other cards.
    const deck = shuffle(rules.flatMap((rule) => ruleToStudyCards(rule))).slice(0, limit);
    return {
      kind,
      deck,
      listIds: [],
      pos: null,
      ruleKind,
      limit,
      totalAvailable,
      starredOnly,
    };
  }

  // Phrases are all `pos = 'phrase'`, so the part-of-speech filter only applies
  // to the words tab.
  const pos = kind === "words" && isValidPos(posParam) ? posParam : null;
  const [totalAvailable, words] = await Promise.all([
    countWordsInLists(ownerId, listIds, pos, kind, filter),
    getStudyDeck(ownerId, listIds, limit, pos, kind, filter),
  ]);

  return {
    kind,
    deck: words.map((word) => wordToStudyCard(word, randomCardSide())) as StudyCard[],
    listIds,
    pos,
    ruleKind: null,
    limit,
    totalAvailable,
    starredOnly,
  };
}

export default function StudySession({ loaderData }: Route.ComponentProps) {
  const { deck, kind, listIds, pos, ruleKind, limit, totalAvailable, starredOnly } =
    loaderData;

  const scope =
    kind === "forms"
      ? `${starredOnly ? "★ " : ""}${totalAvailable} ${ruleKind ? `${ruleKind} ` : ""}rules`
      : `${listIds.length} list${listIds.length === 1 ? "" : "s"}${pos ? ` · ${pos} only` : ""} · ${starredOnly ? "★ " : ""}${totalAvailable} available`;

  return (
    <div className="w-full">
      <PageHeader
        title={`Flashcards · ${STUDY_KIND_LABELS[kind]}`}
        breadcrumbs={[{ label: "Flashcards", to: `/study/flashcards?kind=${kind}` }]}
        description={`${scope} · drew ${deck.length} random card${deck.length === 1 ? "" : "s"}. Click the card or press Space to flip.`}
      />

      {deck.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-border p-10 text-center text-muted-foreground">
          No {starredOnly ? "starred " : ""}
          {pos ? `${pos} ` : ""}cards available for this session.{" "}
          <Link to={`/study/flashcards?kind=${kind}`} className="text-primarylw hover:underline">
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
