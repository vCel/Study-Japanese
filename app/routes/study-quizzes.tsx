import type { Route } from "./+types/study-quizzes";
import { PageHeader } from "~/components/page-header";

/**
 * Quizzes — a placeholder under the Study section, next to Flashcards.
 *
 * Intentionally empty: the deck builder and runner for flashcards live at
 * `/study/flashcards` and `/study/flashcards/session`; the quiz equivalents
 * (`/study/quizzes`, and eventually `/study/quizzes/session`) are not built
 * yet, so this page has no loader and no body.
 */
export function meta({}: Route.MetaArgs) {
  return [{ title: "Quizzes · 日本語Vocab" }];
}

export default function QuizzesPage() {
  return (
    <div className="w-full">
      <PageHeader
        title="Quizzes"
        description="Coming soon — quizzes will live here, alongside flashcards."
      />
    </div>
  );
}
