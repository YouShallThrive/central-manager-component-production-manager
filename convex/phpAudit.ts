/**
 * PHP lock cross-check.
 *
 * siteConstraints rows with constraintType "php_lock" record the PHP version a
 * site is deliberately pinned to (and why). This compares each lock against the
 * PHP version the sweep actually found on Rocket.net, so an accidental 7.4 is
 * distinguishable from an intentional one.
 */
import { internalQuery } from "./_generated/server";

function normalize(version?: string | null): string | undefined {
  if (!version) return undefined;
  const match = String(version).match(/(\d+\.\d+)/);
  return match ? match[1] : String(version).trim();
}

export const lockCrossCheck = internalQuery({
  args: {},
  handler: async (ctx) => {
    const locks = (await ctx.db.query("siteConstraints").collect()).filter(
      (c) => c.constraintType === "php_lock",
    );
    const sites = await ctx.db.query("sites").collect();

    const byDomain = new Map<string, (typeof sites)[number]>();
    for (const s of sites) {
      const key = s.domain.replace(/^www\./, "").toLowerCase();
      const existing = byDomain.get(key);
      // prefer the production row and the one with a known PHP version
      if (!existing || (!existing.phpVersion && s.phpVersion) || s.environment === "production") {
        if (!existing || s.environment === "production" || !existing.phpVersion) {
          byDomain.set(key, s);
        }
      }
    }

    const rows = locks.map((lock) => {
      const key = lock.domain.replace(/^www\./, "").toLowerCase();
      const site = byDomain.get(key);
      const locked = normalize(lock.currentVersion ?? lock.targetLabel ?? lock.target);
      const actual = normalize(site?.phpVersion);
      let status: "match" | "mismatch" | "no_site" | "unknown_php";
      if (!site) status = "no_site";
      else if (!actual) status = "unknown_php";
      else if (locked === actual) status = "match";
      else status = "mismatch";
      return {
        domain: lock.domain,
        locked: lock.currentVersion ?? lock.targetLabel ?? lock.target,
        actual: site?.phpVersion ?? null,
        severity: lock.severity,
        reason: lock.reason,
        status,
      };
    });

    // PHP versions that look end-of-life but have no lock explaining them
    const lockedDomains = new Set(
      locks.map((l) => l.domain.replace(/^www\./, "").toLowerCase()),
    );
    const unexplainedEol = sites
      .filter((s) => {
        const v = normalize(s.phpVersion);
        if (!v) return false;
        const [maj, min] = v.split(".").map(Number);
        const eol = maj < 8 || (maj === 8 && min === 0);
        return eol && !lockedDomains.has(s.domain.replace(/^www\./, "").toLowerCase());
      })
      .map((s) => ({ domain: s.domain, phpVersion: s.phpVersion, environment: s.environment }))
      .sort((a, b) => a.domain.localeCompare(b.domain));

    return {
      lockCount: locks.length,
      rows,
      counts: {
        match: rows.filter((r) => r.status === "match").length,
        mismatch: rows.filter((r) => r.status === "mismatch").length,
        no_site: rows.filter((r) => r.status === "no_site").length,
        unknown_php: rows.filter((r) => r.status === "unknown_php").length,
      },
      unexplainedEolCount: unexplainedEol.length,
      unexplainedEol,
    };
  },
});
