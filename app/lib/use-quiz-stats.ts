import * as React from "react";
import { useMutation, useQuery } from "convex/react";

import { api } from "../../convex/_generated/api";
import { isConvexClientConfigured } from "~/components/convex-provider";
import type { QuizStatsMap } from "~/lib/quiz-prefs";

/**
 * The signed-in user's quiz answer log, from Convex.
 *
 * Quiz questions are ephemeral, so the log is keyed by the *library item* each
 * question came from — the same `(kind, itemId)` pair stars use. Answers with
 * no source item are simply not recorded; there is nothing to attach them to.
 *
 * Like stars, this is per-user state the server cannot know while rendering, so
 * the hook returns an empty map on the server and fills in once the query
 * resolves. Everything reading it must therefore tolerate "no data yet".
 */
export function useQuizStats(): {
  stats: QuizStatsMap;
  /** False until the Convex query has resolved at least once. */
  loaded: boolean;
  /** Fold one session's answers into the log. No-op when signed out. */
  record: (answers: { kind: "word" | "rule"; itemId: number; correct: number; wrong: number }[]) => Promise<void>;
  /** True when Convex is available, so writes can actually land. */
  canRecord: boolean;
} {
  // Mirrors `useStarredIds`: the hook call itself is the thing being gated.
  // `useQuery` throws when no `ConvexProvider` is above it — "skip" only skips
  // the *subscription*, not the provider lookup — so during SSR (and anywhere
  // else without a browser-side client) the hook must not run at all.
  const rows = isConvexClientConfigured()
    ? useQuery(api.quizStats.mine, {})
    : undefined;
  const recordMutation = isConvexClientConfigured()
    ? useMutation(api.quizStats.record)
    : undefined;
  const configured = recordMutation !== undefined;

  const stats = React.useMemo<QuizStatsMap>(() => {
    if (!rows) return {};
    const out: QuizStatsMap = {};
    for (const row of rows) {
      out[`${row.kind}:${row.itemId}`] = {
        correct: row.correct,
        wrong: row.wrong,
        lastAt: row.lastAt,
      };
    }
    return out;
  }, [rows]);

  const record = React.useCallback(
    async (answers: { kind: "word" | "rule"; itemId: number; correct: number; wrong: number }[]) => {
      if (!recordMutation || !rows) return;
      // Nothing to write for an item with no source — skip the round-trip.
      const payload = answers.filter((answer) => answer.correct > 0 || answer.wrong > 0);
      if (payload.length === 0) return;
      try {
        await recordMutation({ answers: payload });
      } catch {
        // Signed out, or the write failed — the session score still stands.
      }
    },
    [recordMutation, rows]
  );

  return {
    stats,
    loaded: rows !== undefined,
    record,
    canRecord: configured && rows !== undefined,
  };
}