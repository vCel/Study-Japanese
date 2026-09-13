import { redirect } from "react-router";

import type { Route } from "./+types/study-session-redirect";

/**
 * The flashcard runner moved to `/study/flashcards/session`. This keeps the old
 * `/study/session?lists=…` deep links (the buttons on the word- and phrase-list
 * pages, and anything bookmarked) working, query string and all.
 */
export function meta({}: Route.MetaArgs) {
  return [{ title: "Flashcards · 日本語Vocab" }];
}

export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  return redirect(`/study/flashcards/session${url.search}`);
}

export default function StudySessionRedirect() {
  return null;
}
