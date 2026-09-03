"use client";

/**
 * Add visual: the human authoring path that matches the agent's. Pick a
 * dataset, a field to group by and a measure; the dialog previews the real
 * tile (same renderer, same query engine) before it is added through the
 * normal command layer.
 */

import { useEffect, useMemo, useState } from "react";
import { ChartBar, ChartDonut, ChartLine, Gauge, Table as TableIcon, X } from "@phosphor-icons/react";
import { toast } from "sonner";
import type { ColumnMeta } from "@kontier-ri/datasource";
import type { AddTileInput, Tile } from "@/lib/dashboard-store";
import { useDashboardStore } from "@/lib/dashboard-store";
import { useDataSource } from "@/lib/datasource";
import { useUiState } from "@/lib/ui-state";
import { Button } from "@/components/ui/button";
import { KpiTile } from "@/components/tiles/kpi-tile";
import { ChartTile } from "@/components/tiles/chart-tile";
import { TableTile } from "@/components/tiles/table-tile";
import { cn } from "@/lib/utils";

type VisualKind = "kpi" | "bar" | "line" | "area" | "donut" | "table";

const KINDS: { kind: VisualKind; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { kind: "kpi", label: "KPI", Icon: Gauge },
  { kind: "bar", label: "Bar", Icon: ChartBar },
  { kind: "line", label: "Line", Icon: ChartLine },
  { kind: "area", label: "Area", Icon: ChartLine },
  { kind: "donut", label: "Donut", Icon: ChartDonut },
  { kind: "table", label: "Table", Icon: TableIcon },
];

const AGGS = ["sum", "avg", "count", "count_distinct", "min", "max", "median"] as const;
type Agg = (typeof AGGS)[number];

const NUMERIC = /INT|DECIMAL|DOUBLE|FLOAT|REAL|HUGEINT|NUMERIC/i;
const TEMPORAL = /DATE|TIME/i;

function isNumeric(column: ColumnMeta): boolean {
  return NUMERIC.test(column.type);
}

