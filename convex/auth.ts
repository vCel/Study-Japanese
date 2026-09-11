import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import {
  createAccount,
  invalidateSessions,
  modifyAccountCredentials,
  retrieveAccount,
} from "@convex-dev/auth/server";
import type { GenericId } from "convex/values";
import { Scrypt } from "lucia";
import { convexAuth } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";

const scrypt = new Scrypt();

function validatePasswordRequirements(password: string) {
  if (!password || password.length < 8) {
    throw new Error("Password must be at least 8 characters long.");
  }
}

function isValidEmail(value: string) {
  return value.includes("@") && value.includes(".") && value.length >= 5;
}

/**
 * Custom credentials provider: sign up with email + username, and sign in
 * with EITHER the email or the username (a username is resolved to the
 * account's email before verification). Modeled on @convex-dev/auth's own
 * Password provider.
 */
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    ConvexCredentials({
      id: "password",
      authorize: async (params, ctx) => {
        const flow = params.flow;
        const password = typeof params.password === "string" ? params.password : "";
        const identifier = typeof params.identifier === "string" ? params.identifier.trim() : "";
        const email = typeof params.email === "string" ? params.email.trim().toLowerCase() : "";
        const username = typeof params.username === "string" ? params.username.trim() : "";

        if (flow === "signUp") {
          validatePasswordRequirements(password);
          if (!isValidEmail(email)) {
            throw new Error("Please enter a valid email address.");
          }
          if (username.length < 3) {
            throw new Error("Username must be at least 3 characters long.");
          }
          if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
            throw new Error(
              "Username may only contain letters, numbers, dots, dashes and underscores."
            );
          }
          const existingUsername = await ctx.runQuery(
            internal.users.hasUserWithUsername,
            { username }
          );
          if (existingUsername) {
            throw new Error("That username is already taken.");
          }
          const existingEmail = await ctx.runQuery(
            internal.users.hasUserWithEmail,
            { email }
          );
          if (existingEmail) {
            throw new Error("An account with that email already exists — try signing in.");
          }

          const created = await createAccount(ctx, {
            provider: "password",
            account: { id: email, secret: password },
            profile: { email, username },
            shouldLinkViaEmail: false,
            shouldLinkViaPhone: false,
          });
          return { userId: created.user._id as GenericId<"users"> };
        }

        if (flow === "signIn") {
          validatePasswordRequirements(password);
          let accountId = identifier;
          if (!isValidEmail(accountId)) {
            // Identifier is a username — resolve it to the account email.
            const email = await ctx.runQuery(
              internal.users.getEmailByUsername,
              { username: accountId }
            );
            if (!email) {
              throw new Error("Invalid credentials.");
            }
            accountId = email;
          }
          const retrieved = await retrieveAccount(ctx, {
            provider: "password",
            account: { id: accountId, secret: password },
          });
          if (retrieved === null) {
            throw new Error("Invalid credentials.");
          }
          const userId = retrieved.user._id as GenericId<"users">;
          // If a username was typed on sign-in, store it so future username
          // sign-ins keep working for accounts created before this feature.
          if (username) {
            const taken = await ctx.runQuery(
              internal.users.hasUserWithUsername,
              { username }
            );
            const sameUser = await ctx.runQuery(
              internal.users.isUsernameOwnedBy,
              { username, userId }
            );
            if (!taken || sameUser) {
              await ctx.runMutation(internal.users.setUsername, { userId, username });
            }
          }
          return { userId };
        }

        if (flow === "reset" || flow === "reset-verification") {
          throw new Error("Password reset is not available yet.");
        }
        throw new Error("Unsupported sign-in flow.");
      },
      crypto: {
        async hashSecret(secret) {
          return await scrypt.hash(secret);
        },
        async verifySecret(secret, hash) {
          return await scrypt.verify(hash, secret);
        },
      },
    }),
  ],
});

// Available for future flows (e.g. password reset via email).
void invalidateSessions;
void modifyAccountCredentials;