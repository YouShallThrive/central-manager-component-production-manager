import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

const constraintTypeValidator = v.union(
  v.literal("php_lock"),
  v.literal("plugin_no_remove"),
  v.literal("plugin_version_lock"),
);

const severityValidator = v.union(
  v.literal("critical"),
  v.literal("warning"),
  v.literal("info"),
);

export const seedBatch = internalMutation({
  args: {
    items: v.array(
      v.object({
        domain: v.string(),
        constraintType: constraintTypeValidator,
        target: v.string(),
        targetLabel: v.string(),
        currentVersion: v.optional(v.string()),
        reason: v.string(),
        severity: severityValidator,
        action: v.string(),
        source: v.string(),
        group: v.optional(v.string()),
        addedAt: v.number(),
      }),
    ),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    let count = 0;
    for (const item of args.items) {
      await ctx.db.insert("siteConstraints", item);
      count++;
    }
    return count;
  },
});

export const clearAll = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const all = await ctx.db.query("siteConstraints").collect();
    for (const c of all) {
      await ctx.db.delete(c._id);
    }
    return all.length;
  },
});
