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

/**
 * The deck's source items, together with the total they were drawn from.
 *
 * A sized deck knows its limit, so the count and the fetch go out together. A
 * fixed-size deck *is* the count — the fetch cannot be asked for everything
 * until the count says how much that is — so that one pays a round-trip.
 */
async function fetchWithTotal<T>(
  count: () => Promise<number>,
  fetch: (limit: number) => Promise<T[]>,
  limit: number | null
): Promise<[number, T[]]> {
  if (limit === null) {
    const total = await count();
    return [total, await fetch(total)];
  }
  return Promise.all([count(), fetch(limit)]);
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
  // "all" is the builder's fixed deck: every card in the selection, so there is
  // no number to clamp and none to slice to. Anything else is a deck size.
  const fixedSize = url.searchParams.get("limit") === "all";
  const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "40", 10);
  const limit = fixedSize
    ? null
    : Number.isNaN(limitParam)
      ? 40
      : Math.min(Math.max(limitParam, 5), 100);
  // Absent means shuffled — the builder only says so when the user turned it
  // off. It reorders the deck; which side a card leads with is unaffected.
  const shuffled = url.searchParams.get("shuffle") !== "0";

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
    const [totalAvailable, rules] = await fetchWithTotal(
      () => countRules(ownerId, ruleKind, filter, tagNames),
      (fetchLimit) =>
        getRuleStudyDeck(ownerId, fetchLimit, ruleKind, filter, tagNames, null, shuffled),
      limit
    );
    // Each ポイント of a rule becomes its own card, so one rule can contribute
    // several. The rule list is fetched at the deck size (every rule yields at
    // least one card, so there is always enough to fill the deck), flattened,
    // then re-shuffled and trimmed: without the shuffle a rule's points would
    // arrive as a block and the rule straddling the cut-off would lose its
    // later points to the deck's other cards. Asking for that block order is
    // exactly what an unshuffled deck does.
    const cards = rules.flatMap((rule) => ruleToStudyCards(rule));
    const deck = (shuffled ? shuffle(cards) : cards).slice(0, limit ?? cards.length);
    return {
      kind,
      deck,
      listIds: [],
      pos: null,
      ruleKind,
      limit,
      totalAvailable,
      starredOnly,
      shuffled,
    };
  }

  // Phrases are all `pos = 'phrase'`, so the part-of-speech filter only applies
  // to the words tab.
  const pos = kind === "words" && isValidPos(posParam) ? posParam : null;
  const [totalAvailable, words] = await fetchWithTotal(
    () => countWordsInLists(ownerId, listIds, pos, kind, filter),
    (fetchLimit) => getStudyDeck(ownerId, listIds, fetchLimit, pos, kind, filter, shuffled),
    limit
  );

  return {
    kind,
    deck: words.map((word) => wordToStudyCard(word, randomCardSide())) as StudyCard[],
    listIds,
    pos,
    ruleKind: null,
    limit,
    totalAvailable,
    starredOnly,
    shuffled,
  };
}

export default function StudySession({ loaderData }: Route.ComponentProps) {
  const { deck, kind, listIds, pos, ruleKind, limit, totalAvailable, starredOnly, shuffled } =
    loaderData;

  const scope =
    kind === "forms"
      ? `${starredOnly ? "★ " : ""}${totalAvailable} ${ruleKind ? `${ruleKind} ` : ""}rules`
      : `${listIds.length} list${listIds.length === 1 ? "" : "s"}${pos ? ` · ${pos} only` : ""} · ${starredOnly ? "★ " : ""}${totalAvailable} available`;

  // An unshuffled deck is not a draw — it is the selection, in its own order.
  const dealt = shuffled
    ? `drew ${deck.length} random card${deck.length === 1 ? "" : "s"}`
    : `dealt ${deck.length} card${deck.length === 1 ? "" : "s"} in list order`;

  return (
    <div className="w-full">
      <PageHeader
        title={`Flashcards · ${STUDY_KIND_LABELS[kind]}`}
        breadcrumbs={[{ label: "Flashcards", to: `/study/flashcards?kind=${kind}` }]}
        description={`${scope} · ${dealt}. Click the card or press Space to flip.`}
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
        <Flashcards deck={deck} shuffled={shuffled} />
      )}

      {/* A fixed deck has no size to report but the one it dealt. */}
      <p className="mt-4 text-center text-xs text-muted-foreground">
        Deck size {limit ?? deck.length} cards
      </p>
    </div>
  );
}
