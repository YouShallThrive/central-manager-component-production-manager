import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";

// ── Queries ──────────────────────────────────────────────────

export const list = query({
  args: {
    search: v.optional(v.string()),
    typeFilter: v.optional(
      v.union(
        v.literal("php_lock"),
        v.literal("plugin_no_remove"),
        v.literal("plugin_version_lock"),
      ),
    ),
    severityFilter: v.optional(
      v.union(v.literal("critical"), v.literal("warning"), v.literal("info")),
    ),
    groupFilter: v.optional(v.string()),
  },
  returns: v.array(
    v.object({
      _id: v.id("siteConstraints"),
      _creationTime: v.number(),
      domain: v.string(),
      constraintType: v.union(
        v.literal("php_lock"),
        v.literal("plugin_no_remove"),
        v.literal("plugin_version_lock"),
      ),
      target: v.string(),
      targetLabel: v.string(),
      currentVersion: v.optional(v.string()),
      reason: v.string(),
      severity: v.union(
        v.literal("critical"),
        v.literal("warning"),
        v.literal("info"),
      ),
      action: v.string(),
      source: v.string(),
      group: v.optional(v.string()),
      addedAt: v.number(),
      updatedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    let constraints = await ctx.db.query("siteConstraints").collect();

    if (args.typeFilter) {
      constraints = constraints.filter(
        (c) => c.constraintType === args.typeFilter,
      );
    }

    if (args.severityFilter) {
      constraints = constraints.filter(
        (c) => c.severity === args.severityFilter,
      );
    }

    if (args.groupFilter) {
      constraints = constraints.filter((c) => c.group === args.groupFilter);
    }

    if (args.search) {
      const q = args.search.toLowerCase();
      constraints = constraints.filter(
        (c) =>
          c.domain.toLowerCase().includes(q) ||
          c.targetLabel.toLowerCase().includes(q) ||
          c.reason.toLowerCase().includes(q),
      );
    }

    // Sort by severity (critical first), then domain
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    constraints.sort((a, b) => {
      const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
      if (sevDiff !== 0) return sevDiff;
      return a.domain.localeCompare(b.domain);
    });

    return constraints;
  },
});

export const stats = query({
  args: {},
  returns: v.object({
    total: v.number(),
    critical: v.number(),
    warning: v.number(),
    info: v.number(),
    uniqueDomains: v.number(),
    byGroup: v.array(
      v.object({
        group: v.string(),
        count: v.number(),
      }),
    ),
  }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity)
      return {
        total: 0,
        critical: 0,
        warning: 0,
        info: 0,
        uniqueDomains: 0,
        byGroup: [],
      };

    const all = await ctx.db.query("siteConstraints").collect();

    const domains = new Set(all.map((c) => c.domain));
    const groupCounts = new Map<string, number>();
    for (const c of all) {
      const g = c.group ?? "other";
      groupCounts.set(g, (groupCounts.get(g) ?? 0) + 1);
    }

    return {
      total: all.length,
      critical: all.filter((c) => c.severity === "critical").length,
      warning: all.filter((c) => c.severity === "warning").length,
      info: all.filter((c) => c.severity === "info").length,
      uniqueDomains: domains.size,
      byGroup: Array.from(groupCounts.entries())
        .map(([group, count]) => ({ group, count }))
        .sort((a, b) => b.count - a.count),
    };
  },
});

export const getByDomain = query({
  args: { domain: v.string() },
  returns: v.array(
    v.object({
      _id: v.id("siteConstraints"),
      _creationTime: v.number(),
      domain: v.string(),
      constraintType: v.union(
        v.literal("php_lock"),
        v.literal("plugin_no_remove"),
        v.literal("plugin_version_lock"),
      ),
      target: v.string(),
      targetLabel: v.string(),
      currentVersion: v.optional(v.string()),
      reason: v.string(),
      severity: v.union(
        v.literal("critical"),
        v.literal("warning"),
        v.literal("info"),
      ),
      action: v.string(),
      source: v.string(),
      group: v.optional(v.string()),
      addedAt: v.number(),
      updatedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    return await ctx.db
      .query("siteConstraints")
      .withIndex("by_domain", (q) => q.eq("domain", args.domain))
      .collect();
  },
});

// ── Mutations ────────────────────────────────────────────────

export const add = mutation({
  args: {
    domain: v.string(),
    constraintType: v.union(
      v.literal("php_lock"),
      v.literal("plugin_no_remove"),
      v.literal("plugin_version_lock"),
    ),
    target: v.string(),
    targetLabel: v.string(),
    currentVersion: v.optional(v.string()),
    reason: v.string(),
    severity: v.union(
      v.literal("critical"),
      v.literal("warning"),
      v.literal("info"),
    ),
    action: v.string(),
    source: v.string(),
    group: v.optional(v.string()),
  },
  returns: v.id("siteConstraints"),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    return await ctx.db.insert("siteConstraints", {
      ...args,
      addedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("siteConstraints") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    await ctx.db.delete(args.id);
    return null;
  },
});

export const update = mutation({
  args: {
    id: v.id("siteConstraints"),
    currentVersion: v.optional(v.string()),
    reason: v.optional(v.string()),
    severity: v.optional(
      v.union(v.literal("critical"), v.literal("warning"), v.literal("info")),
    ),
    action: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const { id, ...updates } = args;
    const filtered: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [k, val] of Object.entries(updates)) {
      if (val !== undefined) filtered[k] = val;
    }
    await ctx.db.patch(id, filtered);
    return null;
  },
});

// ── Bulk seed (internal) ─────────────────────────────────────

export const bulkInsert = internalMutation({
  args: {
    items: v.array(
      v.object({
        domain: v.string(),
        constraintType: v.union(
          v.literal("php_lock"),
          v.literal("plugin_no_remove"),
          v.literal("plugin_version_lock"),
        ),
        target: v.string(),
        targetLabel: v.string(),
        currentVersion: v.optional(v.string()),
        reason: v.string(),
        severity: v.union(
          v.literal("critical"),
          v.literal("warning"),
          v.literal("info"),
        ),
        action: v.string(),
        source: v.string(),
        group: v.optional(v.string()),
        addedAt: v.number(),
      }),
    ),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    for (const item of args.items) {
      await ctx.db.insert("siteConstraints", item);
    }
    return args.items.length;
  },
});

export const clearAll = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const all = await ctx.db.query("siteConstraints").collect();
    for (const c of all) {
      await ctx.db.delete(c._id);
    }
    return null;
  },
});
