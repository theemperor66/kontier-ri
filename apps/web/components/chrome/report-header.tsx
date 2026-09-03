"use client";

/**
 * Report header (product design): the report title and a one-line honest
 * summary, the live filter chips (an agent-set filter is marked as such),
 * then the page tab strip with the canvas actions.
 */

import { useEffect, useMemo, useState } from "react";
import {
  CalendarBlank,
  CurrencyEur,
  CursorClick,
  Flask as FlaskIcon,
  FunnelSimple,
  Plus,
  Scan,
  Table,
  X,
} from "@phosphor-icons/react";
import { useDashboardStore, type GlobalFilter } from "@/lib/dashboard-store";
import { useDataSource } from "@/lib/datasource";
import { DEFAULT_CURRENCY } from "@/lib/format";
import { PageTabs } from "./page-tabs";
import { useUiState } from "@/lib/ui-state";
import { cn } from "@/lib/utils";

function filterText(filter: GlobalFilter): string {
  const value = Array.isArray(filter.value)
    ? filter.value.join(", ")
    : String(filter.value);
  const op =
    filter.op === "eq"
      ? "="
      : filter.op === "in"
        ? "in"
        : filter.op === "between"
          ? "…"
          : "~";
  return `${filter.column} ${op} ${value}`;
}

function Chip({
  children,
  tone = "neutral",
  onClear,
  clearLabel,
  clearTestId,
  testId,
  byline,
  Icon,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "agent";
  onClear?: () => void;
  clearLabel?: string;
  clearTestId?: string;
  testId?: string;
  byline?: string;
  Icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <span
      data-testid={testId}
      className={cn(
        "flex h-[38px] items-center gap-2 rounded-[9px] border px-3 text-[13.5px]",
        tone === "agent"
          ? "border-accent-mid bg-accent text-accent-foreground"
          : "border-line bg-card text-foreground",
      )}
    >
      {Icon ? (
        <Icon
          className={cn(
            "size-3.5 shrink-0",
            tone === "agent" ? "text-accent-foreground" : "text-muted-foreground",
          )}
        />
      ) : null}
      <span className="max-w-[38ch] truncate">{children}</span>
      {byline ? (
        <span
          className={cn(
            "shrink-0 text-[11px]",
            tone === "agent" ? "opacity-70" : "text-muted-foreground",
          )}
        >
          {byline}
        </span>
      ) : null}
      {onClear ? (
        <button
          type="button"
          aria-label={clearLabel}
          data-testid={clearTestId}
          onClick={onClear}
          className={cn(
            "grid size-4 shrink-0 cursor-pointer place-items-center rounded-full transition-colors",
            tone === "agent"
              ? "hover:bg-accent-mid"
              : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
          )}
        >
          <X className="size-2.5" />
        </button>
      ) : null}
    </span>
  );
}

function TitleField() {
  const title = useDashboardStore((s) => s.doc.title);
  const setTitle = useDashboardStore((s) => s.setTitle);
  const [draft, setDraft] = useState(title);

  useEffect(() => setDraft(title), [title]);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== title) {
      setTitle(next, { origin: "human", label: `Renamed dashboard to “${next}”` });
    } else {
      setDraft(title);
    }
  };

  return (
    <input
      value={draft}
      aria-label="Dashboard title"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(title);
          event.currentTarget.blur();
        }
      }}
      size={Math.max(8, Math.min(draft.length + 1, 44))}
      className="-mx-2 max-w-full rounded-lg bg-transparent px-2 text-[30px] font-semibold leading-[1.1] tracking-[-0.02em] outline-none transition-colors hover:bg-surface-2 focus:bg-surface-2 focus:ring-2 focus:ring-ring/40"
    />
  );
}

const DEMO_GROUPS = new Set(["saas_billing", "payments"]);

/**
 * Who last set this column's scope, read from the real command log. The agent
 * labels its own filter commands, so the by-line is evidence, never a guess.
 */
