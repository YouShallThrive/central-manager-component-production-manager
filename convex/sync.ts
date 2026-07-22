/**
 * Public-facing sync triggers. Authenticated users can kick off a full sync
 * of credentials and sites, or sync plugins for a specific site.
 */
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

export const triggerFullSync = action({
  args: {},
  returns: v.object({
    credentialsSynced: v.number(),
    totalSites: v.number(),
    totalPlugins: v.number(),
    errors: v.array(v.string()),
  }),
  handler: async (ctx): Promise<{
    credentialsSynced: number;
    totalSites: number;
    totalPlugins: number;
    errors: string[];
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const result: {
      credentialsSynced: number;
      totalSites: number;
      totalPlugins: number;
      errors: string[];
    } = await ctx.runAction(internal.credentialSync.fullSync, {});
    return result;
  },
});

/**
 * Sync plugins for a single site on-demand.
 */
export const syncSitePlugins = action({
  args: { siteId: v.id("sites") },
  returns: v.object({
    pluginsFound: v.number(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<{ pluginsFound: number; error?: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    // Get the site record to find its Rocket.net ID and account
    const site = await ctx.runQuery(internal.sync.getSiteInternal, { siteId: args.siteId });
    if (!site) return { pluginsFound: 0, error: "Site not found" };

    // Get the hosting account to get the API token
    const account = await ctx.runQuery(internal.sync.getAccountInternal, {
      accountId: site.accountId,
    });
    if (!account) return { pluginsFound: 0, error: "Hosting account not found" };

    const result: { pluginsFound: number; error?: string } =
      await ctx.runAction(internal.credentialSync.syncSitePlugins, {
        siteDocId: args.siteId,
        rocketSiteId: site.siteId,
        apiToken: account.apiToken,
      });

    return result;
  },
});

/**
 * Batch sync plugins for ALL sites. Schedules each site as a separate background job.
 */
export const syncAllPlugins = action({
  args: {},
  returns: v.object({
    scheduled: v.number(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx): Promise<{ scheduled: number; error?: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const result: { scheduled: number; error?: string } =
      await ctx.runAction(internal.credentialSync.batchSyncAllPlugins, {});
    return result;
  },
});

// Internal queries for the sync actions above
import { internalQuery } from "./_generated/server";

export const getSiteInternal = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.siteId);
  },
});

export const getAccountInternal = internalQuery({
  args: { accountId: v.id("hostingAccounts") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.accountId);
  },
});
