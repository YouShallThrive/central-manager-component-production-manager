/**
 * StatusCake uptime sync — pulls uptime test results from StatusCake API
 * and matches them to production sites by domain.
 */
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

declare const process: { env: Record<string, string | undefined> };

interface StatusCakeTest {
  id: number;
  name: string;
  website_url: string;
  status: string; // "up" | "down"
  uptime: number; // percentage
  check_rate: number;
  paused: boolean;
}

interface StatusCakeResponse {
  data: StatusCakeTest[];
  metadata: {
    page: number;
    per_page: number;
    page_count: number;
    total_count: number;
  };
}

/**
 * Normalize a domain for matching:
 * - Strip protocol (https://, http://)
 * - Strip trailing slashes
 * - Strip www. prefix
 * - Lowercase
 */
function normalizeDomain(input: string): string {
  let d = input.toLowerCase().trim();
  d = d.replace(/^https?:\/\//, "");
  d = d.replace(/\/+$/, "");
  d = d.replace(/^www\./, "");
  return d;
}

// ── Fetch StatusCake API key from Integrations component ────

async function getStatusCakeApiKey(): Promise<string | null> {
  // Try direct env var first
  const directKey = process.env.STATUSCAKE_API_KEY;
  if (directKey) return directKey;

  // Fall back to Integrations component
  const integrationsUrl = process.env.INTEGRATIONS_URL;
  const secret = process.env.SSO_SHARED_SECRET;

  if (!integrationsUrl || !secret) {
    return null;
  }

  try {
    const resp = await fetch(`${integrationsUrl}/api/credentials?integration=statuscake`, {
      headers: { Authorization: `Bearer ${secret}` },
    });

    if (!resp.ok) return null;

    const data = (await resp.json()) as { values: { key: string; value: string }[] };
    const apiKeyEntry = data.values?.find((v: { key: string }) => v.key === "api_key");
    return apiKeyEntry?.value ?? null;
  } catch {
    return null;
  }
}

// ── Fetch all uptime tests (paginated) ──────────────────────

async function fetchAllTests(apiKey: string): Promise<StatusCakeTest[]> {
  const all: StatusCakeTest[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const resp = await fetch(
      `https://api.statuscake.com/v1/uptime?limit=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          "User-Agent": "ProductionManager/1.0",
        },
      },
    );

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`StatusCake API error (${resp.status}): ${text.slice(0, 200)}`);
    }

    const data = (await resp.json()) as StatusCakeResponse;
    all.push(...data.data);
    totalPages = data.metadata.page_count;
    page++;
  }

  return all;
}

// ── Main sync action (fetches from Convex cloud) ───────────

export const syncStatusCake = internalAction({
  args: {},
  returns: v.object({
    testsFound: v.number(),
    matched: v.number(),
    unmatched: v.number(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx): Promise<{
    testsFound: number;
    matched: number;
    unmatched: number;
    error?: string;
  }> => {
    // Get API key
    const apiKey = await getStatusCakeApiKey();
    if (!apiKey) {
      return {
        testsFound: 0,
        matched: 0,
        unmatched: 0,
        error: "StatusCake API key not configured. Set STATUSCAKE_API_KEY env var or configure in Integrations.",
      };
    }

    try {
      // Fetch all uptime tests
      const tests = await fetchAllTests(apiKey);
      return await matchAndUpdateSites(ctx, tests);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { testsFound: 0, matched: 0, unmatched: 0, error: msg };
    }
  },
});

// ── Bulk push endpoint (called by external sync script) ─────

export const pushStatusCakeData = internalAction({
  args: {
    tests: v.array(v.object({
      id: v.union(v.number(), v.string()),
      name: v.string(),
      website_url: v.string(),
      status: v.string(),
      uptime: v.union(v.number(), v.string()),
      paused: v.boolean(),
    })),
  },
  returns: v.object({
    testsFound: v.number(),
    matched: v.number(),
    unmatched: v.number(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<{
    testsFound: number;
    matched: number;
    unmatched: number;
    error?: string;
  }> => {
    try {
      const tests: StatusCakeTest[] = args.tests.map((t) => ({
        id: typeof t.id === "string" ? parseInt(t.id, 10) : t.id,
        name: t.name,
        website_url: t.website_url,
        status: t.status,
        uptime: typeof t.uptime === "string" ? parseFloat(t.uptime) : t.uptime,
        paused: t.paused,
        check_rate: 0,
      }));
      return await matchAndUpdateSites(ctx, tests);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { testsFound: 0, matched: 0, unmatched: 0, error: msg };
    }
  },
});

async function matchAndUpdateSites(
  ctx: any,
  tests: StatusCakeTest[],
): Promise<{ testsFound: number; matched: number; unmatched: number }> {
  // Build a lookup map: normalized domain → test
  const testMap = new Map<string, StatusCakeTest>();
  for (const test of tests) {
    const normalizedUrl = normalizeDomain(test.website_url);
    testMap.set(normalizedUrl, test);
    const normalizedName = normalizeDomain(test.name);
    if (!testMap.has(normalizedName)) {
      testMap.set(normalizedName, test);
    }
  }

  // Get all production sites
  const sites = await ctx.runQuery(internal.statuscakeSync.listProductionSites, {});

  // Build batch of updates (match in-memory, then batch-write)
  const updates: {
    siteId: any;
    statuscakeTestId: string;
    statuscakeStatus: "up" | "down" | "unknown";
    statuscakeUptime: number;
    statuscakeLastChecked: number;
  }[] = [];

  for (const site of sites) {
    const normalizedDomain = normalizeDomain(site.domain);
    const test = testMap.get(normalizedDomain);

    if (test) {
      updates.push({
        siteId: site._id,
        statuscakeTestId: String(test.id),
        statuscakeStatus: test.paused ? "unknown" : (test.status === "up" ? "up" : "down"),
        statuscakeUptime: test.uptime,
        statuscakeLastChecked: Date.now(),
      });
    }
  }

  // Batch write in chunks of 50 via a single mutation call
  for (let i = 0; i < updates.length; i += 50) {
    const chunk = updates.slice(i, i + 50);
    await ctx.runMutation(internal.statuscakeSync.batchUpdateSiteStatusCake, {
      updates: chunk,
    });
  }

  return {
    testsFound: tests.length,
    matched: updates.length,
    unmatched: sites.length - updates.length,
  };
}

// ── Internal helpers ────────────────────────────────────────

export const listProductionSites = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("sites")
      .withIndex("by_environment", (q) => q.eq("environment", "production"))
      .collect();
  },
});

export const updateSiteStatusCake = internalMutation({
  args: {
    siteId: v.id("sites"),
    statuscakeTestId: v.string(),
    statuscakeStatus: v.union(v.literal("up"), v.literal("down"), v.literal("unknown")),
    statuscakeUptime: v.number(),
    statuscakeLastChecked: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { siteId, ...data } = args;
    await ctx.db.patch(siteId, data);
    return null;
  },
});

export const batchUpdateSiteStatusCake = internalMutation({
  args: {
    updates: v.array(v.object({
      siteId: v.id("sites"),
      statuscakeTestId: v.string(),
      statuscakeStatus: v.union(v.literal("up"), v.literal("down"), v.literal("unknown")),
      statuscakeUptime: v.number(),
      statuscakeLastChecked: v.number(),
    })),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const { siteId, ...data } of args.updates) {
      await ctx.db.patch(siteId, data);
    }
    return null;
  },
});
