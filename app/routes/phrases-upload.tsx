import { redirect } from "react-router";

import type { Route } from "./+types/phrases-upload";

/**
 * Phrases are uploaded through the combined add page (manual form + JSON
 * accordion), so the legacy upload URL simply redirects there.
 */
export function loader({}: Route.LoaderArgs) {
  return redirect("/phrases/new");
}

export default function PhrasesUpload() {
  return null;
}
