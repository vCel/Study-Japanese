import { redirect } from "react-router";

import type { Route } from "./+types/study-redirect";

/**
 * The study builder now lives under `/study/flashcards`, mirroring
 * `/study/flashcards/session` for the runner. The old `/study` URL redirects
 * there so existing links and bookmarks keep working — the query string comes
 * along, because deep links carry the deck (`?lists=1,2`, `?kind=forms`).
 */
export function meta({}: Route.MetaArgs) {
  return [{ title: "Flashcards · 日本語Vocab" }];
}

export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  return redirect(`/study/flashcards${url.search}`);
}

export default function StudyRedirect() {
  return null;
}
