"use client";

import { useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input } from "./ui/input";
import { Button } from "./ui/button";

export default function SearchBar({ earliestDate = "" }: { earliestDate?: string }) {
  const sp = useSearchParams();
  const today = new Date().toISOString().split("T")[0];

  const project = sp.get("project");
  const nn = sp.get("nn");
  const hasActive = !!(sp.get("search") || sp.get("filter") || sp.get("time_min") || sp.get("time_max"));

  const clearParams = new URLSearchParams();
  if (project) clearParams.set("project", project);
  const clearHref = `/?${clearParams.toString()}`;

  return (
    <form method="get" action="/" className="flex items-center gap-2">
      {project && <input type="hidden" name="project" value={project} />}
      {nn && <input type="hidden" name="nn" value={nn} />}

      {/* Col 1 — search + filter (biggest) */}
      <div className="flex-1 min-w-0 flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            key={sp.get("search") ?? ""}
            type="text"
            name="search"
            defaultValue={sp.get("search") ?? ""}
            placeholder="Search…"
            className="pl-8 h-8 text-sm"
          />
        </div>
        <Input
          key={sp.get("filter") ?? ""}
          type="text"
          name="filter"
          defaultValue={sp.get("filter") ?? ""}
          placeholder="#tag  @person  ~#excl  +#excl"
          className="flex-[1.4] min-w-0 h-8 text-sm"
        />
      </div>

      {/* Col 2 — date range (medium) */}
      <div className="flex items-center gap-1 shrink-0 text-muted-foreground text-xs">
        <input
          key={sp.get("time_min") ?? earliestDate}
          type="date"
          name="time_min"
          defaultValue={sp.get("time_min") ?? earliestDate}
          className="h-8 border border-input rounded-md px-2 text-sm bg-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <span>–</span>
        <input
          key={sp.get("time_max") ?? today}
          type="date"
          name="time_max"
          defaultValue={sp.get("time_max") ?? today}
          className="h-8 border border-input rounded-md px-2 text-sm bg-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      {/* Col 3 — apply + clear (smallest) */}
      <div className="flex items-center gap-1 shrink-0">
        <Button type="submit" size="sm" className="h-8">
          Apply
        </Button>
        {hasActive && (
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" asChild title="Clear all filters">
            <a href={clearHref}><X className="h-3.5 w-3.5" /></a>
          </Button>
        )}
      </div>
    </form>
  );
}
