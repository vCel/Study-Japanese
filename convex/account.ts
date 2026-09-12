import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import {
  getAuthUserId,
  modifyAccountCredentials,
  retrieveAccount,
} from "@convex-dev/auth/server";

/**
 * Self-service account changes for the signed-in user: email and password.
 *
 * Convex Auth's password provider stores the account id as the email address
 * (`authAccounts.providerAccountId`) with a scrypt hash of the password. There
 * is no built-in "change email" flow, so the email action verifies the current
 * password, patches the account id + the user document, and leaves the existing
 * hash in place (the hash does not depend on the account id).
 */

function isValidEmail(value: string) {
  return value.includes("@") && value.includes(".") && value.length >= 5;
}

function validateNewPassword(password: string) {
  if (!password || password.length < 8) {
    throw new Error("Password must be at least 8 characters long.");
  }
}

/** Change the signed-in user's email address. */
export const changeEmail = action({
  args: { currentPassword: v.string(), newEmail: v.string() },
  handler: async (ctx, args): Promise<{ ok: true; email: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Please sign in to change your email.");

    const newEmail = args.newEmail.trim().toLowerCase();
    if (!isValidEmail(newEmail)) throw new Error("Please enter a valid email address.");

    const currentEmail = await ctx.runQuery(internal.account.getUserEmail, { userId });
    if (!currentEmail) throw new Error("Your account has no email on file.");
    if (currentEmail === newEmail) {
      throw new Error("That is already your email address.");
    }

    try {
      await retrieveAccount(ctx, {
        provider: "password",
        account: { id: currentEmail, secret: args.currentPassword },
      });
    } catch {
      throw new Error("Your current password is incorrect.");
    }

    const taken = await ctx.runQuery(internal.account.isEmailTaken, { email: newEmail });
    if (taken) throw new Error("An account with that email already exists.");

    await ctx.runMutation(internal.account.applyEmailChange, {
      userId,
      oldEmail: currentEmail,
      newEmail,
    });
    return { ok: true, email: newEmail };
  },
});

/** Change the signed-in user's password. */
export const changePassword = action({
  args: { currentPassword: v.string(), newPassword: v.string() },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Please sign in to change your password.");

    validateNewPassword(args.newPassword);

    const email = await ctx.runQuery(internal.account.getUserEmail, { userId });
    if (!email) throw new Error("Your account has no email on file.");

    try {
      await retrieveAccount(ctx, {
        provider: "password",
        account: { id: email, secret: args.currentPassword },
      });
    } catch {
      throw new Error("Your current password is incorrect.");
    }

    await modifyAccountCredentials(ctx, {
      provider: "password",
      account: { id: email, secret: args.newPassword },
    });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Internal helpers — actions cannot read/write the database directly.
// ---------------------------------------------------------------------------

export const getUserEmail = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    return user?.email ?? null;
  },
});

export const isEmailTaken = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .first();
    return user !== null;
  },
});

export const applyEmailChange = internalMutation({
  args: { userId: v.id("users"), oldEmail: v.string(), newEmail: v.string() },
  handler: async (ctx, args) => {
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", "password").eq("providerAccountId", args.oldEmail)
      )
      .unique();
    if (account) {
      await ctx.db.patch(account._id, { providerAccountId: args.newEmail });
    }
    await ctx.db.patch(args.userId, { email: args.newEmail });
  },
});
