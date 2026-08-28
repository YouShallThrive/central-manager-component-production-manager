import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {
    environment: v.optional(v.union(
      v.literal("production"),
      v.literal("staging"),
      v.literal("development"),
    )),
    search: v.optional(v.string()),
    accountId: v.optional(v.id("hostingAccounts")),
    statuscakeFilter: v.optional(v.union(
      v.literal("up"),
      v.literal("down"),
    )),
    pluginHealthFilter: v.optional(v.union(
      v.literal("outdated"),
      v.literal("clean"),
    )),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    let sites;
    if (args.environment) {
      sites = await ctx.db
        .query("sites")
        .withIndex("by_environment", (q) => q.eq("environment", args.environment!))
        .collect();
    } else {
      sites = await ctx.db.query("sites").collect();
    }

    // Filter by account if specified
    if (args.accountId) {
      sites = sites.filter((s) => s.accountId === args.accountId);
    }

    // Filter by StatusCake status
    if (args.statuscakeFilter) {
      sites = sites.filter((s) => s.statuscakeStatus === args.statuscakeFilter);
    }

    // Filter by plugin health
    if (args.pluginHealthFilter === "outdated") {
      sites = sites.filter((s) => (s.outdatedCount ?? 0) > 0);
    } else if (args.pluginHealthFilter === "clean") {
      sites = sites.filter((s) => (s.pluginCount ?? 0) > 0 && (s.outdatedCount ?? 0) === 0);
    }

    // Get account labels
    const accountCache = new Map<string, string>();
    for (const site of sites) {
      if (!accountCache.has(site.accountId)) {
        const account = await ctx.db.get(site.accountId);
        accountCache.set(site.accountId, account?.label ?? "Unknown");
      }
    }

    let result = sites.map((s) => ({
      ...s,
      accountLabel: accountCache.get(s.accountId) ?? "Unknown",
    }));

    if (args.search) {
      const term = args.search.toLowerCase();
      result = result.filter((s) =>
        s.domain.toLowerCase().includes(term) ||
        s.accountLabel.toLowerCase().includes(term)
      );
    }

    return result.sort((a, b) => a.domain.localeCompare(b.domain));
  },
});

export const stats = query({
  args: {
    environment: v.optional(v.union(
      v.literal("production"),
      v.literal("staging"),
      v.literal("development"),
    )),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return {
        totalSites: 0,
        productionSites: 0,
        stagingSites: 0,
        developmentSites: 0,
        totalPlugins: 0,
        outdatedPlugins: 0,
        vulnerablePlugins: 0,
        sitesUp: 0,
        sitesDown: 0,
        avgHealthScore: 0,
      };
    }

    let sites;
    if (args.environment) {
      sites = await ctx.db
        .query("sites")
        .withIndex("by_environment", (q) => q.eq("environment", args.environment!))
        .collect();
    } else {
      sites = await ctx.db.query("sites").collect();
    }

    const allSites = await ctx.db.query("sites").collect();

    let totalPlugins = 0;
    let outdatedPlugins = 0;
    let vulnerablePlugins = 0;

    for (const site of sites) {
      totalPlugins += site.pluginCount ?? 0;
      outdatedPlugins += site.outdatedCount ?? 0;
      vulnerablePlugins += site.vulnerableCount ?? 0;
    }

    const sitesUp = sites.filter((s) => s.uptimeStatus === "up").length;
    const sitesDown = sites.filter((s) => s.uptimeStatus === "down").length;
    const healthScores = sites
      .map((s) => s.healthScore)
      .filter((h): h is number => h !== undefined);
    const avgHealthScore = healthScores.length > 0
      ? Math.round(healthScores.reduce((a, b) => a + b, 0) / healthScores.length)
      : 0;

    return {
      totalSites: sites.length,
      productionSites: args.environment ? undefined : allSites.filter((s) => s.environment === "production").length,
      stagingSites: args.environment ? undefined : allSites.filter((s) => s.environment === "staging").length,
      developmentSites: args.environment ? undefined : allSites.filter((s) => s.environment === "development").length,
      totalPlugins,
      outdatedPlugins,
      vulnerablePlugins,
      sitesUp,
      sitesDown,
      avgHealthScore,
      statuscakeUp: sites.filter((s) => s.statuscakeStatus === "up").length,
      statuscakeDown: sites.filter((s) => s.statuscakeStatus === "down").length,
      debugOn: sites.filter((s) => s.wpDebug === true).length,
    };
  },
});

export const getWithPlugins = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const site = await ctx.db.get(args.siteId);
    if (!site) return null;

    const account = await ctx.db.get(site.accountId);
    const plugins = await ctx.db
      .query("sitePlugins")
      .withIndex("by_site", (q) => q.eq("siteId", args.siteId))
      .collect();

    return {
      ...site,
      accountLabel: account?.label ?? "Unknown",
      plugins,
    };
  },
});


/**
 * Human-initiated removal of a site record. Sync never deletes records — a
 * site missing from Rocket.net is flagged and stays visible until someone
 * explicitly removes it here.
 */
export const removeSite = mutation({
  args: { siteId: v.id("sites") },
  returns: v.null(),
  handler: async (ctx, { siteId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const plugins = await ctx.db
      .query("sitePlugins")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
    for (const p of plugins) await ctx.db.delete(p._id);
    await ctx.db.delete(siteId);
    return null;
  },
});
