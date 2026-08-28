import { useQuery, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import SiteManagerTemplate from "@/components/SiteManagerTemplate";
import { PhpVersionBadge, matchesPhpFilter, PHP_FILTER_OPTIONS, PHP_FILTER_ALL_LABEL } from "@/components/PhpVersionBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Cpu, AlertTriangle, Loader2 } from "lucide-react";
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
  getPhpVersion: (site) => site.phpVersion,
  getPhpCheckedAt: (site) => site.phpCheckedAt,
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
  const [phpFilter, setPhpFilter] = useState<string>("all");
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
  const phpSummary = useQuery(api.phpVersions.summary);
  const syncPhpVersions = useAction(api.phpVersions.syncAll);
  const [phpSyncing, setPhpSyncing] = useState(false);

  const handlePhpSync = useCallback(async () => {
    setPhpSyncing(true);
    try {
      const res = await syncPhpVersions({});
      toast.info(`Checking PHP versions on ${res.sites} sites — running in the background.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PHP version sync failed");
    } finally {
      setPhpSyncing(false);
    }
  }, [syncPhpVersions]);

  const phpHeaderAction = (
    <Button onClick={handlePhpSync} disabled={phpSyncing} variant="outline" className="gap-2">
      {phpSyncing ? <Loader2 className="size-4 animate-spin" /> : <Cpu className="size-4" />}
      Sync PHP
    </Button>
  );

  const phpPanel = phpSummary && phpSummary.total > 0 ? (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cpu className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">PHP versions</span>
          {phpSummary.critical > 0 && (
            <Badge variant="outline" className="text-xs border-red-300 text-red-700 bg-red-50 dark:bg-red-950/30 gap-1">
              <AlertTriangle className="size-3" />
              {phpSummary.critical} end-of-life
            </Badge>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {phpSummary.unknown > 0 && `${phpSummary.unknown} not synced · `}
          {phpSummary.unresolved > 0 && `${phpSummary.unresolved} unreachable on Rocket.net · `}
          {phpSummary.lastCheckedAt
            ? `checked ${new Date(phpSummary.lastCheckedAt).toLocaleString()}`
            : "never checked — click Sync PHP"}
        </span>
      </div>
      {phpSummary.byVersion.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {phpSummary.byVersion.map((row) => (
            <div key={row.version} className="flex items-center gap-1.5">
              <PhpVersionBadge version={row.version} />
              <span className="text-xs tabular-nums text-muted-foreground">×{row.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  ) : null;

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

  const visibleSites = useMemo(() => {
    const list = sites as SiteDoc[] | undefined;
    if (!list) return undefined;
    if (phpFilter === "all") return list;
    return list.filter((s) => matchesPhpFilter(s.phpVersion, phpFilter));
  }, [sites, phpFilter]);

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
      {
      key: "php",
      allLabel: PHP_FILTER_ALL_LABEL,
      options: PHP_FILTER_OPTIONS,
      value: phpFilter,
      onChange: setPhpFilter,
      width: "w-[170px]",
    },
], [statuscakeFilter, pluginHealthFilter, phpFilter]);

  return (
    <SiteManagerTemplate<SiteDoc>
      title="Production Sites"
      subtitle="Monitor and manage WordPress production sites across your hosting accounts"
      siteStats={siteStats}
      fieldAccessors={fieldAccessors}
      extraColumns={extraColumns}
      extraFilters={extraFilters}
      sites={visibleSites}
      accounts={accounts}
      search={search}
      onSearchChange={setSearch}
      accountFilter={accountFilter}
      onAccountFilterChange={setAccountFilter}
      onSync={handleSync}
      headerActions={phpHeaderAction}
      summaryPanel={phpPanel}
      isSyncing={syncing}
      onSiteClick={(site) => navigate(`/site/${site._id}`)}
      getSiteKey={(site) => site._id}
    />
  );
}
