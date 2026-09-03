"use client";

/**
 * Data rail: the human's field pane. Datasets and their columns, with a live
 * profile on demand, click-to-add and drag-to-canvas. Hovering or dragging a
 * field is real intent, so it is published as agent focus context
 * (get_user_focus / get_work_context) while the pointer is on it.
 */

import { useEffect, useMemo, useState } from "react";
import {
  CalendarBlank,
  CaretRight,
  Hash,
  MagnifyingGlass,
  TextAa,
  X,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import type { ColumnMeta } from "@kontier-ri/datasource";
import type { AddTileInput } from "@/lib/dashboard-store";
import { useDashboardStore } from "@/lib/dashboard-store";
import { dataSource, useDataSource } from "@/lib/datasource";
import { useUiState } from "@/lib/ui-state";
import { cn } from "@/lib/utils";

const NUMERIC = /INT|DECIMAL|DOUBLE|FLOAT|REAL|HUGEINT|NUMERIC/i;
const TEMPORAL = /DATE|TIME/i;

export type FieldRole = "measure" | "time" | "dimension";

export function fieldRole(column: ColumnMeta): FieldRole {
  if (TEMPORAL.test(column.type)) return "time";
  if (NUMERIC.test(column.type)) return "measure";
  return "dimension";
}

const ROLE_ICON = {
  measure: Hash,
  time: CalendarBlank,
  dimension: TextAa,
} as const;

const ROLE_INK = {
  measure: "text-accent-strong",
  time: "text-warn",
  dimension: "text-muted-foreground",
} as const;

/**
 * The tile a dropped field scaffolds: a measure becomes a KPI, a dimension or
 * date becomes a bar/line chart counted over that field. The human can refine
 * it in the inspector, exactly like an agent-authored tile.
 */
export function scaffoldFor(
  dataset: string,
  column: ColumnMeta,
  columns: ColumnMeta[],
): AddTileInput {
  const role = fieldRole(column);
  if (role === "measure") {
    return {
      type: "kpi",
      title: `${column.name} (sum)`,
      spec: {
        dataset,
        measure: column.name,
        agg: "sum",
        format: /amount|revenue|mrr|price|value/i.test(column.name)
          ? "currency"
          : "number",
      },
    };
  }
  // Pick the most meaningful measure, not merely the first match: a
  // currency-normalized column beats a raw one, revenue beats a generic value.
  const rank = (name: string): number => {
    if (/revenue|mrr|arr/i.test(name)) return 3;
    if (/_eur$|_usd$|_gbp$/i.test(name)) return 2;
    if (/amount|value|price|total/i.test(name)) return 1;
    return 0;
  };
  const measure = columns
    .filter((candidate) => NUMERIC.test(candidate.type) && rank(candidate.name) > 0)
    .sort((a, b) => rank(b.name) - rank(a.name))[0];
  return {
    type: "chart",
    title: measure
      ? `${measure.name} by ${column.name}`
      : `Rows by ${column.name}`,
    spec: {
      dataset,
      query: {
        dims: [column.name],
        measures: [
          measure
            ? { col: measure.name, agg: "sum" as const }
            : { col: "*", agg: "count" as const },
        ],
        ...(role === "dimension" ? { limit: 12, othersBucket: true } : {}),
      },
      chartType: role === "time" ? "line" : "bar",
      xKey: column.name,
    },
  };
}

function FieldProfile({ dataset, column }: { dataset: string; column: string }) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | {
        status: "ready";
        nulls: number;
        distinct: number;
        top: { value: unknown; count: number }[];
      }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    dataSource
      .profileColumn(dataset, column)
      .then((profile) => {
        if (cancelled) return;
        setState({
          status: "ready",
          nulls: profile.nulls,
          distinct: profile.distinct,
          top: profile.topValues.slice(0, 3),
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [dataset, column]);

  if (state.status === "loading") {
    return <p className="px-2 py-1 text-[11px] text-faint">Profiling…</p>;
  }
  if (state.status === "error") {
    return (
      <p className="px-2 py-1 text-[11px] text-danger">{state.message}</p>
    );
  }
  return (
    <div className="space-y-0.5 px-2 py-1 text-[11px] text-muted-foreground">
      <p>
        {state.distinct.toLocaleString()} distinct · {state.nulls.toLocaleString()} null
      </p>
      {state.top.map((entry) => (
        <p key={String(entry.value)} className="truncate">
          {String(entry.value ?? "—")} · {entry.count.toLocaleString()}
        </p>
      ))}
    </div>
  );
}

export function DataRail() {
  const open = useUiState((s) => s.dataRailOpen);
  const setOpen = useUiState((s) => s.setDataRailOpen);
  const { datasets, status } = useDataSource();
  const addTile = useDashboardStore((s) => s.addTile);
  const selectTile = useDashboardStore((s) => s.selectTile);
  const setHoveredField = useDashboardStore((s) => s.setHoveredField);
  const [openDataset, setOpenDataset] = useState<string | null>(null);
  const [profiling, setProfiling] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!openDataset && datasets[0]) setOpenDataset(datasets[0].name);
  }, [datasets, openDataset]);

  // The rail publishes hover as focus; leaving it must not strand the signal.
  useEffect(() => () => setHoveredField(null), [setHoveredField]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return datasets.map((dataset) => ({
      dataset,
      columns: needle
        ? dataset.columns.filter((column) =>
            column.name.toLowerCase().includes(needle),
          )
        : dataset.columns,
    }));
  }, [datasets, query]);

  if (!open) return null;

  const add = (datasetName: string, column: ColumnMeta, columns: ColumnMeta[]) => {
    const input = scaffoldFor(datasetName, column, columns);
    const result = addTile(input, {
      origin: "human",
      label: `Added ${input.type} tile “${input.title}”`,
    });
    if (!result.ok) {
      toast.error("error" in result ? result.error : "Could not add the tile.");
      return;
    }
    if (result.tileId) selectTile(result.tileId);
    toast.success(`Added “${input.title}”.`);
  };

  return (
    <aside
      data-testid="data-rail"
      aria-label="Datasets and fields"
      className="flex w-60 shrink-0 flex-col border-r border-line bg-card"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <h2 className="flex-1 text-[13px] font-semibold">Fields</h2>
        <button
          type="button"
          aria-label="Hide fields"
          data-testid="close-data-rail"
          onClick={() => setOpen(false)}
          className="grid size-6 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="border-b border-line px-3 py-2">
        <div className="flex h-8 items-center gap-2 rounded-lg border border-line px-2.5">
          <MagnifyingGlass className="size-3.5 text-faint" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a field"
            aria-label="Find a field"
            data-testid="field-search"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-faint"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {status !== "ready" ? (
          <p className="px-2 py-3 text-[12px] text-muted-foreground">
            Waiting for the local engine…
          </p>
        ) : null}
        {filtered.map(({ dataset, columns }) => {
          const expanded = openDataset === dataset.name || query.trim() !== "";
          return (
            <section key={dataset.name} className="mb-1">
              <button
                type="button"
                data-testid={`dataset-${dataset.name}`}
                aria-expanded={expanded}
                onClick={() =>
                  setOpenDataset(expanded && !query ? null : dataset.name)
                }
                className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12.5px] font-medium transition-colors hover:bg-surface-2"
              >
                <CaretRight
                  className={cn(
                    "size-3 shrink-0 text-faint transition-transform",
                    expanded && "rotate-90",
                  )}
                />
                <span className="min-w-0 flex-1 truncate">{dataset.name}</span>
                <span className="shrink-0 text-[10.5px] text-faint">
                  {dataset.rowCount.toLocaleString()}
                </span>
              </button>
              {expanded ? (
                <ul className="mb-1 ml-2 border-l border-line pl-1.5">
                  {columns.map((column) => {
                    const role = fieldRole(column);
                    const Icon = ROLE_ICON[role];
                    const key = `${dataset.name}.${column.name}`;
                    return (
                      <li key={column.name}>
                        <div
                          role="button"
                          tabIndex={0}
                          draggable
                          data-testid={`field-${dataset.name}-${column.name}`}
                          title={`${column.type} — click to add, drag onto the canvas`}
                          onDragStart={(event) => {
                            event.dataTransfer.setData(
                              "application/x-kontier-field",
                              JSON.stringify({
                                dataset: dataset.name,
                                column: column.name,
                              }),
                            );
                            event.dataTransfer.effectAllowed = "copy";
                            setHoveredField({
                              dataset: dataset.name,
                              column: column.name,
                              type: column.type,
                            });
                          }}
                          onDragEnd={() => setHoveredField(null)}
                          onMouseEnter={() =>
                            setHoveredField({
                              dataset: dataset.name,
                              column: column.name,
                              type: column.type,
                            })
                          }
                          onMouseLeave={() => setHoveredField(null)}
                          onFocus={() =>
                            setHoveredField({
                              dataset: dataset.name,
                              column: column.name,
                              type: column.type,
                            })
                          }
                          onBlur={() => setHoveredField(null)}
                          onClick={() => add(dataset.name, column, dataset.columns)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              add(dataset.name, column, dataset.columns);
                            }
                          }}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            setProfiling((current) =>
                              current === key ? null : key,
                            );
                          }}
                          className="flex cursor-grab items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 active:cursor-grabbing"
                        >
                          <Icon className={cn("size-3.5 shrink-0", ROLE_INK[role])} />
                          <span className="min-w-0 flex-1 truncate">
                            {column.name}
                          </span>
                        </div>
                        {profiling === key ? (
                          <FieldProfile dataset={dataset.name} column={column.name} />
                        ) : null}
                      </li>
                    );
                  })}
                  {columns.length === 0 ? (
                    <li className="px-2 py-1 text-[11.5px] text-faint">
                      No field matches.
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </section>
          );
        })}
      </div>

      <p className="border-t border-line px-3 py-2 text-[11px] leading-snug text-muted-foreground">
        Click a field to add a visual, or drag it onto the canvas. Right-click
        profiles it. Your agent reads the field you point at.
      </p>
    </aside>
  );
}
