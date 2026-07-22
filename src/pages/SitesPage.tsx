import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Search,
  AlertTriangle,
  Plug,
  ChevronRight,
  ArrowUpCircle,
  ArrowDownCircle,
  MinusCircle,
} from "lucide-react";

export function SitesPage() {
  const [search, setSearch] = useState("");
  // Always production only
  const sites = useQuery(api.sites.list, { environment: "production", search: search || undefined });
  const navigate = useNavigate();

  return (
    <div className="max-w-[1200px] mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Production Sites</h1>
        <p className="text-sm text-muted-foreground mt-1">
          All WordPress production sites across your hosting accounts
        </p>
      </div>

      {/* Search */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search sites..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Sites List */}
      <div className="rounded-xl border overflow-hidden">
        <div className="grid grid-cols-[1fr_100px_80px_80px_90px_32px] gap-2 px-4 py-2.5 bg-muted/50 text-xs font-medium text-muted-foreground">
          <span>Site</span>
          <span>Account</span>
          <span className="text-center">Plugins</span>
          <span className="text-center">Outdated</span>
          <span className="text-center">StatusCake</span>
          <span />
        </div>

        {sites === undefined ? (
          <div className="px-4 py-12 text-center">
            <div className="animate-pulse space-y-2">
              <div className="h-4 bg-muted rounded w-48 mx-auto" />
              <div className="h-4 bg-muted rounded w-32 mx-auto" />
            </div>
          </div>
        ) : sites.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            {search
              ? "No sites match your search"
              : "No sites synced yet. Click \"Sync Sites\" on the dashboard."}
          </div>
        ) : (
          sites.map((site) => (
            <div
              key={site._id}
              className="grid grid-cols-[1fr_100px_80px_80px_90px_32px] gap-2 px-4 py-3 border-t items-center hover:bg-muted/30 transition-colors cursor-pointer"
              onClick={() => navigate(`/site/${site._id}`)}
            >
              <div className="min-w-0">
                <span className="font-medium text-sm truncate block">{site.domain}</span>
              </div>
              <span className="text-xs text-muted-foreground truncate">{site.accountLabel}</span>
              <div className="flex items-center justify-center gap-1">
                <Plug className="size-3 text-muted-foreground" />
                <span className="text-sm tabular-nums">{site.pluginCount ?? 0}</span>
              </div>
              <div className="flex items-center justify-center">
                {(site.outdatedCount ?? 0) > 0 ? (
                  <Badge variant="outline" className="text-[10px] px-1.5 border-amber-300 text-amber-600 gap-0.5">
                    <AlertTriangle className="size-3" />
                    {site.outdatedCount}
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>
              <div className="flex items-center justify-center">
                {site.statuscakeStatus === "up" ? (
                  <Badge variant="outline" className="text-[10px] px-1.5 border-emerald-300 text-emerald-600 gap-0.5">
                    <ArrowUpCircle className="size-3" />
                    {site.statuscakeUptime != null ? `${site.statuscakeUptime}%` : "Up"}
                  </Badge>
                ) : site.statuscakeStatus === "down" ? (
                  <Badge variant="outline" className="text-[10px] px-1.5 border-red-300 text-red-600 gap-0.5">
                    <ArrowDownCircle className="size-3" />
                    Down
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    <MinusCircle className="size-3 inline" />
                  </span>
                )}
              </div>
              <ChevronRight className="size-4 text-muted-foreground" />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
