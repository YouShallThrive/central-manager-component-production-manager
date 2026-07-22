import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Change password for the currently authenticated user.
 * Verifies old password, then updates to the new one.
 * No email verification needed — user is already logged in.
 */
export const changePassword = action({
  args: {
    currentPassword: v.string(),
    newPassword: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    message: v.string(),
  }),
  handler: async (ctx, args): Promise<{ success: boolean; message: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { success: false, message: "Not authenticated" };
    }

    // Validate new password
    if (!args.newPassword || args.newPassword.length < 8) {
      return {
        success: false,
        message: "New password must be at least 8 characters",
      };
    }

    // Find the user's password auth account
    const result: { success: boolean; message: string } = await ctx.runMutation(
      internal.changePassword.verifyAndUpdate,
      {
        userId,
        currentPassword: args.currentPassword,
        newPassword: args.newPassword,
      },
    );

    return result;
  },
});

import { Scrypt as ScryptHash } from "lucia";
import { internalMutation } from "./_generated/server";

export const verifyAndUpdate = internalMutation({
  args: {
    userId: v.id("users"),
    currentPassword: v.string(),
    newPassword: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    message: v.string(),
  }),
  handler: async (ctx, args): Promise<{ success: boolean; message: string }> => {
    // Find auth account for this user with provider "password"
    const accounts = await ctx.db
      .query("authAccounts")
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), args.userId),
          q.eq(q.field("provider"), "password"),
        ),
      )
      .collect();

    if (accounts.length === 0) {
      return { success: false, message: "No password account found" };
    }

    const account = accounts[0];
    const storedHash = account.secret;

    if (!storedHash) {
      return { success: false, message: "Account has no password set" };
    }

    // Verify current password
    const scrypt = new ScryptHash();
    const valid = await scrypt.verify(storedHash, args.currentPassword);
    if (!valid) {
      return { success: false, message: "Current password is incorrect" };
    }

    // Hash and store new password
    const newHash = await scrypt.hash(args.newPassword);
    await ctx.db.patch(account._id, { secret: newHash } as any);

    return { success: true, message: "Password changed successfully" };
  },
});
