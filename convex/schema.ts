import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

// Convex Auth manages users & sessions here (vocabulary content lives in D1).
export default defineSchema({
  ...authTables,
  users: defineTable({
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    image: v.optional(v.string()),
    isAnonymous: v.optional(v.boolean()),
    username: v.optional(v.string()),
  })
    .index("email", ["email"])
    .index("username", ["username"]),
  /**
   * Per-user "important / priority" stars. The content itself (words, phrases,
   * rules) lives in D1, so a star is stored here as a (user, kind, itemId)
   * triple rather than as a column on the content row — starring is a personal
   * preference that follows the account across devices.
   */
  stars: defineTable({
    userId: v.id("users"),
    kind: v.union(v.literal("word"), v.literal("rule")),
    /** `words.id` for words/phrases, `rules.id` for rules. */
    itemId: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_kind_item", ["userId", "kind", "itemId"]),
  /**
   * Per-user quiz answer log. Quiz questions themselves are ephemeral — the AI
   * regenerates them every session — so what is worth keeping is which library
   * item the user got right or wrong. Keyed by the same (userId, kind, itemId)
   * shape as `stars`, which lets the two be joined when the quiz builder wants
   * to prioritise "the rules you keep missing".
   */
  quizStats: defineTable({
    userId: v.id("users"),
    kind: v.union(v.literal("word"), v.literal("rule")),
    /** `words.id` for words/phrases, `rules.id` for rules. */
    itemId: v.number(),
    correct: v.number(),
    wrong: v.number(),
    /** Epoch ms of the most recent attempt, for "recently missed" ordering. */
    lastAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_kind_item", ["userId", "kind", "itemId"]),
});