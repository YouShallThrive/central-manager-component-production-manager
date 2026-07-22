/**
 * Credential sync — pulls API credentials from the central Server Management
 * component and mirrors them into the local hostingAccounts table.
 * Then syncs sites and plugins from Rocket.net.
 */
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

declare const process: { env: Record<string, string | undefined> };

interface Credential {
  id: string;
  provider: string;
  label: string;
  apiToken: string;
  apiUrl?: string;
  username?: string;
  extraConfig?: Record<string, unknown>;
}

interface RocketSite {
  id: number;
  domain: string;
  display_domain?: string;
  rocket_url?: string;
  location?: string;
  production?: number; // 1 = production
  staging?: { staging_id?: number; staging_status?: string } | Record<string, never>;
  status?: string;
  label?: string;
}

interface RocketPlugin {
  name: string; // slug
  title: string; // display name
  version: string;
  status: string; // "active" | "inactive" | "must-use"
  update: string; // "none" | "available"
  update_version?: string; // latest version if update available
}

// ── Pull credentials from Server Management ─────────────────

export const pullFromServerManagement = internalAction({
  args: {},
  returns: v.object({
    synced: v.number(),
    removed: v.number(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx): Promise<{ synced: number; removed: number; error?: string }> => {
    let smUrl = process.env.SERVER_MANAGEMENT_URL;
    let secret = process.env.SSO_SHARED_SECRET;

    // Fallback to settings table if env vars not set
    if (!smUrl || !secret) {
      const config: { serverManagementUrl: string; ssoSharedSecret: string } | null = await ctx.runQuery(internal.credentialSync.getConfig, {});
      if (config) {
        smUrl = smUrl || config.serverManagementUrl;
        secret = secret || config.ssoSharedSecret;
      }
    }

    if (!smUrl || !secret) {
      return { synced: 0, removed: 0, error: "SERVER_MANAGEMENT_URL or SSO_SHARED_SECRET not configured" };
    }

    try {
      const resp = await fetch(`${smUrl}/api/credentials`, {
        headers: { Authorization: `Bearer ${secret}` },
      });

      if (!resp.ok) {
        const text = await resp.text();
        return { synced: 0, removed: 0, error: `Server Management API error (${resp.status}): ${text}` };
      }

      const data = (await resp.json()) as { credentials: Credential[] };
      const remoteCredentials = data.credentials ?? [];

      const localAccounts = await ctx.runQuery(internal.credentialSync.listAllAccounts, {});
      const remoteLabels = new Set(remoteCredentials.map((c) => c.label));

      let synced = 0;
      for (const cred of remoteCredentials) {
        const existing = localAccounts.find((a: { label: string }) => a.label === cred.label);

        if (existing) {
          await ctx.runMutation(internal.credentialSync.patchAccount, {
            id: existing._id,
            label: cred.label,
            provider: cred.provider || "rocketnet",
            apiToken: cred.apiToken,
          });
        } else {
          await ctx.runMutation(internal.credentialSync.insertAccount, {
            label: cred.label,
            provider: cred.provider || "rocketnet",
            apiToken: cred.apiToken,
          });
        }
        synced++;
      }

      let removed = 0;
      for (const local of localAccounts) {
        if (!remoteLabels.has(local.label)) {
          await ctx.runMutation(internal.credentialSync.cascadeDeleteAccount, {
            id: local._id,
          });
          removed++;
        }
      }

      return { synced, removed };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { synced: 0, removed: 0, error: msg };
    }
  },
});

// ── Sync sites and plugins from Rocket.net ──────────────────

export const syncSitesFromRocketnet = internalAction({
  args: {
    accountId: v.id("hostingAccounts"),
    apiToken: v.string(),
    label: v.string(),
  },
  returns: v.object({
    sitesFound: v.number(),
    pluginsFound: v.number(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const baseUrl = "https://api.rocket.net/v1";

    try {
      // Fetch all sites from Rocket.net
      const resp = await fetch(`${baseUrl}/sites?per_page=250`, {
        headers: {
          Authorization: `Bearer ${args.apiToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; ConvexBackend/1.0)",
        },
      });

      if (!resp.ok) {
        const text = await resp.text();
        return { sitesFound: 0, pluginsFound: 0, error: `Rocket.net API error (${resp.status}): ${text}` };
      }

      const data = (await resp.json()) as { body?: { result: RocketSite[] }; result?: RocketSite[] };
      const sites = data.body?.result ?? data.result ?? [];
      let pluginsFound = 0;

      let totalSiteEntries = 0;

      for (const site of sites) {
        // Production site entry
        const hasStagingId =
          site.staging &&
          typeof site.staging === "object" &&
          "staging_id" in site.staging &&
          (site.staging as { staging_id?: number }).staging_id;

        await ctx.runMutation(internal.credentialSync.upsertSite, {
          accountId: args.accountId,
          siteId: site.id,
          domain: site.domain,
          environment: "production",
          stagingDomain: hasStagingId ? `${site.domain} (staging)` : undefined,
        });
        totalSiteEntries++;

        // If site has staging, create a separate staging entry
        if (hasStagingId) {
          const stagingId = (site.staging as { staging_id: number }).staging_id;
          // Staging domain is usually <rocket_url>-staging.wpdns.site but we'll
          // use a clear label: "staging.domain.com" or fetch it later
          const stagingDomain = `staging.${site.domain}`;
          await ctx.runMutation(internal.credentialSync.upsertSite, {
            accountId: args.accountId,
            siteId: stagingId,
            domain: stagingDomain,
            environment: "staging",
          });
          totalSiteEntries++;
        }
      }

      return { sitesFound: totalSiteEntries, pluginsFound };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { sitesFound: 0, pluginsFound: 0, error: msg };
    }
  },
});

// Full sync: credentials → sites → plugins (all in one)
export const fullSync = internalAction({
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
    const errors: string[] = [];

    // Step 1: Sync credentials from Server Management
    const credResult: { synced: number; removed: number; error?: string } =
      await ctx.runAction(internal.credentialSync.pullFromServerManagement, {});
    if (credResult.error) {
      errors.push(`Credentials: ${credResult.error}`);
    }

    // Step 2: For each Rocket.net account, sync sites
    const accounts = await ctx.runQuery(internal.credentialSync.listAllAccounts, {});
    const rocketAccounts = accounts.filter(
      (a: { provider: string }) => a.provider === "rocket" || a.provider === "rocketnet",
    );
    let totalSites = 0;
    let totalPlugins = 0;

    for (const account of rocketAccounts) {
      const siteResult = await ctx.runAction(internal.credentialSync.syncSitesFromRocketnet, {
        accountId: account._id,
        apiToken: account.apiToken,
        label: account.label,
      });

      totalSites += siteResult.sitesFound;
      totalPlugins += siteResult.pluginsFound;

      if (siteResult.error) {
        errors.push(`${account.label}: ${siteResult.error}`);
      }

      // Update last synced timestamp
      await ctx.runMutation(internal.credentialSync.touchAccount, { id: account._id });
    }

    // Step 3: Schedule plugin sync for all sites (runs in background)
    const pluginResult: { scheduled: number; error?: string } =
      await ctx.runAction(internal.credentialSync.batchSyncAllPlugins, {});
    if (pluginResult.error) {
      errors.push(`Plugin sync: ${pluginResult.error}`);
    }

    // Step 4: StatusCake sync is handled via external push endpoint
    // (StatusCake API blocks Convex cloud IPs, so direct fetch doesn't work)
    // Use POST /api/statuscake/push to push data externally

    return {
      credentialsSynced: credResult.synced,
      totalSites,
      totalPlugins: pluginResult.scheduled,
      errors,
    };
  },
});

// ── Internal queries/mutations ──────────────────────────────

export const listAllAccounts = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("hostingAccounts").collect();
  },
});

export const patchAccount = internalMutation({
  args: {
    id: v.id("hostingAccounts"),
    label: v.string(),
    provider: v.string(),
    apiToken: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      label: args.label,
      provider: args.provider,
      apiToken: args.apiToken,
      status: "connected" as const,
    });
    return null;
  },
});

export const insertAccount = internalMutation({
  args: {
    label: v.string(),
    provider: v.string(),
    apiToken: v.string(),
  },
  returns: v.id("hostingAccounts"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("hostingAccounts", {
      label: args.label,
      provider: args.provider,
      apiToken: args.apiToken,
      status: "connected" as const,
    });
  },
});

export const upsertAccount = internalMutation({
  args: {
    label: v.string(),
    provider: v.string(),
    apiToken: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("hostingAccounts")
      .filter((q) => q.eq(q.field("label"), args.label))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        provider: args.provider,
        apiToken: args.apiToken,
        status: "connected" as const,
      });
    } else {
      await ctx.db.insert("hostingAccounts", {
        label: args.label,
        provider: args.provider,
        apiToken: args.apiToken,
        status: "connected" as const,
      });
    }
    return null;
  },
});

export const touchAccount = internalMutation({
  args: { id: v.id("hostingAccounts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { lastSyncedAt: Date.now() });
    return null;
  },
});

export const cascadeDeleteAccount = internalMutation({
  args: { id: v.id("hostingAccounts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sites = await ctx.db
      .query("sites")
      .withIndex("by_account", (q) => q.eq("accountId", args.id))
      .collect();

    for (const site of sites) {
      const plugins = await ctx.db
        .query("sitePlugins")
        .withIndex("by_site", (q) => q.eq("siteId", site._id))
        .collect();
      for (const p of plugins) await ctx.db.delete(p._id);
      await ctx.db.delete(site._id);
    }

    await ctx.db.delete(args.id);
    return null;
  },
});

export const upsertSite = internalMutation({
  args: {
    accountId: v.id("hostingAccounts"),
    siteId: v.number(),
    domain: v.string(),
    environment: v.union(v.literal("staging"), v.literal("production"), v.literal("development")),
    stagingDomain: v.optional(v.string()),
    wpVersion: v.optional(v.string()),
    phpVersion: v.optional(v.string()),
  },
  returns: v.id("sites"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("sites")
      .withIndex("by_domain", (q) => q.eq("domain", args.domain))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        lastSyncedAt: Date.now(),
      });
      return existing._id;
    }

    return await ctx.db.insert("sites", {
      ...args,
      lastSyncedAt: Date.now(),
    });
  },
});

export const clearSitePlugins = internalMutation({
  args: { siteId: v.id("sites") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const plugins = await ctx.db
      .query("sitePlugins")
      .withIndex("by_site", (q) => q.eq("siteId", args.siteId))
      .collect();
    for (const p of plugins) await ctx.db.delete(p._id);
    return null;
  },
});

export const insertSitePlugin = internalMutation({
  args: {
    siteId: v.id("sites"),
    slug: v.string(),
    name: v.string(),
    version: v.string(),
    isActive: v.boolean(),
    updateAvailable: v.boolean(),
    latestVersion: v.optional(v.string()),
  },
  returns: v.id("sitePlugins"),
  handler: async (ctx, args) => {
    // Destructure to avoid spreading updateAvailable (not in schema)
    const { updateAvailable, ...rest } = args;
    return await ctx.db.insert("sitePlugins", {
      ...rest,
      isOutdated: updateAvailable,
      hasVulnerability: false,
      lastCheckedAt: Date.now(),
    });
  },
});

export const updateSitePluginCounts = internalMutation({
  args: {
    siteId: v.id("sites"),
    pluginCount: v.number(),
    outdatedCount: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.siteId, {
      pluginCount: args.pluginCount,
      outdatedCount: args.outdatedCount,
      lastSyncedAt: Date.now(),
    });
    return null;
  },
});

// ── Sync plugins for a single site (on-demand) ─────────────

export const syncSitePlugins = internalAction({
  args: {
    siteDocId: v.id("sites"),
    rocketSiteId: v.number(),
    apiToken: v.string(),
  },
  returns: v.object({
    pluginsFound: v.number(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<{ pluginsFound: number; error?: string }> => {
    const baseUrl = "https://api.rocket.net/v1";

    // Check WP_DEBUG status via WP-CLI (non-blocking — runs alongside plugin sync)
    try {
      const debugChecks = await Promise.allSettled([
        fetch(`${baseUrl}/sites/${args.rocketSiteId}/wpcli`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${args.apiToken}`,
            Accept: "application/json",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (compatible; ConvexBackend/1.0)",
          },
          body: JSON.stringify({ command: "config get WP_DEBUG" }),
        }),
        fetch(`${baseUrl}/sites/${args.rocketSiteId}/wpcli`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${args.apiToken}`,
            Accept: "application/json",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (compatible; ConvexBackend/1.0)",
          },
          body: JSON.stringify({ command: "config get WP_DEBUG_LOG" }),
        }),
      ]);

      let wpDebug = false;
      let wpDebugLog = false;

      if (debugChecks[0].status === "fulfilled" && debugChecks[0].value.ok) {
        const data = await debugChecks[0].value.json();
        const response = data?.result?.response;
        if (response) {
          try {
            const parsed = JSON.parse(response);
            const val = parsed?.data;
            wpDebug = val === "1" || val === "true" || val === true || val === 1;
          } catch { /* not defined or parse error — treat as false */ }
        }
      }

      if (debugChecks[1].status === "fulfilled" && debugChecks[1].value.ok) {
        const data = await debugChecks[1].value.json();
        const response = data?.result?.response;
        if (response) {
          try {
            const parsed = JSON.parse(response);
            const val = parsed?.data;
            wpDebugLog = val === "1" || val === "true" || val === true || val === 1;
          } catch { /* not defined or parse error — treat as false */ }
        }
      }

      await ctx.runMutation(internal.credentialSync.updateWpDebugStatus, {
        siteId: args.siteDocId,
        wpDebug,
        wpDebugLog,
      });
    } catch {
      // WP_DEBUG check is best-effort — don't fail the whole sync
    }

    try {
      const pluginResp = await fetch(`${baseUrl}/sites/${args.rocketSiteId}/plugins`, {
        headers: {
          Authorization: `Bearer ${args.apiToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; ConvexBackend/1.0)",
        },
      });

      if (!pluginResp.ok) {
        const text = await pluginResp.text();
        return { pluginsFound: 0, error: `API error (${pluginResp.status}): ${text.slice(0, 200)}` };
      }

      const pluginData = (await pluginResp.json()) as {
        body?: { result: RocketPlugin[] };
        result?: RocketPlugin[];
      };
      const plugins = pluginData.body?.result ?? pluginData.result ?? [];

      // Clear old plugins for this site
      await ctx.runMutation(internal.credentialSync.clearSitePlugins, { siteId: args.siteDocId });

      // Insert fresh plugins
      for (const plugin of plugins) {
        const hasUpdate = plugin.update === "available";
        await ctx.runMutation(internal.credentialSync.insertSitePlugin, {
          siteId: args.siteDocId,
          slug: plugin.name,
          name: plugin.title || plugin.name,
          version: plugin.version,
          isActive: plugin.status === "active",
          updateAvailable: hasUpdate,
          latestVersion: hasUpdate ? plugin.update_version : undefined,
        });
      }

      // Update site plugin counts
      const outdated = plugins.filter((p: RocketPlugin) => p.update === "available").length;
      await ctx.runMutation(internal.credentialSync.updateSitePluginCounts, {
        siteId: args.siteDocId,
        pluginCount: plugins.length,
        outdatedCount: outdated,
      });

      return { pluginsFound: plugins.length };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { pluginsFound: 0, error: msg };
    }
  },
});

// ── Batch sync: schedule plugin sync for ALL sites ──────────

export const batchSyncAllPlugins = internalAction({
  args: {},
  returns: v.object({
    scheduled: v.number(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx): Promise<{ scheduled: number; error?: string }> => {
    try {
      // Get all sites with their accounts
      const sites = await ctx.runQuery(internal.credentialSync.listAllSitesWithAccounts, {});

      let scheduled = 0;
      for (const site of sites) {
        if (site.apiToken) {
          // Schedule each site's plugin sync as a separate action (runs in parallel)
          await ctx.scheduler.runAfter(0, internal.credentialSync.syncSitePlugins, {
            siteDocId: site._id,
            rocketSiteId: site.siteId,
            apiToken: site.apiToken,
          });
          scheduled++;
        }
      }

      return { scheduled };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { scheduled: 0, error: msg };
    }
  },
});

export const listAllSitesWithAccounts = internalQuery({
  args: {},
  handler: async (ctx) => {
    const sites = await ctx.db.query("sites").collect();
    const accountCache = new Map<string, string>();

    const results = [];
    for (const site of sites) {
      let apiToken = accountCache.get(site.accountId);
      if (apiToken === undefined) {
        const account = await ctx.db.get(site.accountId);
        apiToken = account?.apiToken ?? "";
        accountCache.set(site.accountId, apiToken);
      }
      results.push({
        _id: site._id,
        siteId: site.siteId,
        domain: site.domain,
        apiToken,
      });
    }
    return results;
  },
});

// ── Update WP_DEBUG status on a site ────────────────────────

export const updateWpDebugStatus = internalMutation({
  args: {
    siteId: v.id("sites"),
    wpDebug: v.boolean(),
    wpDebugLog: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.siteId, {
      wpDebug: args.wpDebug,
      wpDebugLog: args.wpDebugLog,
      wpDebugCheckedAt: Date.now(),
    });
    return null;
  },
});

// ── Settings-based config fallback ──────────────────────────

export const getConfig = internalQuery({
  args: {},
  handler: async (ctx) => {
    const urlSetting = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "server_management_url"))
      .first();
    const secretSetting = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "sso_shared_secret"))
      .first();

    if (!urlSetting || !secretSetting) return null;
    return {
      serverManagementUrl: urlSetting.value,
      ssoSharedSecret: secretSetting.value,
    };
  },
});

export const upsertConfig = internalMutation({
  args: {
    serverManagementUrl: v.string(),
    ssoSharedSecret: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const pairs = [
      { key: "server_management_url", value: args.serverManagementUrl },
      { key: "sso_shared_secret", value: args.ssoSharedSecret },
    ];
    for (const { key, value } of pairs) {
      const existing = await ctx.db
        .query("settings")
        .withIndex("by_key", (q) => q.eq("key", key))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, { value });
      } else {
        await ctx.db.insert("settings", { key, value });
      }
    }
    return null;
  },
});
