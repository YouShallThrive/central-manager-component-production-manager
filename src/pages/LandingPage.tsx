import { useConvexAuth } from "convex/react";
import { ArrowRight, Check, Monitor } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function LandingPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <section className="relative flex-1 flex flex-col items-center justify-center px-4 py-16 md:py-24">
        <div className="absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute inset-0 bg-[linear-gradient(to_right,hsl(var(--border))_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border))_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_100%)] opacity-40" />
        </div>

        <div className="max-w-5xl mx-auto text-center space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border bg-background text-xs font-medium">
            <Monitor className="size-3 text-blue-600" />
            Production Site Management
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight leading-[1.1]">
            Monitor your
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600">
              Production Sites
            </span>
          </h1>

          <p className="text-base md:text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Track plugin health, monitor uptime, manage backups, and maintain 
            performance across your entire WordPress portfolio.
          </p>

          {!isAuthenticated && !isLoading && (
            <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
              <Button size="lg" className="text-base h-11 px-6 bg-blue-600 hover:bg-blue-700" asChild>
                <Link to="/signup">
                  Get Started
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="text-base h-11 px-6" asChild>
                <Link to="/login">Sign In</Link>
              </Button>
            </div>
          )}
          {isAuthenticated && (
            <div className="pt-2">
              <Button size="lg" className="text-base h-11 px-6 bg-blue-600 hover:bg-blue-700" asChild>
                <Link to="/dashboard">
                  Go to Dashboard
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>
          )}

          <div className="flex items-center justify-center gap-6 pt-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Check className="size-4 text-blue-600" />
              <span>Plugin tracking</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Check className="size-4 text-blue-600" />
              <span>Health monitoring</span>
            </div>
            <div className="hidden sm:flex items-center gap-1.5">
              <Check className="size-4 text-blue-600" />
              <span>Multi-environment</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
