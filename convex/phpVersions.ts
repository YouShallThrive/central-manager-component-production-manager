/**
 * PHP version sync.
 *
 * Rocket.net's /sites list does NOT include the PHP version — it is only
 * available per site via GET /sites/{id}/settings -> current_php_version.
 * This runs as its own batched sweep: one settings call per site,
 * BATCH_SIZE sites per action, scheduling the next batch until done.
 */
import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";

const ROCKET_API_BASE = "https://api.rocket.net/v1";
const BATCH_SIZE = 20;
const CONCURRENCY = 5;

class AuthOrMissingError extends Error {
  status: number;
  constructor(status: number) {
    super(`Rocket.net returned ${status}`);
    this.status = status;
  }
}

/** Tries each candidate token until one resolves the site. */
async function fetchPhpVersionWithFallback(
  tokens: string[],
  rocketSiteId: number,
): Promise<{ version?: string; lastStatus?: number }> {
  let lastStatus: number | undefined;
  for (const token of tokens) {
    try {
      const version = await fetchPhpVersion(token, rocketSiteId);
      return { version };
    } catch (e) {
      if (e instanceof AuthOrMissingError) {
        lastStatus = e.status;
        continue;
      }
      throw e;
    }
  }
  return { version: undefined, lastStatus };
}

async function fetchPhpVersion(token: string, rocketSiteId: number): Promise<string | undefined> {
  const resp = await fetch(`${ROCKET_API_BASE}/sites/${rocketSiteId}/settings`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; ProductionManager/1.0)",
    },
  });

  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403 || resp.status === 404) {
      // 401/403 = wrong or expired token, 404 = site not in this token's account.
      // Both mean "try the next token" to the caller.
      throw new AuthOrMissingError(resp.status);
    }
    throw new Error(`Rocket.net API error (${resp.status}) fetching settings for site ${rocketSiteId}`);
  }

  const body = (await resp.json()) as { result?: { current_php_version?: string } };
  const version = body.result?.current_php_version;
  return version ? String(version) : undefined;
}

/**
 * Sites plus every candidate Rocket.net token.
 *
 * Some sites still point at legacy hosting account rows (e.g. provider
 * "rocketnet" labelled "YST Rocket.net") whose JWT expired long ago, so using
 * only the site's own account token 401s the whole sweep. We therefore hand the
 * sweep the site's own token first and every other Rocket token as fallback.
 */
export const listForPhpSync = internalQuery({
  args: {},
  handler: async (ctx) => {
    const accounts = await ctx.db.query("hostingAccounts").collect();
    const rocketTokens = accounts
      .filter((a) => a.provider === "rocket" || a.provider === "rocketnet")
      .filter((a) => !!a.apiToken)
      .sort((a, b) => (b.lastSyncedAt ?? 0) - (a.lastSyncedAt ?? 0))
      .map((a) => a.apiToken);

    const tokenCache = new Map<string, string>();
    for (const a of accounts) tokenCache.set(a._id, a.apiToken ?? "");

    const sites = await ctx.db.query("sites").collect();
    const rows = [];
    for (const site of sites) {
      const own = tokenCache.get(site.accountId) ?? "";
      const tokens = [own, ...rocketTokens].filter((t, i, arr) => !!t && arr.indexOf(t) === i);
      rows.push({ _id: site._id, siteId: site.siteId, domain: site.domain, apiToken: own, tokens });
    }
    return rows;
  },
});

export const setPhpVersion = internalMutation({
  args: {
    siteId: v.id("sites"),
    phpVersion: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.siteId, {
      phpVersion: args.phpVersion,
      phpCheckedAt: Date.now(),
    });
    return null;
  },
});

/** Rolling sweep tally, stored in settings so the dashboard can surface failures. */
export const recordSweep = internalMutation({
  args: {
    reset: v.boolean(),
    checked: v.number(),
    errors: v.number(),
    done: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "phpSweep"))
      .unique();
    let prev = { checked: 0, errors: 0, startedAt: Date.now(), finishedAt: 0 };
    if (existing && !args.reset) {
      try {
        prev = { ...prev, ...(JSON.parse(existing.value) as typeof prev) };
      } catch {
        // ignore malformed previous value
      }
    }
    const value = JSON.stringify({
      checked: prev.checked + args.checked,
      errors: prev.errors + args.errors,
      startedAt: args.reset ? Date.now() : prev.startedAt,
      finishedAt: args.done ? Date.now() : 0,
    });
    if (existing) await ctx.db.patch(existing._id, { value });
    else await ctx.db.insert("settings", { key: "phpSweep", value });
    return null;
  },
});

export const getSweep = internalQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "phpSweep"))
      .unique();
    return row?.value;
  },
});

