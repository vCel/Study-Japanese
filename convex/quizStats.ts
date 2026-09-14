import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { auth } from "./auth";

/**
 * The signed-in user's quiz answer log.
 *
 * Questions are generated fresh each session and never stored, so what persists
 * is per-library-item accuracy: "you have answered the は-particle rule right 4
 * times and wrong 3 times". That is the number the results screen reports and
 * what the builder can use to weight a future quiz.
 *
 * Like stars, this is personal state keyed to the Convex user rather than a
 * column on the D1 content rows. Signed-out visitors get an empty log instead
 * of an error, so the UI degrades to a session-only score.
 */

const kindValidator = v.union(v.literal("word"), v.literal("rule"));

/** One answered question, as reported by the runner at the end of a session. */
const answerValidator = v.object({
  kind: kindValidator,
  itemId: v.number(),
  correct: v.number(),
  wrong: v.number(),
});

/** The whole log, as a flat list (small by construction — one row per item). */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (userId === null) return [];

    const rows = await ctx.db
      .query("quizStats")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    return rows.map((row) => ({
      kind: row.kind,
      itemId: row.itemId,
      correct: row.correct,
      wrong: row.wrong,
      lastAt: row.lastAt,
    }));
  },
});

/**
 * Fold one session's answers into the log. Called once at the end of a quiz
 * with that session's tallies, so a burst of answers is one write rather than
 * one write per question.
 *
 * Rows are merged rather than replaced, so the log accumulates across sessions.
 */
export const record = mutation({
  args: { answers: v.array(answerValidator) },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (userId === null) throw new Error("Please sign in to save your quiz results.");

    const now = Date.now();
    let written = 0;

    for (const answer of args.answers) {
      if (answer.correct === 0 && answer.wrong === 0) continue;

      const existing = await ctx.db
        .query("quizStats")
        .withIndex("by_user_kind_item", (q) =>
          q.eq("userId", userId).eq("kind", answer.kind).eq("itemId", answer.itemId)
        )
        .first();

      if (existing === null) {
        await ctx.db.insert("quizStats", {
          userId,
          kind: answer.kind,
          itemId: answer.itemId,
          correct: answer.correct,
          wrong: answer.wrong,
          lastAt: now,
        });
      } else {
        await ctx.db.patch(existing._id, {
          correct: existing.correct + answer.correct,
          wrong: existing.wrong + answer.wrong,
          lastAt: now,
        });
      }
      written += 1;
    }

    return { written };
  },
});

/** Wipe the log — offered from the settings page. */
export const clear = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (userId === null) throw new Error("Please sign in to clear your stats.");

    const rows = await ctx.db
      .query("quizStats")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    for (const row of rows) await ctx.db.delete(row._id);
    return { removed: rows.length };
  },
});
