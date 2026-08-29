"use client";

import {
  CalendarBlank,
  CursorClick,
  FunnelSimple,
  Scan,
  X,
} from "@phosphor-icons/react";
import { useDashboardStore, type GlobalFilter } from "@/lib/dashboard-store";
import { Button } from "@/components/ui/button";

function filterText(f: GlobalFilter): string {
  const v = Array.isArray(f.value) ? f.value.join(", ") : String(f.value);
  const op =
    f.op === "eq" ? "=" : f.op === "in" ? "in" : f.op === "between" ? "…" : "~";
  return `${f.column} ${op} ${v}`;
}

export function FilterBar() {
  const filters = useDashboardStore((s) => s.doc.filters.filters);
  const dateRange = useDashboardStore((s) => s.doc.filters.dateRange);
  const crossFilter = useDashboardStore((s) => s.doc.crossFilter);
  const clearCrossFilter = useDashboardStore((s) => s.clearCrossFilter);
  const sourceTileTitle = useDashboardStore((s) => {
    const id = s.doc.crossFilter?.sourceTileId;
    return id ? s.doc.tiles.find((t) => t.id === id)?.title : undefined;
  });
  const brushed = useDashboardStore((s) => s.brushedRange);
  const setFilters = useDashboardStore((s) => s.setFilter);
  const clearFilters = useDashboardStore((s) => s.clearFilters);
  const setDateRange = useDashboardStore((s) => s.setDateRange);
  const setBrushedRange = useDashboardStore((s) => s.setBrushedRange);
  void setFilters;

  const removeFilter = (column: string) => {
    // Contract-safe removal: clear, then re-apply the remaining filters.
    const rest = filters.filter((f) => f.column !== column);
    clearFilters({ origin: "human", label: `Removed filter on ${column}` });
    const store = useDashboardStore.getState();
    for (const f of rest) {
      store.setFilter(f, { origin: "human", label: `Kept filter ${filterText(f)}` });
    }
  };

  if (filters.length === 0 && !dateRange && !brushed && !crossFilter) {
    return null;
  }

  return (
    <div
      data-testid="filter-bar"
      className="flex flex-wrap items-center gap-1.5 px-4 pt-3"
    >
      {filters.map((f) => (
        <span
          key={f.column}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card py-1 pl-2.5 pr-1 text-xs"
        >
          <FunnelSimple className="size-3 text-muted-foreground" />
          <span className="font-medium">{filterText(f)}</span>
          <button
            aria-label={`Remove filter on ${f.column}`}
            className="flex size-4 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => removeFilter(f.column)}
          >
            <X className="size-2.5" />
          </button>
        </span>
      ))}
      {crossFilter ? (
        <span
          data-testid="cross-filter-chip"
          className="inline-flex items-center gap-1.5 rounded-full border border-agent/30 bg-agent/10 py-1 pl-2.5 pr-1 text-xs text-agent"
        >
          <CursorClick className="size-3" />
          <span className="font-medium">
            {crossFilter.column} = {String(crossFilter.value)}
          </span>
          {sourceTileTitle ? (
            <span className="hidden text-agent/70 sm:inline">
              · from “{sourceTileTitle}”
            </span>
          ) : null}
          <button
            aria-label="Clear cross-filter"
            data-testid="clear-cross-filter"
            className="flex size-4 cursor-pointer items-center justify-center rounded-full hover:bg-agent/20"
            onClick={() =>
              clearCrossFilter({ origin: "human", label: "Cleared cross-filter" })
            }
          >
            <X className="size-2.5" />
          </button>
        </span>
      ) : null}
      {dateRange ? (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card py-1 pl-2.5 pr-1 text-xs">
          <CalendarBlank className="size-3 text-muted-foreground" />
          <span className="font-medium">
            {dateRange.from} → {dateRange.to}
          </span>
          <button
            aria-label="Clear date range"
            className="flex size-4 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() =>
              setDateRange(null, { origin: "human", label: "Cleared date range" })
            }
          >
            <X className="size-2.5" />
          </button>
        </span>
      ) : null}
      {brushed ? (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-agent/30 bg-agent/10 py-1 pl-2.5 pr-1 text-xs text-agent">
          <Scan className="size-3" />
          <span className="font-medium">
            Brushed {brushed.from} → {brushed.to}
          </span>
          <span className="hidden text-agent/70 sm:inline">
            · ask your agent “why?”
          </span>
          <button
            aria-label="Clear brushed range"
            className="flex size-4 cursor-pointer items-center justify-center rounded-full hover:bg-agent/20"
            onClick={() => setBrushedRange(null)}
          >
            <X className="size-2.5" />
          </button>
        </span>
      ) : null}
      {filters.length > 1 ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs text-muted-foreground"
          onClick={() =>
            clearFilters({ origin: "human", label: "Cleared all filters" })
          }
        >
          Clear all
        </Button>
      ) : null}
    </div>
  );
}
