import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
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
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Trash2,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import type { Id } from "../../convex/_generated/dataModel";

/* ── Types ─────────────────────────────────────────────────── */

interface Constraint {
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
}

/* ── Group config ──────────────────────────────────────────── */

interface GroupConfig {
  label: string;
  icon: string;
  severity: "critical" | "warning" | "info";
  description: string;
  columns: { key: string; label: string; width?: string }[];
  sortOrder: number;
}

const GROUP_CONFIG: Record<string, GroupConfig> = {
  themerex: {
    label: "ThemeREX Addons",
    icon: "⚠️",
    severity: "critical",
    description:
      "Security vulnerability — removing breaks theme (required companion plugin). No updates available from developer.",
    columns: [
      { key: "domain", label: "Site", width: "50%" },
      { key: "currentVersion", label: "Version", width: "25%" },
      { key: "source", label: "Source", width: "25%" },
    ],
    sortOrder: 1,
  },
  essential_grid: {
    label: "Essential Grid",
    icon: "⚠️",
    severity: "warning",
    description:
      "Required by ThemeREX-based themes. Removing breaks site layout. Skip in security sweeps.",
    columns: [
      { key: "domain", label: "Site", width: "50%" },
      { key: "currentVersion", label: "Version", width: "25%" },
      { key: "source", label: "Source", width: "25%" },
    ],
    sortOrder: 2,
  },
  phlox: {
    label: "Phlox Core Elements",
    icon: "⚠️",
    severity: "critical",
    description:
      "Security vulnerability — required theme plugin. Removal breaks site.",
    columns: [
      { key: "domain", label: "Site", width: "50%" },
      { key: "reason", label: "Notes", width: "50%" },
    ],
    sortOrder: 3,
  },
  slider_rev_v6: {
    label: "Slider Revolution",
    icon: "🔒",
    severity: "warning",
    description:
      "On v6.x branch — NEVER auto-update to v7. Slider Revolution v7 breaks v6 sliders (migration is NOT backward-compatible). Update within v6.x only.",
    columns: [
      { key: "domain", label: "Site", width: "50%" },
      { key: "currentVersion", label: "Version", width: "25%" },
    ],
    sortOrder: 4,
  },
  php56: {
    label: "PHP Version Locks — PHP 5.6",
    icon: "🔴",
    severity: "critical",
    description:
      "Higher PHP versions break the site completely. Do NOT upgrade.",
    columns: [
      { key: "domain", label: "Site", width: "40%" },
      { key: "currentVersion", label: "PHP", width: "15%" },
      { key: "reason", label: "Notes", width: "45%" },
    ],
    sortOrder: 5,
  },
  php74: {
    label: "PHP Version Locks — PHP 7.4",
    icon: "🟡",
    severity: "warning",
    description:
      "PHP 7.4 reached end-of-life Nov 2022. Needs compatibility testing before upgrade — plugins/themes may break on PHP 8.x.",
    columns: [
      { key: "domain", label: "Site", width: "50%" },
      { key: "currentVersion", label: "PHP", width: "15%" },
      { key: "reason", label: "Notes", width: "35%" },
    ],
    sortOrder: 6,
  },
};

const FALLBACK_GROUP_CONFIG: GroupConfig = {
  label: "Other Constraints",
  icon: "📋",
  severity: "info",
  description: "Miscellaneous site constraints.",
  columns: [
    { key: "domain", label: "Site", width: "35%" },
    { key: "targetLabel", label: "Plugin/Target", width: "20%" },
    { key: "currentVersion", label: "Version", width: "15%" },
    { key: "reason", label: "Reason", width: "30%" },
  ],
  sortOrder: 99,
};

const SEVERITY_BADGE: Record<string, { label: string; className: string }> = {
  critical: {
    label: "HIGH RISK",
    className:
      "bg-red-500 text-white border-red-500 hover:bg-red-600 uppercase text-[10px] font-bold tracking-wider",
  },
  warning: {
    label: "WARNING",
    className:
      "bg-amber-500 text-white border-amber-500 hover:bg-amber-600 uppercase text-[10px] font-bold tracking-wider",
  },
  info: {
    label: "INFO",
    className:
      "bg-blue-500 text-white border-blue-500 hover:bg-blue-600 uppercase text-[10px] font-bold tracking-wider",
  },
};

/* ── Stats Cards (same style as original report) ───────────── */

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
  const cards = [
    { value: stats.total, label: "Total Constraints", accent: "" },
    { value: stats.uniqueDomains, label: "Affected Sites", accent: "" },
    {
      value: stats.critical,
      label: "Critical",
      accent: "border-red-500/50 dark:border-red-500/30",
    },
    {
      value: stats.warning,
      label: "Warning",
      accent: "border-amber-500/50 dark:border-amber-500/30",
    },
    {
      value: stats.info,
      label: "Info",
      accent: "border-blue-500/50 dark:border-blue-500/30",
    },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {cards.map((c) => (
        <div
          key={c.label}
          className={`rounded-lg border bg-card p-4 text-center ${c.accent}`}
        >
          <p className="text-3xl font-bold">{c.value}</p>
          <p className="text-xs text-muted-foreground mt-1">{c.label}</p>
        </div>
      ))}
    </div>
  );
}

