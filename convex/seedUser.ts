import { createAccount } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalAction, internalMutation } from "./_generated/server";

/**
 * Delete existing auth account for an email so we can re-seed.
 */
export const deleteAccount = internalMutation({
  args: { email: v.string() },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const accounts = await ctx.db
      .query("authAccounts")
      .filter((q) => q.eq(q.field("providerAccountId"), args.email))
      .collect();

    if (accounts.length === 0) {
      return "no accounts found";
    }

    for (const account of accounts) {
      const sessions = await ctx.db
        .query("authSessions")
        .filter((q) => q.eq(q.field("userId"), account.userId))
        .collect();
      for (const session of sessions) {
        await ctx.db.delete(session._id);
      }
      await ctx.db.delete(account._id);
      try {
        await ctx.db.delete(account.userId);
      } catch {
        // user may already be deleted
      }
    }
    return `deleted ${accounts.length} account(s)`;
  },
});

/**
 * Mark an auth account as email-verified so the Password provider
 * doesn't try to send a verification email on sign-in.
 */
export const markVerified = internalMutation({
  args: { email: v.string() },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const accounts = await ctx.db
      .query("authAccounts")
      .filter((q) => q.eq(q.field("providerAccountId"), args.email))
      .collect();

    if (accounts.length === 0) {
      return "no accounts found";
    }

    let count = 0;
    for (const account of accounts) {
      await ctx.db.patch(account._id, { emailVerified: args.email } as any);
      count++;
    }
    return `marked ${count} account(s) as verified`;
  },
});

/**
 * Seed a user account (internal only).
 * Pass the RAW password — createAccount hashes it internally.
 */
export const seedUser = internalAction({
  args: {
    email: v.string(),
    password: v.string(),
    name: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    message: v.string(),
  }),
  handler: async (ctx, args) => {
    // First delete any existing account
    const deleteResult: string = await ctx.runMutation(
      "seedUser:deleteAccount" as any,
      { email: args.email },
    );

    try {
      // Pass raw password — createAccount will hash it via crypto.hashSecret
      await createAccount(ctx, {
        provider: "password",
        account: {
          id: args.email,
          secret: args.password,
        },
        profile: {
          email: args.email,
          name: args.name,
          emailVerificationTime: Date.now(),
        },
        shouldLinkViaEmail: false,
      });

      // Mark the authAccount as email-verified so Password provider
      // doesn't redirect to verification flow on sign-in
      const verifyResult: string = await ctx.runMutation(
        "seedUser:markVerified" as any,
        { email: args.email },
      );

      return {
        success: true,
        message: `User ${args.email} created & verified (old: ${deleteResult}, verify: ${verifyResult})`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to create user: ${error}`,
      };
    }
  },
});
