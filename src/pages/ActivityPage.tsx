import { Activity } from "lucide-react";

export function ActivityPage() {
  return (
    <div className="max-w-[1200px] mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Activity Log</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Sync history, plugin updates, and actions across all sites
        </p>
      </div>
      <div className="rounded-xl border p-12 text-center">
        <Activity className="size-12 text-muted-foreground/30 mx-auto mb-4" />
        <h2 className="text-lg font-semibold mb-2">Coming Soon</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          A full activity log of all sync events, plugin updates, backup operations, and administrative actions will be tracked here.
        </p>
      </div>
    </div>
  );
}
