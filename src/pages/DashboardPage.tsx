import { useQuery, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import SiteManagerTemplate from "@/components/SiteManagerTemplate";
import type { ColumnDef, SiteFieldAccessors, SiteManagerStats, ExtraFilter } from "@/components/SiteManagerTemplate";

type SiteDoc = {
  _id: string;
  domain: string;
  accountLabel: string;
  pluginCount?: number;
  outdatedCount?: number;
  guardInstalled?: boolean;
  muPluginIssues?: number;
  statuscakeStatus?: "up" | "down" | "unknown";
  statuscakeUptime?: number;
  wpDebug?: boolean;
  wpDebugLog?: boolean;
  wpDebugCheckedAt?: number;
  [key: string]: any;
};

/* ── Field accessors (how PM maps its data to shared columns) ── */

const fieldAccessors: SiteFieldAccessors<SiteDoc> = {
  getDomainLabel: (site) => site.domain,
  getDomainLink: (site) => ({
    url: `https://${site.domain}`,
    label: site.domain,
  }),
  getPluginCount: (site) => site.pluginCount,
  getPluginIssueCount: (site) => site.outdatedCount,
  pluginIssueLabel: "outdated",
  getGuardInstalled: (site) => site.guardInstalled ?? null,
  getMuPluginIssues: (site) => site.muPluginIssues ?? null,
  getStatuscakeStatus: (site) => site.statuscakeStatus,
  getStatuscakeUptime: (site) => site.statuscakeUptime,
  getWpDebug: (site) => site.wpDebug ?? null,
  getWpDebugCheckedAt: (site) => site.wpDebugCheckedAt ?? null,
};

/* ── Extra column: Account (production-specific) ── */

const extraColumns: ColumnDef<SiteDoc>[] = [
  {
    key: "account",
    header: "Account",
    render: (site) => (
      <span className="text-xs text-muted-foreground">{site.accountLabel}</span>
    ),
  },
];

export function DashboardPage() {
  const [search, setSearch] = useState("");
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [statuscakeFilter, setStatuscakeFilter] = useState<string>("all");
  const [pluginHealthFilter, setPluginHealthFilter] = useState<string>("all");

  const navigate = useNavigate();

  const accounts = useQuery(api.hostingAccounts.list);
  const stats = useQuery(api.sites.stats, { environment: "production" });
  const sites = useQuery(api.sites.list, {
    environment: "production",
    search: search || undefined,
    accountId: accountFilter !== "all" ? (accountFilter as any) : undefined,
    statuscakeFilter: statuscakeFilter !== "all" ? (statuscakeFilter as "up" | "down") : undefined,
    pluginHealthFilter: pluginHealthFilter !== "all" ? (pluginHealthFilter as "outdated" | "clean") : undefined,
  });
  const triggerSync = useAction(api.sync.triggerFullSync);
  const [syncing, setSyncing] = useState(false);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      const result = await triggerSync();
      if (result.errors.length > 0) {
        toast.warning(
          `Synced ${result.totalSites} sites with ${result.totalPlugins} plugin scans queued. ${result.errors.length} error(s).`,
        );
      } else {
        toast.success(
          `Synced ${result.totalSites} sites from ${result.credentialsSynced} account(s). Plugin scan queued for ${result.totalPlugins} sites.`,
        );
      }
    } catch {
      toast.error("Sync failed.");
    } finally {
      setSyncing(false);
    }
  }, [triggerSync]);

  const siteStats: SiteManagerStats | null = stats
    ? {
        totalSites: stats.totalSites,
        guardInstalled: 0,
        pluginIssues: stats.outdatedPlugins,
        muPluginIssues: 0,
        debugOn: stats.debugOn ?? 0,
        statuscakeUp: stats.statuscakeUp ?? 0,
        statuscakeDown: stats.statuscakeDown ?? 0,
      }
    : null;

  const extraFilters: ExtraFilter[] = useMemo(() => [
    {
      key: "statuscake",
      allLabel: "All StatusCake",
      options: [
        { value: "up", label: "Up" },
        { value: "down", label: "Down" },
      ],
      value: statuscakeFilter,
      onChange: setStatuscakeFilter,
      width: "w-[160px]",
    },
    {
      key: "pluginHealth",
      allLabel: "All Plugins",
      options: [
        { value: "outdated", label: "Outdated" },
        { value: "clean", label: "Clean" },
      ],
      value: pluginHealthFilter,
      onChange: setPluginHealthFilter,
      width: "w-[160px]",
    },
  ], [statuscakeFilter, pluginHealthFilter]);

  return (
    <SiteManagerTemplate<SiteDoc>
      title="Production Sites"
      subtitle="Monitor and manage WordPress production sites across your hosting accounts"
      siteStats={siteStats}
      fieldAccessors={fieldAccessors}
      extraColumns={extraColumns}
      extraFilters={extraFilters}
      sites={sites as SiteDoc[] | undefined}
      accounts={accounts}
      search={search}
      onSearchChange={setSearch}
      accountFilter={accountFilter}
      onAccountFilterChange={setAccountFilter}
      onSync={handleSync}
      isSyncing={syncing}
      onSiteClick={(site) => navigate(`/site/${site._id}`)}
      getSiteKey={(site) => site._id}
    />
  );
}
