import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Search,
  ShieldAlert,
  AlertTriangle,
  Info,
  Lock,
  Plug,
  GitBranch,
  ExternalLink,
  Trash2,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import type { Id } from "../../convex/_generated/dataModel";

/* ── Constants ─────────────────────────────────────────────── */

const SEVERITY_CONFIG = {
  critical: {
    label: "Critical",
    icon: ShieldAlert,
    badgeClass: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    dotClass: "bg-red-500",
  },
  warning: {
    label: "Warning",
    icon: AlertTriangle,
    badgeClass:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    dotClass: "bg-amber-500",
  },
  info: {
    label: "Info",
    icon: Info,
    badgeClass:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    dotClass: "bg-blue-500",
  },
} as const;

const TYPE_CONFIG = {
  php_lock: { label: "PHP Lock", icon: Lock, color: "text-purple-600" },
  plugin_no_remove: {
    label: "Plugin — No Remove",
    icon: Plug,
    color: "text-red-600",
  },
  plugin_version_lock: {
    label: "Version Lock",
    icon: GitBranch,
    color: "text-blue-600",
  },
} as const;

const GROUP_LABELS: Record<string, string> = {
  themerex: "ThemeREX Addons",
  essential_grid: "Essential Grid",
  phlox: "Phlox Core Elements",
  slider_rev_v6: "Slider Revolution v6",
  php56: "PHP 5.6",
  php74: "PHP 7.4",
};

/* ── Stats Cards ───────────────────────────────────────────── */

function StatsCards({
  stats,
}: {
  stats: {
    total: number;
    critical: number;
    warning: number;
    info: number;
    uniqueDomains: number;
    byGroup: { group: string; count: number }[];
  };
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <div className="rounded-lg border bg-card p-4">
        <p className="text-xs text-muted-foreground font-medium">
          Total Constraints
        </p>
        <p className="text-2xl font-bold mt-1">{stats.total}</p>
      </div>
      <div className="rounded-lg border bg-card p-4">
        <p className="text-xs text-muted-foreground font-medium">
          Affected Sites
        </p>
        <p className="text-2xl font-bold mt-1">{stats.uniqueDomains}</p>
      </div>
      <div className="rounded-lg border bg-card p-4 border-red-200 dark:border-red-900/50">
        <p className="text-xs text-red-600 dark:text-red-400 font-medium">
          Critical
        </p>
        <p className="text-2xl font-bold mt-1 text-red-600 dark:text-red-400">
          {stats.critical}
        </p>
      </div>
      <div className="rounded-lg border bg-card p-4 border-amber-200 dark:border-amber-900/50">
        <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
          Warning
        </p>
        <p className="text-2xl font-bold mt-1 text-amber-600 dark:text-amber-400">
          {stats.warning}
        </p>
      </div>
      <div className="rounded-lg border bg-card p-4 border-blue-200 dark:border-blue-900/50">
        <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">
          Info
        </p>
        <p className="text-2xl font-bold mt-1 text-blue-600 dark:text-blue-400">
          {stats.info}
        </p>
      </div>
    </div>
  );
}

/* ── Group Breakdown ───────────────────────────────────────── */

function GroupBreakdown({
  groups,
  activeGroup,
  onGroupClick,
}: {
  groups: { group: string; count: number }[];
  activeGroup: string;
  onGroupClick: (g: string) => void;
}) {
  if (groups.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => onGroupClick("all")}
        className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
          activeGroup === "all"
            ? "bg-primary text-primary-foreground border-primary"
            : "bg-card hover:bg-muted border-border"
        }`}
      >
        All
      </button>
      {groups.map(({ group, count }) => (
        <button
          type="button"
          key={group}
          onClick={() => onGroupClick(group)}
          className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
            activeGroup === group
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-card hover:bg-muted border-border"
          }`}
        >
          {GROUP_LABELS[group] ?? group}{" "}
          <span className="opacity-60">({count})</span>
        </button>
      ))}
    </div>
  );
}

/* ── Constraint Row ────────────────────────────────────────── */