/* ── Collapsible Group Section ─────────────────────────────── */

function GroupSection({
  groupKey: _groupKey,
  config,
  items,
  defaultOpen,
  onDelete,
}: {
  groupKey: string;
  config: GroupConfig;
  items: Constraint[];
  defaultOpen: boolean;
  onDelete: (id: Id<"siteConstraints">) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const sev = SEVERITY_BADGE[config.severity];

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-xl border bg-card overflow-hidden">
        {/* Header — always visible, acts as trigger */}
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-muted/40 transition-colors cursor-pointer"
          >
            {open ? (
              <ChevronDown className="size-5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
            )}
            <span className="text-lg shrink-0">{config.icon}</span>
            <h2 className="text-lg font-bold tracking-tight">{config.label}</h2>
            <Badge className={`ml-1 ${sev.className}`}>
              {items.length} SITE{items.length !== 1 ? "S" : ""}
            </Badge>
            <Badge variant="outline" className={`ml-1 ${sev.className}`}>
              {sev.label}
            </Badge>
            <span className="flex-1" />
          </button>
        </CollapsibleTrigger>

        {/* Collapsible body — description + table */}
        <CollapsibleContent>
          <div className="px-5 pb-5 space-y-3">
            {/* Description */}
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
              {config.description}
            </p>

            {/* Action guidance */}
            {items[0]?.action && (
              <p className="text-sm">
                <span className="font-bold text-foreground">
                  Action:
                </span>{" "}
                <span className="font-medium text-foreground/80">{items[0].action}</span>
              </p>
            )}

            {/* Table */}
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    {config.columns.map((col) => (
                      <TableHead
                        key={col.key}
                        style={{ width: col.width }}
                        className="text-xs font-semibold"
                      >
                        {col.label}
                      </TableHead>
                    ))}
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item._id} className="group">
                      {config.columns.map((col) => (
                        <TableCell key={col.key} className="text-sm">
                          {col.key === "domain" ? (
                            <a
                              href={`https://${item.domain}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium hover:underline inline-flex items-center gap-1 text-foreground"
                            >
                              {item.domain}
                              <ExternalLink className="size-3 opacity-30" />
                            </a>
                          ) : col.key === "currentVersion" ? (
                            <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                              v{item.currentVersion ?? "—"}
                            </span>
                          ) : col.key === "source" ? (
                            <span className="text-xs text-muted-foreground">
                              {item.source.includes("Anna")
                                ? "✓ Known"
                                : "🆕 Scan"}
                            </span>
                          ) : col.key === "reason" ? (
                            <span className="text-xs text-muted-foreground">
                              {item.reason}
                            </span>
                          ) : col.key === "targetLabel" ? (
                            <span className="text-xs">{item.targetLabel}</span>
                          ) : (
                            <span className="text-xs">
                              {(item as unknown as Record<string, unknown>)[col.key] as string ?? "—"}
                            </span>
                          )}
                        </TableCell>
                      ))}
                      <TableCell>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                                onClick={() => onDelete(item._id)}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Remove constraint</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
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
                onValueChange={(v) =>
                  setConstraintType(v as typeof constraintType)
                }
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
                Target (slug) *
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

  const stats = useQuery(api.constraints.stats);
  const constraints = useQuery(api.constraints.list, {
    search: search || undefined,
    typeFilter:
      typeFilter !== "all"
        ? (typeFilter as
            | "php_lock"
            | "plugin_no_remove"
            | "plugin_version_lock")
        : undefined,
    severityFilter:
      severityFilter !== "all"
        ? (severityFilter as "critical" | "warning" | "info")
        : undefined,
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

  /* Group constraints by their group field */
  const groupedConstraints = useMemo(() => {
    if (!constraints) return [];

    const map = new Map<string, Constraint[]>();
    for (const c of constraints) {
      const key = c.group ?? "_other";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c as Constraint);
    }

    // Sort groups by the config sort order
    return [...map.entries()]
      .map(([key, items]) => ({
        key,
        config: GROUP_CONFIG[key] ?? {
          ...FALLBACK_GROUP_CONFIG,
          label:
            key === "_other"
              ? "Other Constraints"
              : key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        },
        items: items.sort((a, b) => a.domain.localeCompare(b.domain)),
      }))
      .sort((a, b) => a.config.sortOrder - b.config.sortOrder);
  }, [constraints]);

  return (
    <div className="max-w-[1200px] mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            🔍 Site Constraints Registry
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

      {/* Search & Filters */}
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
            <SelectItem value="plugin_no_remove">
              Plugin — No Remove
            </SelectItem>
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

      {/* Grouped collapsible sections */}
      {constraints === undefined ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-32 rounded-xl border bg-muted/30 animate-pulse"
            />
          ))}
        </div>
      ) : groupedConstraints.length === 0 ? (
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
        <div className="space-y-4">
          {groupedConstraints.map(({ key, config, items }, idx) => (
            <GroupSection
              key={key}
              groupKey={key}
              config={config}
              items={items}
              defaultOpen={idx < 3}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
