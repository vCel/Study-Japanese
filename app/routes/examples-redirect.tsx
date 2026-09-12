import { redirect } from "react-router";

import type { Route } from "./+types/examples-redirect";

/**
 * Word examples now live under `/words/examples`, mirroring `/rules/examples`.
 * The old `/examples` URL redirects there so existing links keep working.
 */
export function meta({}: Route.MetaArgs) {
  return [{ title: "Example sentences · 日本語Vocab" }];
}

export function loader({}: Route.LoaderArgs) {
  return redirect("/words/examples");
}

export default function ExamplesRedirect() {
  return null;
}
