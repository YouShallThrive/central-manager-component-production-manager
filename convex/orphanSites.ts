/**
 * Orphan site records.
 *
 * credentialSync.syncSitesFromRocketnet inserts a second `sites` row per site
 * using Rocket.net's `staging_id`. When a staging environment is deleted the
 * Rocket.net ID stops existing, so those rows 404 forever and inflate the
 * "unreachable on Rocket.net" count in the PHP sweep.
 *
 * `audit` probes every site with every Rocket token and classifies the result.
 * `purge` deletes only the rows where EVERY token returns 404 (site genuinely
 * gone), along with their dependent sitePlugins rows. Rows that return 401/403
 * are never deleted — those are token problems, not dead sites.
 */
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

const ROCKET_API_BASE = "https://api.rocket.net/v1";
const CONCURRENCY = 5;

type Verdict = "ok" | "missing" | "auth" | "error";

async function probe(tokens: string[], rocketSiteId: number): Promise<Verdict> {
  let sawAuth = false;
  let sawMissing = false;
  for (const token of tokens) {
    let resp: Response;
    try {
      resp = await fetch(`${ROCKET_API_BASE}/sites/${rocketSiteId}/settings`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; ProductionManager/1.0)",
        },
      });
    } catch {
      return "error";
    }
    if (resp.ok) return "ok";
    if (resp.status === 404) sawMissing = true;
    else if (resp.status === 401 || resp.status === 403) sawAuth = true;
    else return "error";
  }
  if (sawAuth) return "auth";
  if (sawMissing) return "missing";
  return "error";
}

export const recordAudit = internalMutation({
  args: { value: v.string() },
  returns: v.null(),
  handler: async (ctx, { value }) => {
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "orphanAudit"))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { value });
    else await ctx.db.insert("settings", { key: "orphanAudit", value });
    return null;
  },
});

export const getAudit = internalQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "orphanAudit"))
      .unique();
    return row?.value;
  },
});

/** Deletes one site row plus its dependent sitePlugins / actionLogs links. */
export const deleteSite = internalMutation({
  args: { siteId: v.id("sites") },
  returns: v.null(),
  handler: async (ctx, { siteId }) => {
    const plugins = await ctx.db
      .query("sitePlugins")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
    for (const p of plugins) await ctx.db.delete(p._id);

    const logs = await ctx.db
      .query("actionLogs")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
    for (const l of logs) await ctx.db.patch(l._id, { siteId: undefined });

    await ctx.db.delete(siteId);
    return null;
  },
});

/**
 * Probes every site record. When `purge` is true, rows that 404 on every
 * token are deleted. Returns the classification tallies plus the affected
 * domains so the result can be reviewed before deleting anything.
 */
export const audit = internalAction({
  args: { purge: v.boolean() },
  handler: async (
    ctx,
    { purge },
  ): Promise<{
    total: number;
    ok: number;
    missing: number;
    auth: number;
    error: number;
    deleted: number;
    missingSites: Array<{ domain: string; siteId: number }>;
    authSites: Array<{ domain: string; siteId: number }>;
  }> => {
    try {
      await ctx.runAction(internal.credentialSync.pullFromServerManagement, {});
    } catch {
      // keep going with whatever tokens are already stored
    }

    const rows = await ctx.runQuery(internal.phpVersions.listForPhpSync, {});
    const tally = { ok: 0, missing: 0, auth: 0, error: 0 };
    const missingSites: Array<{ domain: string; siteId: number }> = [];
    const authSites: Array<{ domain: string; siteId: number }> = [];
    const toDelete: Array<{ _id: any; domain: string; siteId: number }> = [];

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const slice = rows.slice(i, i + CONCURRENCY);
      const verdicts = await Promise.all(
        slice.map((r: any) => probe(r.tokens, r.siteId)),
      );
      slice.forEach((r: any, idx: number) => {
        const verdict = verdicts[idx] as Verdict;
        tally[verdict] += 1;
        if (verdict === "missing") {
          missingSites.push({ domain: r.domain, siteId: r.siteId });
          toDelete.push({ _id: r._id, domain: r.domain, siteId: r.siteId });
        } else if (verdict === "auth") {
          authSites.push({ domain: r.domain, siteId: r.siteId });
        }
      });
    }

    let deleted = 0;
    if (purge) {
      for (const row of toDelete) {
        await ctx.runMutation(internal.orphanSites.deleteSite, { siteId: row._id });
        deleted += 1;
      }
    }

    await ctx.runMutation(internal.orphanSites.recordAudit, {
      value: JSON.stringify({
        ranAt: Date.now(),
        purge,
        total: rows.length,
        ...tally,
        deleted,
        missingSites,
        authSites,
      }),
    });

    return { total: rows.length, ...tally, deleted, missingSites, authSites };
  },
});
