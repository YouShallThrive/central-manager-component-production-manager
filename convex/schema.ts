import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const schema = defineSchema({
  ...authTables,

  // Hosting accounts (synced from Server Management)
  hostingAccounts: defineTable({
    label: v.string(),
    provider: v.string(), // "rocket", "rocketnet", "cloudways"
    apiToken: v.string(),
    status: v.union(
      v.literal("connected"),
      v.literal("error"),
      v.literal("expired"),
    ),
    lastSyncedAt: v.optional(v.number()),
  }),

  // Production WordPress sites
  sites: defineTable({
    accountId: v.id("hostingAccounts"),
    siteId: v.number(), // Rocket.net site ID
    domain: v.string(),
    environment: v.union(
      v.literal("production"),
      v.literal("staging"),
      v.literal("development"),
    ),
    wpVersion: v.optional(v.string()),
    phpVersion: v.optional(v.string()),
    // Plugin tracking
    pluginCount: v.optional(v.number()),
    outdatedCount: v.optional(v.number()),
    vulnerableCount: v.optional(v.number()),
    // Health & performance
    healthScore: v.optional(v.number()), // 0-100
    sslExpiry: v.optional(v.number()), // timestamp
    lastUptimeCheck: v.optional(v.number()),
    uptimeStatus: v.optional(v.union(
      v.literal("up"),
      v.literal("down"),
      v.literal("unknown"),
    )),
    responseTimeMs: v.optional(v.number()),
    // Backup tracking
    lastBackupAt: v.optional(v.number()),
    backupFrequency: v.optional(v.string()),
    // StatusCake uptime monitoring
    statuscakeTestId: v.optional(v.string()),
    statuscakeStatus: v.optional(v.union(
      v.literal("up"),
      v.literal("down"),
      v.literal("unknown"),
    )),
    statuscakeUptime: v.optional(v.number()), // percentage e.g. 99.99
    statuscakeLastChecked: v.optional(v.number()), // timestamp
    // Timestamps
    lastSyncedAt: v.optional(v.number()),
    lastHealthCheckAt: v.optional(v.number()),
    // WP_DEBUG tracking
    wpDebug: v.optional(v.boolean()),
    wpDebugLog: v.optional(v.boolean()),
    wpDebugCheckedAt: v.optional(v.number()), // timestamp of last check
    // Staging reference
    hasStagingSite: v.optional(v.boolean()),
    stagingSiteId: v.optional(v.number()),
    stagingDomain: v.optional(v.string()),
  })
    .index("by_domain", ["domain"])
    .index("by_account", ["accountId"])
    .index("by_environment", ["environment"])
    .index("by_health_score", ["healthScore"]),

  // Plugins installed on each site
  sitePlugins: defineTable({
    siteId: v.id("sites"),
    slug: v.string(),
    name: v.string(),
    version: v.string(),
    isActive: v.boolean(),
    isOutdated: v.boolean(),
    hasVulnerability: v.boolean(),
    latestVersion: v.optional(v.string()),
    lastCheckedAt: v.optional(v.number()),
  })
    .index("by_site", ["siteId"])
    .index("by_slug", ["slug"])
    .index("by_site_slug", ["siteId", "slug"]),

  // Action log for audit trail
  actionLogs: defineTable({
    siteId: v.optional(v.id("sites")),
    action: v.string(),
    details: v.string(),
    status: v.union(
      v.literal("success"),
      v.literal("error"),
      v.literal("info"),
    ),
    userId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_site", ["siteId"])
    .index("by_created", ["createdAt"]),

  // App settings
  settings: defineTable({
    key: v.string(),
    value: v.string(),
  }).index("by_key", ["key"]),
});

export default schema;