export const syncBatch = internalAction({
  args: { offset: v.number() },
  returns: v.object({
    checked: v.number(),
    errors: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, { offset }): Promise<{ checked: number; errors: number; hasMore: boolean }> => {
    // Rocket.net JWTs expire ~weekly; refresh credentials from Server Management
    // before the first batch so a stale token doesn't 401 the whole sweep.
    if (offset === 0) {
      try {
        await ctx.runAction(internal.credentialSync.pullFromServerManagement, {});
      } catch (e) {
        console.warn("Credential sync warning:", e instanceof Error ? e.message : String(e));
      }
    }

    const sites: Array<{
      _id: string;
      siteId: number;
      domain: string;
      apiToken: string;
      tokens: string[];
    }> = await ctx.runQuery(internal.phpVersions.listForPhpSync, {});
    const batch = sites.slice(offset, offset + BATCH_SIZE);
    if (batch.length === 0) return { checked: 0, errors: 0, hasMore: false };

    let checked = 0;
    let errors = 0;

    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      const slice = batch.slice(i, i + CONCURRENCY);
      await Promise.all(
        slice.map(async (site) => {
          const tokens = site.tokens?.length ? site.tokens : site.apiToken ? [site.apiToken] : [];
          if (tokens.length === 0) {
            errors++;
            return;
          }
          try {
            const { version, lastStatus } = await fetchPhpVersionWithFallback(tokens, site.siteId);
            if (version === undefined && lastStatus) {
              errors++;
              console.error(`PHP version sync: ${site.domain} unresolved (HTTP ${lastStatus})`);
              return;
            }
            await ctx.runMutation(internal.phpVersions.setPhpVersion, {
              siteId: site._id as any,
              phpVersion: version,
            });
            checked++;
          } catch (e) {
            errors++;
            console.error(
              `PHP version sync failed for ${site.domain}:`,
              e instanceof Error ? e.message : String(e),
            );
          }
        }),
      );
    }

    const hasMore = offset + BATCH_SIZE < sites.length;
    await ctx.runMutation(internal.phpVersions.recordSweep, {
      reset: offset === 0,
      checked,
      errors,
      done: !hasMore,
    });
    if (hasMore) {
      await ctx.scheduler.runAfter(500, internal.phpVersions.syncBatch, {
        offset: offset + BATCH_SIZE,
      });
    }

    return { checked, errors, hasMore };
  },
});

/** Kick off a full PHP version sweep across every known site. */
export const syncAll = action({
  args: {},
  returns: v.object({ scheduled: v.boolean(), sites: v.number() }),
  handler: async (ctx): Promise<{ scheduled: boolean; sites: number }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const sites: Array<unknown> = await ctx.runQuery(internal.phpVersions.listForPhpSync, {});
    await ctx.scheduler.runAfter(0, internal.phpVersions.syncBatch, { offset: 0 });
    return { scheduled: true, sites: sites.length };
  },
});

/** Fleet-wide PHP version breakdown for the dashboard summary. */
export const summary = query({
  args: {},
  returns: v.object({
    total: v.number(),
    known: v.number(),
    unknown: v.number(),
    critical: v.number(),
    warning: v.number(),
    ok: v.number(),
    lastCheckedAt: v.optional(v.number()),
    unresolved: v.number(),
    byVersion: v.array(v.object({ version: v.string(), count: v.number() })),
  }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return {
        total: 0,
        known: 0,
        unknown: 0,
        critical: 0,
        warning: 0,
        ok: 0,
        lastCheckedAt: undefined,
        unresolved: 0,
        byVersion: [],
      };
    }

    const sweepRow = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "phpSweep"))
      .unique();
    let unresolved = 0;
    if (sweepRow) {
      try {
        unresolved = (JSON.parse(sweepRow.value) as { errors?: number }).errors ?? 0;
      } catch {
        unresolved = 0;
      }
    }

    const sites = await ctx.db.query("sites").collect();
    const counts = new Map<string, number>();
    let known = 0;
    let critical = 0;
    let warning = 0;
    let ok = 0;
    let lastCheckedAt: number | undefined;

    for (const s of sites) {
      if (s.phpCheckedAt && (!lastCheckedAt || s.phpCheckedAt > lastCheckedAt)) {
        lastCheckedAt = s.phpCheckedAt;
      }
      if (!s.phpVersion) continue;
      known++;
      counts.set(s.phpVersion, (counts.get(s.phpVersion) ?? 0) + 1);
      const num = parseFloat(s.phpVersion);
      if (Number.isNaN(num)) continue;
      if (num < 8.0) critical++;
      else if (num < 8.1) warning++;
      else ok++;
    }

    const byVersion = Array.from(counts.entries())
      .map(([version, count]) => ({ version, count }))
      .sort((a, b) => parseFloat(b.version) - parseFloat(a.version));

    return {
      total: sites.length,
      known,
      unknown: sites.length - known,
      critical,
      warning,
      ok,
      lastCheckedAt,
      unresolved,
      byVersion,
    };
  },
});
