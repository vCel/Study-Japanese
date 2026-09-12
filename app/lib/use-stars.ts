import * as React from "react";
import { useQuery } from "convex/react";

import { api } from "../../convex/_generated/api";
import { isConvexClientConfigured } from "~/components/convex-provider";

export interface StarredIds {
  /** Ids of the signed-in user's starred words (phrases included). */
  words: Set<number>;
  /** Ids of the signed-in user's starred rules. */
  rules: Set<number>;
}

const EMPTY: StarredIds = { words: new Set(), rules: new Set() };

/**
 * The signed-in user's starred ("important") ids, straight from Convex.
 *
 * Stars are per-user, so the server can't know them while rendering: this hook
 * runs on the client only. It returns empty sets on the server (and whenever
 * Convex isn't configured), which keeps the SSR markup stable — star-dependent
 * UI is progressive enhancement that fills in once the query resolves.
 */
export function useStarredIds(): StarredIds {
  // Convex hooks need the client provider, which only exists in the browser.
  const stars = isConvexClientConfigured() ? useQuery(api.stars.mine) : undefined;

  return React.useMemo(
    () =>
      stars
        ? { words: new Set(stars.words), rules: new Set(stars.rules) }
        : EMPTY,
    [stars]
  );
}
