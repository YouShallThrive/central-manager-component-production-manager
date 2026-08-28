/**
 * Orphan site records.
 *
 * credentialSync.syncSitesFromRocketnet inserts a second `sites` row per site
 * using Rocket.net's `staging_id`. When a staging environment is deleted the
 * Rocket.net ID stops existing, so those rows 404 forever and inflate the
 * "unreachable on Rocket.net" count in the PHP sweep.
 *
 * `audit` probes every site with every Rocket token and classifies the result,
 * then FLAGS the row (`rocketStatus`) so the dashboard can show it. Records are
 * never deleted automatically — Michael's rule: only a person removes a site
 * record. 401/403 is a token problem and is flagged separately from a 404.
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

/** Flags a row's Rocket.net presence. Never deletes anything. */
export const flagStatus = internalMutation({
  args: { siteId: v.id("sites"), status: v.string() },
  returns: v.null(),
  handler: async (ctx, { siteId, status }) => {
    const site = await ctx.db.get(siteId);
    if (!site) return null;
    if (status === "missing") {
      await ctx.db.patch(siteId, {
        rocketStatus: "missing",
        rocketMissingSince: site.rocketMissingSince ?? Date.now(),
      });
    } else if (status === "auth_error") {
      await ctx.db.patch(siteId, { rocketStatus: "auth_error" });
    } else {
      await ctx.db.patch(siteId, { rocketStatus: "ok", rocketMissingSince: undefined });
    }
    return null;
  },
});

/**
 * Deletes one site row plus its dependent sitePlugins / actionLogs links.
 * Only ever called from an explicit human action — never from a sweep.
 */
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
 * Probes every site record and flags each one's Rocket.net presence. Returns
 * the classification tallies plus the affected domains. Nothing is ever
 * deleted here — flagged rows stay visible in the dashboard for a human.
 */
export const audit = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    total: number;
    ok: number;
    missing: number;
    auth: number;
    error: number;
    flagged: number;
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
    const toFlag: Array<{ _id: any; domain: string; siteId: number; status: Verdict }> = [];

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
          toFlag.push({ _id: r._id, domain: r.domain, siteId: r.siteId, status: "missing" });
        } else if (verdict === "ok") {
          toFlag.push({ _id: r._id, domain: r.domain, siteId: r.siteId, status: "ok" });
        } else if (verdict === "auth") {
          authSites.push({ domain: r.domain, siteId: r.siteId });
        }
      });
    }

    // Flag, never delete. A site that has vanished from Rocket.net stays in the
    // dashboard marked "Missing from Rocket.net" until a person removes it.
    let flagged = 0;
    for (const row of toFlag) {
      await ctx.runMutation(internal.orphanSites.flagStatus, {
        siteId: row._id,
        status: row.status === "missing" ? "missing" : "ok",
      });
      if (row.status === "missing") flagged += 1;
    }
    for (const row of authSites) {
      const match = rows.find((r: any) => r.siteId === row.siteId);
      if (match) {
        await ctx.runMutation(internal.orphanSites.flagStatus, {
          siteId: match._id,
          status: "auth_error",
        });
      }
    }

    await ctx.runMutation(internal.orphanSites.recordAudit, {
      value: JSON.stringify({
        ranAt: Date.now(),
        total: rows.length,
        ...tally,
        flagged,
        missingSites,
        authSites,
      }),
    });

    return { total: rows.length, ...tally, flagged, missingSites, authSites };
  },
});

/**
 * Re-creates site records that were removed, flagged as missing from
 * Rocket.net. Used once to restore records deleted before the flag-only rule
 * existed; kept because a record should always be recoverable.
 */
export const restoreSites = internalMutation({
  args: {
    sites: v.array(
      v.object({
        domain: v.string(),
        siteId: v.number(),
        environment: v.optional(v.string()),
      }),
    ),
  },
  returns: v.object({
    restored: v.array(v.string()),
    skipped: v.array(v.string()),
  }),
  handler: async (ctx, { sites }) => {
    const account = await ctx.db.query("hostingAccounts").first();
    if (!account) throw new Error("No hosting account to attach restored sites to");

    const existing = await ctx.db.query("sites").collect();
    const byDomain = new Set(existing.map((s) => s.domain.toLowerCase()));

    const restored: string[] = [];
    const skipped: string[] = [];
    for (const site of sites) {
      if (byDomain.has(site.domain.toLowerCase())) {
        skipped.push(site.domain);
        continue;
      }
      const environment =
        site.environment === "staging" || site.domain.startsWith("staging.")
          ? ("staging" as const)
          : ("production" as const);
      await ctx.db.insert("sites", {
        accountId: account._id,
        siteId: site.siteId,
        domain: site.domain,
        environment,
        rocketStatus: "missing",
        rocketMissingSince: Date.now(),
      });
      restored.push(site.domain);
    }
    return { restored, skipped };
  },
});
