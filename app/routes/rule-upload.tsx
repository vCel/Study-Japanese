import { redirect } from "react-router";

import type { Route } from "./+types/rule-upload";

/**
 * Rules are uploaded through the combined add page (manual form + JSON
 * accordion), so the legacy upload URL simply redirects there.
 */
export function meta({}: Route.MetaArgs) {
  return [{ title: "Add rule · 日本語Vocab" }];
}

export function loader({}: Route.LoaderArgs) {
  return redirect("/rules/new");
}

export default function RuleUpload() {
  return null;
}
