import * as React from "react";
import { useLocation } from "react-router";

/**
 * "Take me back to the screen I came from" support for the create / edit pages.
 *
 * Every create and edit flow in the app writes through a server action and then
 * navigates the browser itself, so the destination has to come from somewhere
 * that survives the round trip. The destination is resolved in this order:
 *
 *   1. the `?returnTo=` search param — used by links that already know where
 *      the reader came from,
 *   2. the last *browsing* page remembered in `sessionStorage` (recorded by
 *      `useBrowsingPageRecorder`, mounted once in the root layout),
 *   3. the caller's fallback — normally the item that was just saved.
 *
 * Only same-app absolute paths are accepted, so a crafted `returnTo` link can
 * never bounce someone off-site.
 */

const RETURN_TO_KEY = "jv:returnTo";

/** Routes that only exist to make a change (never a destination to return to). */
const EDITOR_PATHS: RegExp[] = [
  /^\/lists\/new\/?$/,
  /^\/lists\/\d+\/edit\/?$/,
  /^\/words\/\d+\/edit\/?$/,
  /^\/phrases\/new\/?$/,
  /^\/rules\/new\/?$/,
  /^\/rules\/\d+\/edit\/?$/,
];

/** Is this the path of an editor page (create / edit form)? */
export function isEditorPath(pathname: string): boolean {
  return EDITOR_PATHS.some((pattern) => pattern.test(pathname));
}

/** Accept an in-app path only; anything else falls back. */
export function safeReturnTo(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return fallback;
  return trimmed;
}

/** Remember a browsing page (never an editor). No-op on the server. */
export function rememberBrowsingPage(pathname: string, search: string): void {
  if (typeof window === "undefined" || isEditorPath(pathname)) return;
  try {
    window.sessionStorage.setItem(RETURN_TO_KEY, `${pathname}${search}`);
  } catch {
    // Private mode / storage disabled — the caller's fallback still works.
  }
}

/** The last remembered browsing page, if any. */
export function readRememberedPage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(RETURN_TO_KEY);
  } catch {
    return null;
  }
}

/** Add `returnTo=<from>` to a link that opens an editor. */
export function hrefWithReturnTo(href: string, from: string): string {
  const [path, existing = ""] = href.split("?");
  const qs = new URLSearchParams(existing);
  qs.set("returnTo", from);
  const search = qs.toString();
  return search ? `${path}?${search}` : path;
}

/** Records every browsing page so editors know where to send the reader back to. */
export function useBrowsingPageRecorder(): void {
  const location = useLocation();
  React.useEffect(() => {
    rememberBrowsingPage(location.pathname, location.search);
  }, [location.pathname, location.search]);
}

/**
 * The path a create / edit flow should return to. Starts at `fallback` so the
 * server render and the first client render agree, then resolves in an effect.
 */
export function useReturnTo(fallback: string): string {
  const { search } = useLocation();
  const param = new URLSearchParams(search).get("returnTo");
  const [resolved, setResolved] = React.useState(fallback);

  React.useEffect(() => {
    setResolved(safeReturnTo(param ?? readRememberedPage(), fallback));
  }, [param, fallback]);

  return resolved;
}
