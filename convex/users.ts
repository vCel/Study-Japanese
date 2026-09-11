import { internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import { auth } from "./auth";

/**
 * Returns the currently authenticated Convex user, or null.
 * Used by the React Router server actions to authorize D1 writes.
 */
export const getAuthenticatedUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (userId === null) return null;

    const user = await ctx.db.get(userId);
    if (!user) return null;

    return {
      id: user._id,
      email: user.email ?? null,
      name: user.name ?? null,
      username: user.username ?? null,
    };
  },
});

/**
 * Whether the current user is an admin. Admins are allow-listed by email via
 * the ADMIN_EMAILS deployment env var (comma separated), e.g.:
 *   npx convex env set ADMIN_EMAILS "you@example.com,other@example.com"
 *
 * Rules (grammar) are admin-only: this is the single source of truth used by
 * the React Router actions and the client UI.
 */
export const isCurrentUserAdmin = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.getUserId(ctx);
    if (userId === null) return false;

    const user = await ctx.db.get(userId);
    const emailValue: unknown = user?.email;
    const email = typeof emailValue === "string" ? emailValue : null;
    if (!email) return false;

    const adminEmails = (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0);

    return adminEmails.includes(email.toLowerCase());
  },
});

// ---------------------------------------------------------------------------
// Internal helpers used by the React Router server actions / auth provider.
// ---------------------------------------------------------------------------

/** Resolve an account email from a username (internal — used by auth sign-in). */
export const getEmailByUsername = internalQuery({
  args: { username: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("username", (q) => q.eq("username", args.username))
      .first();
    return user?.email ?? null;
  },
});

export const hasUserWithUsername = internalQuery({
  args: { username: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("username", (q) => q.eq("username", args.username))
      .first();
    return user !== null;
  },
});

export const hasUserWithEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .first();
    return user !== null;
  },
});

export const isUsernameOwnedBy = internalQuery({
  args: { username: v.string(), userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("username", (q) => q.eq("username", args.username))
      .first();
    return user !== null && user._id === args.userId;
  },
});

export const setUsername = internalMutation({
  args: { userId: v.id("users"), username: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { username: args.username });
  },
});