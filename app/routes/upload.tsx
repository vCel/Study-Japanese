import { redirect } from "react-router";

import type { Route } from "./+types/upload";

/**
 * Word lists are uploaded through the combined add page (manual form + JSON
 * accordion), so the legacy upload URL simply redirects there.
 */
export function meta({}: Route.MetaArgs) {
  return [{ title: "Add word list · 日本語Vocab" }];
}

export function loader({}: Route.LoaderArgs) {
  return redirect("/lists/new");
}

export default function Upload() {
  return null;
}