function scopeAuthor(
  activity: { by: "human" | "agent"; label: string; undone?: boolean }[],
  column: string,
): "human" | "agent" | null {
  const entry = activity.find(
    (item) =>
      !item.undone &&
      (item.label.includes(`Filtered ${column} `) ||
        item.label.includes(`Cross-filter ${column} `)),
  );
  return entry?.by ?? null;
}

export function ReportHeader() {
  const filters = useDashboardStore((s) => s.doc.filters.filters);
  const dateRange = useDashboardStore((s) => s.doc.filters.dateRange);
  const crossFilter = useDashboardStore((s) => s.doc.crossFilter);
  const sourceTileTitle = useDashboardStore((s) => {
    const id = s.doc.crossFilter?.sourceTileId;
    return id ? s.doc.tiles.find((tile) => tile.id === id)?.title : undefined;
  });
  const brushed = useDashboardStore((s) => s.brushedRange);
  const tileCount = useDashboardStore((s) => s.doc.tiles.length);
  const pageCount = useDashboardStore((s) => s.doc.pages.length);
  const agentTouched = useDashboardStore(
    (s) => s.activityLog.filter((entry) => entry.by === "agent" && !entry.undone).length,
  );
  const clearFilters = useDashboardStore((s) => s.clearFilters);
  const setFilter = useDashboardStore((s) => s.setFilter);
  const clearCrossFilter = useDashboardStore((s) => s.clearCrossFilter);
  const setDateRange = useDashboardStore((s) => s.setDateRange);
  const setBrushedRange = useDashboardStore((s) => s.setBrushedRange);
  const tidyLayout = useDashboardStore((s) => s.tidyLayout);
  const activity = useDashboardStore((s) => s.activityLog);
  const tiles = useDashboardStore((s) => s.doc.tiles);
  const { datasets } = useDataSource();

  // Currency actually formatted on this page, and whether the page reads the
  // bundled synthetic demo tables. Both are read from real state.
  const { currency, usesDemoData } = useMemo(() => {
    let code: string | null = null;
    let demo = false;
    for (const tile of tiles) {
      const spec = tile.spec as {
        dataset?: string;
        format?: { style?: string; currency?: string } | string;
      };
      const format = spec.format;
      // Both spec forms count: the string form ("currency") formats in the
      // app's default code, the object form can name its own.
      if (typeof format === "string" && format === "currency") {
        code = code ?? DEFAULT_CURRENCY;
      } else if (typeof format === "object" && format?.style === "currency") {
        code = code ?? format.currency ?? DEFAULT_CURRENCY;
      }
      if (spec.dataset) {
        const group = datasets.find((d) => d.name === spec.dataset)?.group;
        if (group && DEMO_GROUPS.has(group)) demo = true;
      }
    }
    return { currency: code, usesDemoData: demo };
  }, [tiles, datasets]);
  const setAddVisualOpen = useUiState((s) => s.setAddVisualOpen);
  const dataRailOpen = useUiState((s) => s.dataRailOpen);
  const toggleDataRail = useUiState((s) => s.toggleDataRail);

  const removeFilter = (column: string) => {
    const rest = filters.filter((filter) => filter.column !== column);
    clearFilters({ origin: "human", label: `Removed filter on ${column}` });
    for (const filter of rest) {
      setFilter(filter, {
        origin: "human",
        label: `Kept filter ${filterText(filter)}`,
      });
    }
  };

  const summary = [
    `${tileCount} ${tileCount === 1 ? "visual" : "visuals"}`,
    pageCount > 1 ? `${pageCount} pages` : null,
    filters.length > 0
      ? `${filters.length} ${filters.length === 1 ? "filter" : "filters"}`
      : null,
    agentTouched > 0
      ? `${agentTouched} agent ${agentTouched === 1 ? "change" : "changes"}`
      : "no agent changes yet",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="shrink-0">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 px-1 pb-3.5 pt-1.5">
        <div className="flex min-w-0 flex-col gap-1">
          <TitleField />
          <span className="px-0.5 text-[15px] text-muted-foreground">{summary}</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap gap-2 sm:justify-end">
          {filters.map((filter) => {
            const author = scopeAuthor(activity, filter.column);
            return (
              <Chip
                key={filter.column}
                testId="scope-filter-chip"
                tone={author === "agent" ? "agent" : "neutral"}
                Icon={FunnelSimple}
                byline={author === "agent" ? "by agent" : undefined}
                onClear={() => removeFilter(filter.column)}
                clearLabel={`Remove filter on ${filter.column}`}
              >
                {filterText(filter)}
              </Chip>
            );
          })}
          {crossFilter ? (
            <Chip
              testId="cross-filter-chip"
              tone="agent"
              Icon={CursorClick}
              onClear={() =>
                clearCrossFilter({ origin: "human", label: "Cleared cross-filter" })
              }
              clearLabel="Clear cross-filter"
              clearTestId="clear-cross-filter"
              byline={
                scopeAuthor(activity, crossFilter.column) === "agent"
                  ? "by agent"
                  : undefined
              }
            >
              {crossFilter.column} = {String(crossFilter.value)}
              {sourceTileTitle ? (
                <span className="text-accent-foreground/70"> · from “{sourceTileTitle}”</span>
              ) : null}
            </Chip>
          ) : null}
          {dateRange ? (
            <Chip
              testId="scope-range-chip"
              Icon={CalendarBlank}
              byline={
                scopeAuthor(activity, "date range") === "agent" ? "by agent" : undefined
              }
              onClear={() =>
                setDateRange(null, { origin: "human", label: "Cleared date range" })
              }
              clearLabel="Clear date range"
            >
              {dateRange.from} → {dateRange.to}
            </Chip>
          ) : (
            <Chip testId="scope-range-chip" Icon={CalendarBlank}>
              Full history
            </Chip>
          )}
          {currency ? (
            <Chip testId="scope-currency-chip" Icon={CurrencyEur}>
              {currency}
            </Chip>
          ) : null}
          {usesDemoData ? (
            <Chip testId="scope-demo-chip" Icon={FlaskIcon}>
              Synthetic demo data
            </Chip>
          ) : null}
          {brushed ? (
            <Chip
              tone="agent"
              Icon={Scan}
              onClear={() => setBrushedRange(null)}
              clearLabel="Clear brushed range"
            >
              {brushed.from} → {brushed.to}
            </Chip>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 border-b border-line px-1 sm:flex-nowrap">
        <div className="w-full min-w-0 overflow-x-auto sm:w-auto sm:flex-1">
          <PageTabs />
        </div>
        <button
          type="button"
          data-testid="toggle-data-rail"
          aria-pressed={dataRailOpen}
          onClick={toggleDataRail}
          className={cn(
            "mb-1.5 hidden h-[30px] shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-[13px] transition-colors sm:mb-0 lg:flex",
            dataRailOpen
              ? "border-accent-mid bg-accent text-accent-foreground"
              : "border-transparent text-muted-foreground hover:border-line hover:text-foreground",
          )}
        >
          <Table className="size-3.5" />
          Fields
          <kbd className="rounded border border-line px-1 text-[10px] font-normal text-faint">
            ⌘B
          </kbd>
        </button>
        <button
          type="button"
          data-testid="add-visual"
          onClick={() => setAddVisualOpen(true)}
          className="mb-1.5 flex h-[30px] shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-line-2 bg-card px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-surface-2 sm:mb-0"
        >
          <Plus className="size-3.5" />
          Add visual
        </button>
        <button
          type="button"
          data-testid="tidy-layout"
          onClick={() =>
            tidyLayout({ origin: "human", label: "Tidied the layout" })
          }
          className="hidden h-[30px] shrink-0 cursor-pointer rounded-lg border border-transparent px-3 text-[13px] text-muted-foreground transition-colors hover:border-line hover:text-foreground sm:block"
        >
          Tidy
        </button>
        <span className="hidden shrink-0 px-1.5 text-xs text-faint md:inline">
          12 cols
        </span>
      </div>
    </div>
  );
}
