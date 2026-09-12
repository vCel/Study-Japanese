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
});