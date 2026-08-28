import { useQuery, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { PhpVersionBadge } from "@/components/PhpVersionBadge";
import { useParams, useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import {
  AlertTriangle,
  ShieldAlert,
  Check,
  X,
  Search,
  TestTube,
  Monitor,
  Beaker,
} from "lucide-react";
import type { Id } from "../../convex/_generated/dataModel";
import SiteDetailTemplate from "@/components/SiteDetailTemplate";
import type { QuickStatItem } from "@/components/SiteDetailTemplate";

export function SiteDetailPage() {
  const { siteId } = useParams();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "outdated" | "vulnerable">("all");
  const syncPlugins = useAction(api.sync.syncSitePlugins);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ text: string; isError: boolean } | null>(null);

  const site = useQuery(
    api.sites.getWithPlugins,
    siteId ? { siteId: siteId as Id<"sites"> } : "skip"
  );

  if (!siteId) return null;

  if (site === undefined) {
    return (
      <div className="max-w-[1000px] mx-auto p-6 space-y-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-64" />
          <div className="h-4 bg-muted rounded w-96" />
          <div className="h-64 bg-muted rounded" />
        </div>
      </div>
    );
  }

  if (site === null) {
    return (
      <div className="max-w-[1000px] mx-auto text-center py-16">
        <h2 className="text-xl font-semibold mb-2">Site not found</h2>
      </div>
    );
  }

  const handleSync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const result = await syncPlugins({ siteId: siteId as Id<"sites"> });
      if (result.error) {
        setSyncMsg({ text: result.error, isError: true });
      } else {
        setSyncMsg({ text: `Synced ${result.pluginsFound} plugins`, isError: false });
      }
    } catch {
      setSyncMsg({ text: "Failed to sync plugins", isError: true });
    } finally {
      setSyncing(false);
    }
  };

  const filteredPlugins = (site.plugins || []).filter((p) => {
    if (search) {
      const term = search.toLowerCase();
      if (
        !p.name.toLowerCase().includes(term) &&
        !p.slug.toLowerCase().includes(term)
      )
        return false;
    }
    if (filter === "active") return p.isActive;
    if (filter === "outdated") return p.isOutdated;
    if (filter === "vulnerable") return p.hasVulnerability;
    return true;
  });

  const activeCount = site.plugins?.filter((p) => p.isActive).length ?? 0;
  const outdatedCount = site.plugins?.filter((p) => p.isOutdated).length ?? 0;
  const vulnerableCount = site.plugins?.filter((p) => p.hasVulnerability).length ?? 0;

  const envConfig = {
    production: { icon: Monitor, color: "text-blue-600", borderColor: "border-blue-300" },
    staging: { icon: TestTube, color: "text-amber-600", borderColor: "border-amber-300" },
    development: { icon: Beaker, color: "text-violet-600", borderColor: "border-violet-300" },
  };
  const env = envConfig[site.environment] || envConfig.production;

  const stats: QuickStatItem[] = [
    {
      label: "Total Plugins",
      value: site.plugins?.length ?? 0,
      icon: <Monitor className="size-4" />,
    },
    {
      label: "Active",
      value: activeCount,
      icon: <Check className="size-4 text-blue-600" />,
    },
    {
      label: "Outdated",
      value: outdatedCount,
      icon: <AlertTriangle className="size-4 text-amber-500" />,
      highlight: outdatedCount > 0,
    },
    {
      label: "Vulnerable",
      value: vulnerableCount,
      icon: <ShieldAlert className="size-4 text-red-500" />,
      highlight: vulnerableCount > 0,
    },
  ];

  return (
    <SiteDetailTemplate
      onBack={() => navigate("/sites")}
      title={site.domain}
      domainLink={{
        url: `https://${site.domain}`,
        label: site.domain,
      }}
      titleBadge={
        <Badge variant="outline" className={`${env.borderColor} ${env.color}`}>
          {site.environment}
        </Badge>
      }
      metadata={
        <>
          <span className="text-sm text-muted-foreground">{site.accountLabel}</span>
          {site.wpVersion && (
            <span className="text-sm text-muted-foreground">WP {site.wpVersion}</span>
          )}
          <PhpVersionBadge version={site.phpVersion} checkedAt={site.phpCheckedAt} />
          {site.lastSyncedAt && (
            <span className="text-sm text-muted-foreground">
              Synced {new Date(site.lastSyncedAt).toLocaleDateString()}
            </span>
          )}
        </>
      }
      syncLabel="Sync Plugins"
      syncingLabel="Syncing…"
      onSync={handleSync}
      isSyncing={syncing}
      syncMessage={syncMsg}
      onDismissSyncMessage={() => setSyncMsg(null)}
      statuscake={{
        status: site.statuscakeStatus,
        uptime: site.statuscakeUptime,
        lastChecked: site.statuscakeLastChecked,
        testId: site.statuscakeTestId,
      }}
      stats={stats}
    >
      {/* Search + Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search plugins..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
          {(["all", "active", "outdated", "vulnerable"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors capitalize ${
                filter === f
                  ? "bg-background shadow text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Plugin List */}
      <div className="rounded-xl border overflow-hidden">
        <div className="grid grid-cols-[1fr_100px_100px_80px_80px] gap-2 px-4 py-2.5 bg-muted/50 text-xs font-medium text-muted-foreground">
          <span>Plugin</span>
          <span>Version</span>
          <span>Latest</span>
          <span className="text-center">Active</span>
          <span className="text-center">Status</span>
        </div>

        {filteredPlugins.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {(site.plugins?.length ?? 0) === 0
              ? 'No plugins loaded yet. Click "Sync Plugins" above to fetch them from Rocket.net.'
              : "No plugins match your filters"}
          </div>
        ) : (
          filteredPlugins.map((plugin) => (
            <div
              key={plugin._id}
              className="grid grid-cols-[1fr_100px_100px_80px_80px] gap-2 px-4 py-3 border-t items-center hover:bg-muted/30 transition-colors"
            >
              <div className="min-w-0">
                <span className="font-medium text-sm truncate block">
                  {plugin.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {plugin.slug}
                </span>
              </div>
              <span className="text-sm tabular-nums">{plugin.version}</span>
              <span
                className={`text-sm tabular-nums ${
                  plugin.isOutdated ? "text-amber-600 font-medium" : ""
                }`}
              >
                {plugin.latestVersion ?? "—"}
              </span>
              <div className="flex justify-center">
                {plugin.isActive ? (
                  <Check className="size-4 text-blue-600" />
                ) : (
                  <X className="size-4 text-muted-foreground" />
                )}
              </div>
              <div className="flex justify-center">
                {plugin.hasVulnerability ? (
                  <Badge variant="destructive" className="text-[10px] px-1.5">
                    <ShieldAlert className="size-3 mr-0.5" /> Vuln
                  </Badge>
                ) : plugin.isOutdated ? (
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 border-amber-300 text-amber-600"
                  >
                    <AlertTriangle className="size-3 mr-0.5" /> Old
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 border-blue-300 text-blue-600"
                  >
                    OK
                  </Badge>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </SiteDetailTemplate>
  );
}
