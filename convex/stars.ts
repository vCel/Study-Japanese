import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { auth } from "./auth";

/**
 * The signed-in user's starred ("important") cards, split by kind.
 *
 * Stars are personal — they live here, keyed by the Convex user, instead of as
 * a shared column on the D1 content rows. Signed-out visitors get empty lists
 * rather than an error, so the star buttons can simply render unstarred.
 */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (userId === null) return { words: [] as number[], rules: [] as number[] };

    const rows = await ctx.db
      .query("stars")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    return {
      words: rows.filter((row) => row.kind === "word").map((row) => row.itemId),
      rules: rows.filter((row) => row.kind === "rule").map((row) => row.itemId),
    };
  },
});

/**
 * Star or un-star one card for the signed-in user. Idempotent: writing the same
 * value twice is a no-op, so the client can stay optimistic without racing.
 */
export const toggle = mutation({
  args: {
    kind: v.union(v.literal("word"), v.literal("rule")),
    itemId: v.number(),
    important: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await auth.getUserId(ctx);
    if (userId === null) throw new Error("Please sign in to star cards.");

    const existing = await ctx.db
      .query("stars")
      .withIndex("by_user_kind_item", (q) =>
        q.eq("userId", userId).eq("kind", args.kind).eq("itemId", args.itemId)
      )
      .first();

    if (args.important && existing === null) {
      await ctx.db.insert("stars", {
        userId,
        kind: args.kind,
        itemId: args.itemId,
      });
    } else if (!args.important && existing !== null) {
      await ctx.db.delete(existing._id);
    }

    return { important: args.important };
  },
});