function ConstraintRow({
  constraint,
  onDelete,
}: {
  constraint: {
    _id: Id<"siteConstraints">;
    domain: string;
    constraintType: "php_lock" | "plugin_no_remove" | "plugin_version_lock";
    target: string;
    targetLabel: string;
    currentVersion?: string;
    reason: string;
    severity: "critical" | "warning" | "info";
    action: string;
    source: string;
    group?: string;
    addedAt: number;
  };
  onDelete: (id: Id<"siteConstraints">) => void;
}) {
  const sev = SEVERITY_CONFIG[constraint.severity];
  const typ = TYPE_CONFIG[constraint.constraintType];
  const SevIcon = sev.icon;
  const TypeIcon = typ.icon;

  return (
    <div className="group flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors">
      {/* Severity dot */}
      <div className="mt-1.5">
        <div className={`size-2.5 rounded-full ${sev.dotClass}`} />
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <a
            href={`https://${constraint.domain}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-sm hover:underline inline-flex items-center gap-1"
          >
            {constraint.domain}
            <ExternalLink className="size-3 opacity-40" />
          </a>
          <Badge variant="outline" className={`text-[10px] py-0 ${sev.badgeClass}`}>
            <SevIcon className="size-3 mr-0.5" />
            {sev.label}
          </Badge>
          <Badge
            variant="outline"
            className="text-[10px] py-0 bg-muted/50"
          >
            <TypeIcon className={`size-3 mr-0.5 ${typ.color}`} />
            {typ.label}
          </Badge>
          {constraint.group && (
            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              {GROUP_LABELS[constraint.group] ?? constraint.group}
            </span>
          )}
        </div>

        <div className="mt-1 flex items-center gap-2 text-sm">
          <span className="font-medium text-muted-foreground">
            {constraint.targetLabel}
          </span>
          {constraint.currentVersion && (
            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">
              v{constraint.currentVersion}
            </span>
          )}
        </div>

        <p className="text-xs text-muted-foreground mt-1">
          {constraint.reason}
        </p>

        <p className="text-xs mt-1">
          <span className="font-medium text-muted-foreground">Action:</span>{" "}
          <span className="text-foreground/80">{constraint.action}</span>
        </p>
      </div>

      {/* Delete button */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
              onClick={() => onDelete(constraint._id)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Remove constraint</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

/* ── Add Constraint Dialog ─────────────────────────────────── */

function AddConstraintDialog() {
  const addConstraint = useMutation(api.constraints.add);
  const [domain, setDomain] = useState("");
  const [constraintType, setConstraintType] = useState<
    "php_lock" | "plugin_no_remove" | "plugin_version_lock"
  >("plugin_no_remove");
  const [target, setTarget] = useState("");
  const [targetLabel, setTargetLabel] = useState("");
  const [currentVersion, setCurrentVersion] = useState("");
  const [reason, setReason] = useState("");
  const [severity, setSeverity] = useState<"critical" | "warning" | "info">(
    "warning",
  );
  const [action, setAction] = useState("");
  const [group, setGroup] = useState("");
  const [open, setOpen] = useState(false);

  const handleSubmit = async () => {
    if (!domain || !target || !targetLabel || !reason || !action) {
      toast.error("Please fill in all required fields");
      return;
    }
    try {
      await addConstraint({
        domain: domain.toLowerCase().trim(),
        constraintType,
        target: target.trim(),
        targetLabel: targetLabel.trim(),
        currentVersion: currentVersion.trim() || undefined,
        reason: reason.trim(),
        severity,
        action: action.trim(),
        source: "Manual entry",
        group: group.trim() || undefined,
      });
      toast.success(`Constraint added for ${domain}`);
      setDomain("");
      setTarget("");
      setTargetLabel("");
      setCurrentVersion("");
      setReason("");
      setAction("");
      setGroup("");
      setOpen(false);
    } catch {
      toast.error("Failed to add constraint");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="size-3.5" />
          Add Constraint
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Site Constraint</DialogTitle>
          <DialogDescription>
            Document an update or removal restriction for a site.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Domain *
              </label>
              <Input
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="example.com"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Type *
              </label>
              <Select
                value={constraintType}
                onValueChange={(v) => setConstraintType(v as typeof constraintType)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="php_lock">PHP Lock</SelectItem>
                  <SelectItem value="plugin_no_remove">
                    Plugin — No Remove
                  </SelectItem>
                  <SelectItem value="plugin_version_lock">
                    Version Lock
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Target (slug/identifier) *
              </label>
              <Input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="trx_addons"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Display Label *
              </label>
              <Input
                value={targetLabel}
                onChange={(e) => setTargetLabel(e.target.value)}
                placeholder="ThemeREX Addons"
                className="mt-1"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Current Version
              </label>
              <Input
                value={currentVersion}
                onChange={(e) => setCurrentVersion(e.target.value)}
                placeholder="2.36.3"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Severity *
              </label>
              <Select
                value={severity}
                onValueChange={(v) => setSeverity(v as typeof severity)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="critical">🔴 Critical</SelectItem>
                  <SelectItem value="warning">🟡 Warning</SelectItem>
                  <SelectItem value="info">🔵 Info</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Reason *
            </label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Removing breaks the theme — required companion plugin"
              className="mt-1"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Action Guidance *
            </label>
            <Input
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder="Leave in place. Monitor for patches."
              className="mt-1"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Group (optional)
            </label>
            <Input
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              placeholder="themerex, slider_rev_v6, php74"
              className="mt-1"
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={handleSubmit}>Add Constraint</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Main Page ─────────────────────────────────────────────── */

export function ConstraintsPage() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");

  const stats = useQuery(api.constraints.stats);
  const constraints = useQuery(api.constraints.list, {
    search: search || undefined,
    typeFilter: typeFilter !== "all" ? (typeFilter as "php_lock" | "plugin_no_remove" | "plugin_version_lock") : undefined,
    severityFilter:
      severityFilter !== "all"
        ? (severityFilter as "critical" | "warning" | "info")
        : undefined,
    groupFilter: groupFilter !== "all" ? groupFilter : undefined,
  });

  const removeConstraint = useMutation(api.constraints.remove);

  const handleDelete = async (id: Id<"siteConstraints">) => {
    try {
      await removeConstraint({ id });
      toast.success("Constraint removed");
    } catch {
      toast.error("Failed to remove constraint");
    }
  };

  return (
    <div className="max-w-[1200px] mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Site Constraints Registry
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sites with update or removal restrictions — referenced during
            maintenance and QA
          </p>
        </div>
        <AddConstraintDialog />
      </div>

      {/* Stats */}
      {stats && <StatsCards stats={stats} />}

      {/* Group pills */}
      {stats && stats.byGroup.length > 0 && (
        <GroupBreakdown
          groups={stats.byGroup}
          activeGroup={groupFilter}
          onGroupClick={setGroupFilter}
        />
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search domains, plugins, reasons..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="php_lock">PHP Lock</SelectItem>
            <SelectItem value="plugin_no_remove">Plugin — No Remove</SelectItem>
            <SelectItem value="plugin_version_lock">Version Lock</SelectItem>
          </SelectContent>
        </Select>
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="All Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severity</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
            <SelectItem value="info">Info</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Constraints list */}
      {constraints === undefined ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-24 rounded-lg border bg-muted/30 animate-pulse"
            />
          ))}
        </div>
      ) : constraints.length === 0 ? (
        <div className="rounded-xl border p-12 text-center">
          <ShieldAlert className="size-12 text-muted-foreground/30 mx-auto mb-4" />
          <h2 className="text-lg font-semibold mb-2">No Constraints Found</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            {search || typeFilter !== "all" || severityFilter !== "all"
              ? "Try adjusting your filters."
              : "No site constraints have been registered yet. Add one to get started."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {constraints.length} constraint{constraints.length !== 1 ? "s" : ""}
          </p>
          {constraints.map((c) => (
            <ConstraintRow
              key={c._id}
              constraint={c}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
