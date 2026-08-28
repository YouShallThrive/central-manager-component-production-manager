import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";
import { internal } from "./_generated/api";

declare const process: { env: Record<string, string | undefined> };

const http = httpRouter();
auth.addHttpRoutes(http);

// ── StatusCake push endpoint ────────────────────────────────
// POST /api/statuscake/push
// Authorization: Bearer <SSO_SHARED_SECRET>
// Body: { tests: [{ id, name, website_url, status, uptime, paused }] }

http.route({
  path: "/api/statuscake/push",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const authHeader = request.headers.get("Authorization");
    const secret = process.env.SSO_SHARED_SECRET || "66mTA4FYT1TTYfuD6FC7eDHLN15vZC7T3L6DLz3tqbk";
    if (!secret || !authHeader || authHeader !== `Bearer ${secret}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 403,
        headers: corsHeaders(),
      });
    }

    try {
      const body = await request.json();
      const result = await ctx.runAction(internal.statuscakeSync.pushStatusCakeData, {
        tests: body.tests,
      });
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: corsHeaders(),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return new Response(JSON.stringify({ error: msg }), {
        status: 500,
        headers: corsHeaders(),
      });
    }
  }),
});

http.route({
  path: "/api/statuscake/push",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }),
});

// ── Admin sync endpoint ─────────────────────────────────────
// POST /api/admin/sync — stores config and triggers full credential + site sync
http.route({
  path: "/api/admin/sync",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const { serverManagementUrl, ssoSharedSecret, adminKey } = body;

      const secret = process.env.SSO_SHARED_SECRET || "66mTA4FYT1TTYfuD6FC7eDHLN15vZC7T3L6DLz3tqbk";
      if (!adminKey || adminKey !== secret) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 403,
          headers: corsHeaders(),
        });
      }

      // Store config in settings table for future use
      await ctx.runMutation(internal.credentialSync.upsertConfig, {
        serverManagementUrl,
        ssoSharedSecret,
      });

      // Trigger full sync (credentials → sites → plugins)
      const result = await ctx.runAction(internal.credentialSync.fullSync, {});

      return new Response(JSON.stringify({ status: "ok", ...result }), {
        status: 200,
        headers: corsHeaders(),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return new Response(JSON.stringify({ error: msg }), {
        status: 500,
        headers: corsHeaders(),
      });
    }
  }),
});

http.route({
  path: "/api/admin/sync",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }),
});

// ── Admin: seed a Rocket.net token directly (bypasses Server Management) ──
http.route({
  path: "/api/admin/seed-account",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const { adminKey, label, apiToken } = body;

      const secret = process.env.SSO_SHARED_SECRET || "66mTA4FYT1TTYfuD6FC7eDHLN15vZC7T3L6DLz3tqbk";
      if (!adminKey || adminKey !== secret) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 403,
          headers: corsHeaders(),
        });
      }

      // Insert or update hosting account
      await ctx.runMutation(internal.credentialSync.upsertAccount, {
        label: label || "YST Rocket.net",
        provider: "rocketnet",
        apiToken,
      });

      return new Response(JSON.stringify({ status: "ok", message: "Account seeded" }), {
        status: 200,
        headers: corsHeaders(),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return new Response(JSON.stringify({ error: msg }), {
        status: 500,
        headers: corsHeaders(),
      });
    }
  }),
});

http.route({
  path: "/api/admin/seed-account",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }),
});

// ── Admin: trigger direct sync (skips Server Management credential pull) ──
http.route({
  path: "/api/admin/direct-sync",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const { adminKey } = body;

      const secret = process.env.SSO_SHARED_SECRET || "66mTA4FYT1TTYfuD6FC7eDHLN15vZC7T3L6DLz3tqbk";
      if (!adminKey || adminKey !== secret) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 403,
          headers: corsHeaders(),
        });
      }

      // Get all accounts and sync sites directly (skip credential pull)
      const accounts = await ctx.runQuery(internal.credentialSync.listAllAccounts, {});

      const rocketAccounts = accounts.filter(
        (a) => a.provider === "rocket" || a.provider === "rocketnet",
      );

      if (rocketAccounts.length === 0) {
        return new Response(
          JSON.stringify({ error: "No Rocket.net accounts found. Seed one first." }),
          { status: 400, headers: corsHeaders() },
        );
      }

      let totalSites = 0;
      const errors: string[] = [];

      for (const account of rocketAccounts) {
        const result = await ctx.runAction(internal.credentialSync.syncSitesFromRocketnet, {
          accountId: account._id,
          apiToken: account.apiToken,
          label: account.label,
        });

        totalSites += result.sitesFound;
        if (result.error) errors.push(`${account.label}: ${result.error}`);

        await ctx.runMutation(internal.credentialSync.touchAccount, { id: account._id });
      }

      // Schedule plugin sync
      const pluginResult = await ctx.runAction(internal.credentialSync.batchSyncAllPlugins, {});
      if (pluginResult.error) errors.push(`Plugin sync: ${pluginResult.error}`);

      return new Response(
        JSON.stringify({
          status: "ok",
          accounts: rocketAccounts.length,
          totalSites,
          pluginsScheduled: pluginResult.scheduled,
          errors,
        }),
        { status: 200, headers: corsHeaders() },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return new Response(JSON.stringify({ error: msg }), {
        status: 500,
        headers: corsHeaders(),
      });
    }
  }),
});

http.route({
  path: "/api/admin/direct-sync",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }),
});

// ── PHP maintenance endpoints ───────────────────────────────
// POST /api/admin/orphan-audit  { adminKey }  — flags missing sites, never deletes
// POST /api/admin/php-lock-check { adminKey }

http.route({
  path: "/api/admin/orphan-audit",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const secret = process.env.SSO_SHARED_SECRET || "66mTA4FYT1TTYfuD6FC7eDHLN15vZC7T3L6DLz3tqbk";
      if (!body.adminKey || body.adminKey !== secret) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 403,
          headers: corsHeaders(),
        });
      }
      const result = await ctx.runAction(internal.orphanSites.audit, {});
      return new Response(JSON.stringify({ status: "ok", ...result }), {
        status: 200,
        headers: corsHeaders(),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return new Response(JSON.stringify({ error: msg }), { status: 500, headers: corsHeaders() });
    }
  }),
});

http.route({
  path: "/api/admin/php-lock-check",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const secret = process.env.SSO_SHARED_SECRET || "66mTA4FYT1TTYfuD6FC7eDHLN15vZC7T3L6DLz3tqbk";
      if (!body.adminKey || body.adminKey !== secret) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 403,
          headers: corsHeaders(),
        });
      }
      const result = await ctx.runQuery(internal.phpAudit.lockCrossCheck, {});
      return new Response(JSON.stringify({ status: "ok", ...result }), {
        status: 200,
        headers: corsHeaders(),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return new Response(JSON.stringify({ error: msg }), { status: 500, headers: corsHeaders() });
    }
  }),
});

// POST /api/admin/restore-sites { adminKey, sites: [{ domain, siteId, environment? }] }
http.route({
  path: "/api/admin/restore-sites",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const secret = process.env.SSO_SHARED_SECRET || "66mTA4FYT1TTYfuD6FC7eDHLN15vZC7T3L6DLz3tqbk";
      if (!body.adminKey || body.adminKey !== secret) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 403,
          headers: corsHeaders(),
        });
      }
      const result = await ctx.runMutation(internal.orphanSites.restoreSites, {
        sites: body.sites ?? [],
      });
      return new Response(JSON.stringify({ status: "ok", ...result }), {
        status: 200,
        headers: corsHeaders(),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return new Response(JSON.stringify({ error: msg }), { status: 500, headers: corsHeaders() });
    }
  }),
});

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };
}

export default http;
