import { Heart } from "lucide-react";

export function HealthPage() {
  return (
    <div className="max-w-[1200px] mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Health Overview</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Monitor uptime, SSL certificates, and response times
        </p>
      </div>
      <div className="rounded-xl border p-12 text-center">
        <Heart className="size-12 text-muted-foreground/30 mx-auto mb-4" />
        <h2 className="text-lg font-semibold mb-2">Coming Soon</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Health monitoring with uptime checks, SSL certificate tracking, response time monitoring, and automated health scores will be available here.
        </p>
      </div>
    </div>
  );
}