function humanize(name: string): string {
  return name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function buildInput(
  kind: VisualKind,
  dataset: string,
  dimension: string,
  measure: string,
  agg: Agg,
  title: string,
): AddTileInput | null {
  if (kind === "kpi") {
    return {
      type: "kpi",
      title,
      spec: {
        dataset,
        measure: measure || "*",
        agg: measure ? agg : "count",
        format: agg === "count" || agg === "count_distinct" ? "number" : "number",
      },
    };
  }
  if (kind === "table") {
    return {
      type: "table",
      title,
      spec: {
        dataset,
        sql: `SELECT * FROM ${dataset} LIMIT 200`,
        pageSize: 10,
      },
    };
  }
  if (!dimension) return null;
  return {
    type: "chart",
    title,
    spec: {
      dataset,
      query: {
        dims: [dimension],
        measures: [{ col: measure || "*", agg: measure ? agg : "count" }],
        ...(kind === "donut" ? { limit: 8, othersBucket: true } : {}),
      },
      chartType: kind,
      xKey: dimension,
    },
  };
}

function PreviewTile({ input }: { input: AddTileInput }) {
  const tile = useMemo<Tile>(
    () => ({
      id: "add_visual_preview",
      type: input.type,
      title: input.title,
      layout: { x: 0, y: 0, w: 6, h: 4 },
      spec: structuredClone(input.spec) as Tile["spec"],
      annotations: [],
    }),
    [input],
  );
  if (tile.type === "kpi") return <KpiTile tile={tile} />;
  if (tile.type === "table") return <TableTile tile={tile} />;
  if (tile.type === "chart") return <ChartTile tile={tile} />;
  return null;
}

export function AddVisualDialog() {
  const open = useUiState((s) => s.addVisualOpen);
  const setOpen = useUiState((s) => s.setAddVisualOpen);
  const { datasets, status } = useDataSource();
  const addTile = useDashboardStore((s) => s.addTile);
  const selectTile = useDashboardStore((s) => s.selectTile);

  const [dataset, setDataset] = useState("");
  const [kind, setKind] = useState<VisualKind>("bar");
  const [dimension, setDimension] = useState("");
  const [measure, setMeasure] = useState("");
  const [agg, setAgg] = useState<Agg>("sum");
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);

  const columns = useMemo(
    () => datasets.find((d) => d.name === dataset)?.columns ?? [],
    [datasets, dataset],
  );
  const dimensions = useMemo(
    () => columns.filter((c) => !isNumeric(c) || TEMPORAL.test(c.type)),
    [columns],
  );
  const measures = useMemo(() => columns.filter(isNumeric), [columns]);

  // Pick sensible defaults whenever the dialog opens or the dataset changes.
  useEffect(() => {
    if (!open) return;
    const first = datasets[0];
    if (!dataset && first) setDataset(first.name);
  }, [open, datasets, dataset]);

  useEffect(() => {
    if (!dataset) return;
    const dims = columns.filter((c) => !isNumeric(c) || TEMPORAL.test(c.type));
    const nums = columns.filter(isNumeric);
    setDimension(
      dims.find((c) => /month|date|period/i.test(c.name))?.name ?? dims[0]?.name ?? "",
    );
    setMeasure(nums.find((c) => /amount|revenue|mrr|value/i.test(c.name))?.name ?? nums[0]?.name ?? "");
  }, [dataset, columns]);

  const derivedTitle = useMemo(() => {
    if (kind === "table") return `${humanize(dataset)} rows`;
    if (kind === "kpi") {
      return measure ? `${humanize(measure)} (${agg})` : `${humanize(dataset)} row count`;
    }
    return measure && dimension
      ? `${humanize(measure)} by ${dimension}`
      : `${humanize(dataset)} by ${dimension}`;
  }, [kind, dataset, dimension, measure, agg]);

  useEffect(() => {
    if (!titleTouched) setTitle(derivedTitle);
  }, [derivedTitle, titleTouched]);

  const input = useMemo(
    () => (dataset ? buildInput(kind, dataset, dimension, measure, agg, title || derivedTitle) : null),
    [kind, dataset, dimension, measure, agg, title, derivedTitle],
  );

  if (!open) return null;

  const close = () => {
    setOpen(false);
    setTitleTouched(false);
  };

  const add = () => {
    if (!input) return;
    const result = addTile(input, {
      origin: "human",
      label: `Added ${input.type} tile “${input.title}”`,
    });
    if (!result.ok) {
      toast.error("error" in result ? result.error : "Could not add the visual.");
      return;
    }
    if (result.tileId) selectTile(result.tileId);
    toast.success(`Added “${input.title}”.`);
    close();
  };

  const fieldCls =
    "h-9 w-full min-w-0 rounded-lg border border-line bg-card px-2.5 text-[13px] outline-none transition-colors focus:border-accent-mid focus:ring-2 focus:ring-ring/20";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-nav/40 p-4 pt-[8vh]"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add visual"
        data-testid="add-visual-dialog"
        className="flex w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-line bg-card shadow-card"
        onKeyDown={(event) => {
          if (event.key === "Escape") close();
        }}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div>
            <h2 className="text-base font-semibold">Add visual</h2>
            <p className="text-[12.5px] text-muted-foreground">
              The same tile spec your agent writes — previewed before it lands.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            className="grid size-8 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="grid gap-5 p-5 sm:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
          <div className="space-y-3.5">
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground">Dataset</span>
              <select
                data-testid="add-visual-dataset"
                className={fieldCls}
                value={dataset}
                onChange={(event) => setDataset(event.target.value)}
                disabled={status !== "ready"}
              >
                {datasets.map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name} · {d.rowCount.toLocaleString()} rows
                  </option>
                ))}
              </select>
            </label>

            <div className="space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground">Visual</span>
              <div className="grid grid-cols-3 gap-1.5">
                {KINDS.map((option) => (
                  <button
                    key={option.kind}
                    type="button"
                    data-testid={`add-visual-kind-${option.kind}`}
                    onClick={() => setKind(option.kind)}
                    className={cn(
                      "flex h-[52px] cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border text-[11.5px] transition-colors",
                      kind === option.kind
                        ? "border-accent-mid bg-accent text-accent-foreground"
                        : "border-line text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                    )}
                  >
                    <option.Icon className="size-4" />
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {kind !== "table" && kind !== "kpi" ? (
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-muted-foreground">Group by</span>
                <select
                  data-testid="add-visual-dimension"
                  className={fieldCls}
                  value={dimension}
                  onChange={(event) => setDimension(event.target.value)}
                >
                  {dimensions.map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {kind !== "table" ? (
              <div className="flex gap-2">
                <label className="block flex-1 space-y-1">
                  <span className="text-[11px] font-medium text-muted-foreground">Measure</span>
                  <select
                    data-testid="add-visual-measure"
                    className={fieldCls}
                    value={measure}
                    onChange={(event) => setMeasure(event.target.value)}
                  >
                    <option value="">Row count</option>
                    {measures.map((column) => (
                      <option key={column.name} value={column.name}>
                        {column.name}
                      </option>
                    ))}
                  </select>
                </label>
                {measure ? (
                  <label className="block w-32 space-y-1">
                    <span className="text-[11px] font-medium text-muted-foreground">Aggregate</span>
                    <select
                      data-testid="add-visual-agg"
                      className={fieldCls}
                      value={agg}
                      onChange={(event) => setAgg(event.target.value as Agg)}
                    >
                      {AGGS.map((option) => (
                        <option key={option} value={option}>
                          {option.replace("_", " ")}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
            ) : null}

            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground">Title</span>
              <input
                data-testid="add-visual-title"
                className={fieldCls}
                value={title}
                onChange={(event) => {
                  setTitleTouched(true);
                  setTitle(event.target.value);
                }}
              />
            </label>
          </div>

          <div className="flex min-h-[15rem] flex-col rounded-xl border border-line bg-background p-3">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">
              Live preview
            </p>
            <div className="min-h-0 flex-1">
              {input ? (
                <PreviewTile input={input} />
              ) : (
                <p className="text-[13px] text-muted-foreground">
                  Pick a dataset and a field to group by.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button data-testid="add-visual-submit" disabled={!input} onClick={add}>
            Add to report
          </Button>
        </div>
      </div>
    </div>
  );
}
