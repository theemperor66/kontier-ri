"use client";

/**
 * Inspector Data section: dataset picker + per-type query editing. Structured
 * chart queries get dims/measures/orderBy/limit/othersBucket controls;
 * raw-SQL tiles get the guarded SQL editor. All writes go through
 * updateTile with origin "human".
 */

import { useEffect, useMemo, useState } from "react";
import { CaretDown, CaretUp, Plus, X } from "@phosphor-icons/react";
import { measureAlias } from "@kontier-ri/studio";
import type {
  Agg,
  ChartMeasure,
  ChartQueryDims,
  ChartSpec,
  KpiSpec,
  TableSpec,
  Tile,
} from "@/lib/dashboard-store";
import { useDashboardStore } from "@/lib/dashboard-store";
import { useDataSource } from "@/lib/datasource";
import { quoteIdent } from "@/lib/sql";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { commitSpec, useDebounced } from "./commit";
import {
  controlCls,
  RowError,
  Section,
  SelectField,
  TextField,
  ToggleField,
  type SelectOption,
} from "./fields";
import { SqlEditor } from "./sql-editor";

export const AGG_OPTIONS: SelectOption[] = [
  { value: "sum", label: "Sum" },
  { value: "avg", label: "Average" },
  { value: "min", label: "Min" },
  { value: "max", label: "Max" },
  { value: "count", label: "Count" },
  { value: "count_distinct", label: "Count distinct" },
  { value: "median", label: "Median" },
];

export function useColumns(dataset: string) {
  const { datasets } = useDataSource();
  return useMemo(
    () => datasets.find((d) => d.name === dataset)?.columns ?? [],
    [datasets, dataset],
  );
}

const selectCls = (invalid?: boolean) =>
  cn(
    controlCls(invalid),
    "flex-1 [&>option]:bg-popover [&>option]:text-popover-foreground",
  );

export function DataSection({ tile }: { tile: Tile }) {
  const { datasets } = useDataSource();
  const spec = tile.spec as KpiSpec | ChartSpec | TableSpec;
  const known = datasets.some((d) => d.name === spec.dataset);
  const datasetOpts = useMemo(() => {
    const opts = datasets.map((d) => ({ value: d.name, label: d.name }));
    if (!opts.some((o) => o.value === spec.dataset)) {
      opts.unshift({ value: spec.dataset, label: `${spec.dataset} (missing)` });
    }
    return opts;
  }, [datasets, spec.dataset]);

  return (
    <Section title="Data" testId="inspector-data">
      <SelectField
        label="Dataset"
        testId="inspector-dataset"
        value={spec.dataset}
        options={datasetOpts}
        error={known ? null : "Dataset not loaded — upload it or pick another."}
        onChange={(v) =>
          commitSpec(tile.id, { dataset: v }, `Set “${tile.title}” dataset to ${v}`)
        }
      />
      {tile.type === "chart" ? (
        <ChartData tile={tile} spec={spec as ChartSpec} />
      ) : tile.type === "kpi" ? (
        <KpiData tile={tile} spec={spec as KpiSpec} />
      ) : (
        <TableData tile={tile} spec={spec as TableSpec} />
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Chart: structured query editor / raw SQL
// ---------------------------------------------------------------------------

function ChartData({ tile, spec }: { tile: Tile; spec: ChartSpec }) {
  if ("sql" in spec.query) {
    return (
      <SqlEditor
        sql={spec.query.sql}
        testIdPrefix="inspector-chart"
        onApply={(sql) =>
          commitSpec(tile.id, { query: { sql } }, `Edited “${tile.title}” SQL`)
        }
        hint="This tile uses raw SQL. Structured queries (dimensions + measures) unlock the full inspector: aggregations, ordering, top-N and more."
      />
    );
  }
  return <StructuredQueryEditor tile={tile} spec={spec} />;
}

function StructuredQueryEditor({
  tile,
  spec,
}: {
  tile: Tile;
  spec: ChartSpec;
}) {
  const q = spec.query as ChartQueryDims;
  const columns = useColumns(spec.dataset);
  const calc = useDashboardStore((s) => s.doc.calculatedFields);
  const fields = useMemo(
    () => calc.filter((f) => f.dataset === spec.dataset),
    [calc, spec.dataset],
  );

  const dimOptions: SelectOption[] = useMemo(
    () => [
      ...columns.map((c) => ({ value: c.name, label: c.name })),
      ...fields
        .filter((f) => f.kind === "row")
        .map((f) => ({ value: f.name, label: `${f.name} (calc)` })),
    ],
    [columns, fields],
  );
  const measureColOptions: SelectOption[] = useMemo(
    () => [
      { value: "*", label: "* (all rows)" },
      ...columns.map((c) => ({ value: c.name, label: c.name })),
      ...fields.map((f) => ({ value: f.name, label: `${f.name} (calc)` })),
    ],
    [columns, fields],
  );

  const commitQuery = (
    nq: ChartQueryDims,
    label: string,
    extra: Record<string, unknown> = {},
  ) => commitSpec(tile.id, { query: nq, ...extra }, label);

  const setDims = (dims: string[]) => {
    const extra: Record<string, unknown> = {};
    if (dims.length > 0 && !dims.includes(spec.xKey)) extra.xKey = dims[0];
    commitQuery({ ...q, dims }, `Edited “${tile.title}” dimensions`, extra);
  };

  /** Commit measures + rename stale seriesKeys/series aliases in the same patch. */
  const setMeasures = (
    measures: ChartMeasure[],
    renames: [string, string][] = [],
  ) => {
    const extra: Record<string, unknown> = {};
    if (renames.length > 0) {
      const map = new Map(renames);
      if (spec.seriesKeys) {
        extra.seriesKeys = spec.seriesKeys.map((k) => map.get(k) ?? k);
      }
      if (spec.series) {
        extra.series = spec.series.map((s) =>
          map.has(s.key) ? { ...s, key: map.get(s.key)! } : s,
        );
      }
    }
    commitQuery({ ...q, measures }, `Edited “${tile.title}” measures`, extra);
  };

  const removeMeasure = (i: number) => {
    const alias = measureAlias(q.measures[i]!);
    const measures = q.measures.filter((_, j) => j !== i);
    const extra: Record<string, unknown> = {};
    if (spec.seriesKeys) {
      const next = spec.seriesKeys.filter((k) => k !== alias);
      extra.seriesKeys = next.length > 0 ? next : undefined;
    }
    if (spec.series) {
      const next = spec.series.filter((s) => s.key !== alias);
      extra.series = next.length > 0 ? next : undefined;
    }
    commitQuery({ ...q, measures }, `Removed a “${tile.title}” measure`, extra);
  };

  const aliases = q.measures.map(measureAlias);
  const duplicateAliases = aliases.filter((a, i) => aliases.indexOf(a) !== i);

  // ---- orderBy ----
  const orderKeys = [...q.dims, ...aliases];
  const parsedOrder = useMemo(() => {
    if (!q.orderBy) return { col: "__default", dir: "asc", raw: false };
    const m = /^"?([A-Za-z_][A-Za-z0-9_]*)"?(?:\s+(asc|desc))?$/i.exec(
      q.orderBy.trim(),
    );
    if (m && orderKeys.includes(m[1]!)) {
      return { col: m[1]!, dir: (m[2] ?? "asc").toLowerCase(), raw: false };
    }
    return { col: "", dir: "asc", raw: true };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.orderBy, orderKeys.join("|")]);
  const orderByExpr = (col: string, dir: string) =>
    `${quoteIdent(col)}${dir === "desc" ? " DESC" : ""}`;
  const rawOrderDebounce = useDebounced((raw: string) => {
    const t = raw.trim();
    commitQuery(
      { ...q, orderBy: t === "" ? undefined : t },
      `Set “${tile.title}” ordering`,
    );
  });
  const [rawOrderDraft, setRawOrderDraft] = useState(q.orderBy ?? "");
  useEffect(() => {
    setRawOrderDraft(q.orderBy ?? "");
  }, [q.orderBy]);

  // ---- limit ----
  const [limitDraft, setLimitDraft] = useState(q.limit?.toString() ?? "");
  useEffect(() => {
    setLimitDraft(q.limit?.toString() ?? "");
  }, [q.limit]);
  const limitTrim = limitDraft.trim();
  const limitError =
    limitTrim === "" || (/^\d+$/.test(limitTrim) && Number(limitTrim) >= 1)
      ? null
      : "Limit must be a positive whole number.";
  const limitDebounce = useDebounced((raw: string) => {
    const t = raw.trim();
    if (t === "") {
      commitQuery(
        { ...q, limit: undefined, othersBucket: undefined },
        `Cleared “${tile.title}” row limit`,
      );
      return;
    }
    if (!/^\d+$/.test(t) || Number(t) < 1) return;
    commitQuery(
      { ...q, limit: Number(t) },
      `Set “${tile.title}” row limit to ${t}`,
    );
  });

  const othersEligible = q.dims.length === 1 && q.limit != null;

  return (
    <>
      {/* Dimensions */}
      <div className="space-y-1.5">
        <span className="block text-[11px] font-medium text-muted-foreground">
          Dimensions
        </span>
        {q.dims.map((dim, i) => {
          const knownDim = dimOptions.some((o) => o.value === dim);
          return (
            <div key={`dim-${i}`} className="space-y-1">
              <div className="flex items-center gap-1">
                <select
                  aria-label={`Dimension ${i + 1}`}
                  data-testid={`inspector-dim-${i}`}
                  value={dim}
                  onChange={(e) => {
                    const dims = [...q.dims];
                    dims[i] = e.target.value;
                    setDims(dims);
                  }}
                  className={selectCls(!knownDim)}
                >
                  {!knownDim ? <option value={dim}>{dim} (missing)</option> : null}
                  {dimOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move dimension ${i + 1} up`}
                  disabled={i === 0}
                  onClick={() => {
                    const dims = [...q.dims];
                    [dims[i - 1], dims[i]] = [dims[i]!, dims[i - 1]!];
                    setDims(dims);
                  }}
                >
                  <CaretUp className="size-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move dimension ${i + 1} down`}
                  disabled={i === q.dims.length - 1}
                  onClick={() => {
                    const dims = [...q.dims];
                    [dims[i], dims[i + 1]] = [dims[i + 1]!, dims[i]!];
                    setDims(dims);
                  }}
                >
                  <CaretDown className="size-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove dimension ${i + 1}`}
                  disabled={q.dims.length <= 1}
                  onClick={() => setDims(q.dims.filter((_, j) => j !== i))}
                >
                  <X className="size-3" />
                </Button>
              </div>
              {!knownDim ? <RowError message="Column not in dataset." /> : null}
            </div>
          );
        })}
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          data-testid="inspector-add-dim"
          disabled={dimOptions.length === 0}
          onClick={() => {
            const unused =
              dimOptions.find((o) => !q.dims.includes(o.value))?.value ??
              dimOptions[0]!.value;
            setDims([...q.dims, unused]);
          }}
        >
          <Plus className="size-3" /> Add dimension
        </Button>
      </div>

      {/* Measures */}
      <div className="space-y-1.5">
        <span className="block text-[11px] font-medium text-muted-foreground">
          Measures
        </span>
        {q.measures.map((m, i) => {
          const knownCol =
            m.col === "*" || measureColOptions.some((o) => o.value === m.col);
          const isAggField = fields.some(
            (f) => f.name === m.col && f.kind === "aggregate",
          );
          const dup = duplicateAliases.includes(measureAlias(m));
          return (
            <div key={`measure-${i}`} className="space-y-1">
              <div className="flex items-center gap-1">
                <select
                  aria-label={`Measure ${i + 1} column`}
                  data-testid={`inspector-measure-col-${i}`}
                  value={m.col}
                  onChange={(e) => {
                    const next = { ...m, col: e.target.value };
                    setMeasures(
                      q.measures.map((mm, j) => (j === i ? next : mm)),
                      [[measureAlias(m), measureAlias(next)]],
                    );
                  }}
                  className={selectCls(!knownCol)}
                >
                  {!knownCol ? <option value={m.col}>{m.col} (missing)</option> : null}
                  {measureColOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`Measure ${i + 1} aggregation`}
                  data-testid={`inspector-measure-agg-${i}`}
                  value={m.agg}
                  disabled={isAggField}
                  onChange={(e) => {
                    const next = { ...m, agg: e.target.value as Agg };
                    setMeasures(
                      q.measures.map((mm, j) => (j === i ? next : mm)),
                      [[measureAlias(m), measureAlias(next)]],
                    );
                  }}
                  className={cn(selectCls(false), "max-w-24 disabled:opacity-50")}
                >
                  {AGG_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove measure ${i + 1}`}
                  disabled={q.measures.length <= 1}
                  onClick={() => removeMeasure(i)}
                >
                  <X className="size-3" />
                </Button>
              </div>
              {!knownCol ? <RowError message="Column not in dataset." /> : null}
              {isAggField ? (
                <p className="text-[11px] leading-snug text-muted-foreground/70">
                  Aggregate calculated field — the aggregation is built in.
                </p>
              ) : null}
              {dup ? (
                <RowError message="Duplicate measure (same column + aggregation)." />
              ) : null}
            </div>
          );
        })}
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          data-testid="inspector-add-measure"
          onClick={() => {
            const firstNumeric = columns.find((c) =>
              /INT|DECIMAL|DOUBLE|FLOAT|REAL|HUGEINT|NUMERIC/i.test(c.type),
            );
            const next: ChartMeasure = firstNumeric
              ? { col: firstNumeric.name, agg: "sum" }
              : { col: "*", agg: "count" };
            setMeasures([...q.measures, next]);
          }}
        >
          <Plus className="size-3" /> Add measure
        </Button>
      </div>

      {/* Order / limit / others bucket */}
      {parsedOrder.raw ? (
        <TextField
          label="Order by (SQL)"
          testId="inspector-orderby-raw"
          value={rawOrderDraft}
          onChange={(v) => {
            setRawOrderDraft(v);
            rawOrderDebounce.call(v);
          }}
          onFlush={rawOrderDebounce.flush}
          hint="Free-form ORDER BY fragment (custom value kept as-is)."
        />
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          <SelectField
            label="Order by"
            testId="inspector-orderby"
            value={parsedOrder.col}
            options={[
              { value: "__default", label: "Default (first dim)" },
              ...orderKeys.map((k) => ({ value: k, label: k })),
            ]}
            onChange={(v) =>
              commitQuery(
                {
                  ...q,
                  orderBy:
                    v === "__default" ? undefined : orderByExpr(v, parsedOrder.dir),
                },
                `Set “${tile.title}” ordering`,
              )
            }
          />
          <SelectField
            label="Direction"
            testId="inspector-orderdir"
            value={parsedOrder.dir}
            disabled={parsedOrder.col === "__default"}
            options={[
              { value: "asc", label: "Ascending" },
              { value: "desc", label: "Descending" },
            ]}
            onChange={(v) =>
              commitQuery(
                { ...q, orderBy: orderByExpr(parsedOrder.col, v) },
                `Set “${tile.title}” ordering`,
              )
            }
          />
        </div>
      )}
      <TextField
        label="Row limit"
        testId="inspector-limit"
        type="number"
        value={limitDraft}
        placeholder="No limit"
        error={limitError}
        onChange={(v) => {
          setLimitDraft(v);
          limitDebounce.call(v);
        }}
        onFlush={limitDebounce.flush}
      />
      <ToggleField
        label={'Group remainder into “Other”'}
        testId="inspector-othersbucket"
        checked={q.othersBucket === true}
        disabled={!othersEligible}
        hint={
          othersEligible
            ? "Keeps the top-limit groups by the first measure; the rest collapse into one “Other” row."
            : "Needs a row limit and exactly one dimension."
        }
        onChange={(v) =>
          commitQuery(
            { ...q, othersBucket: v ? true : undefined },
            v
              ? `Enabled “Other” bucketing on “${tile.title}”`
              : `Disabled “Other” bucketing on “${tile.title}”`,
          )
        }
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// KPI
// ---------------------------------------------------------------------------

function KpiData({ tile, spec }: { tile: Tile; spec: KpiSpec }) {
  const columns = useColumns(spec.dataset);
  const calc = useDashboardStore((s) => s.doc.calculatedFields);
  const fields = useMemo(
    () => calc.filter((f) => f.dataset === spec.dataset),
    [calc, spec.dataset],
  );
  if (spec.sql) {
    return (
      <SqlEditor
        sql={spec.sql}
        testIdPrefix="inspector-kpi"
        onApply={(sql) =>
          commitSpec(tile.id, { sql }, `Edited “${tile.title}” SQL`)
        }
        hint="Raw-SQL KPI: return a value column (optional prev). A structured measure + aggregation unlocks the sparkline and simpler editing."
      />
    );
  }
  const measureOptions: SelectOption[] = [
    { value: "*", label: "* (all rows)" },
    ...columns.map((c) => ({ value: c.name, label: c.name })),
    ...fields.map((f) => ({ value: f.name, label: `${f.name} (calc)` })),
  ];
  const measure = spec.measure ?? "*";
  const knownMeasure = measureOptions.some((o) => o.value === measure);
  const isAggField = fields.some(
    (f) => f.name === measure && f.kind === "aggregate",
  );
  return (
    <>
      <SelectField
        label="Measure"
        testId="inspector-kpi-measure"
        value={measure}
        options={
          knownMeasure
            ? measureOptions
            : [{ value: measure, label: `${measure} (missing)` }, ...measureOptions]
        }
        error={knownMeasure ? null : "Column not in dataset."}
        onChange={(v) =>
          commitSpec(tile.id, { measure: v }, `Set “${tile.title}” measure to ${v}`)
        }
      />
      {isAggField ? (
        <p className="text-[11px] leading-snug text-muted-foreground/70">
          Aggregate calculated field — the aggregation is built in.
        </p>
      ) : (
        <SelectField
          label="Aggregation"
          testId="inspector-kpi-agg"
          value={spec.agg ?? "sum"}
          options={AGG_OPTIONS}
          onChange={(v) =>
            commitSpec(tile.id, { agg: v }, `Set “${tile.title}” aggregation to ${v}`)
          }
        />
      )}
      <ToggleField
        label="Compare to previous period"
        testId="inspector-kpi-compare"
        checked={spec.compare === "prev_period"}
        onChange={(v) =>
          commitSpec(
            tile.id,
            { compare: v ? "prev_period" : undefined },
            v
              ? `Enabled previous-period compare on “${tile.title}”`
              : `Disabled previous-period compare on “${tile.title}”`,
          )
        }
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

function TableData({ tile, spec }: { tile: Tile; spec: TableSpec }) {
  const [pageDraft, setPageDraft] = useState(spec.pageSize?.toString() ?? "");
  useEffect(() => {
    setPageDraft(spec.pageSize?.toString() ?? "");
  }, [spec.pageSize]);
  const trim = pageDraft.trim();
  const pageError =
    trim === "" ||
    (/^\d+$/.test(trim) && Number(trim) >= 1 && Number(trim) <= 25)
      ? null
      : "Page size must be between 1 and 25.";
  const pageDebounce = useDebounced((raw: string) => {
    const t = raw.trim();
    if (t === "") {
      commitSpec(tile.id, { pageSize: undefined }, `Reset “${tile.title}” page size`);
      return;
    }
    if (!/^\d+$/.test(t)) return;
    const n = Number(t);
    if (n < 1 || n > 25) return;
    commitSpec(tile.id, { pageSize: n }, `Set “${tile.title}” page size to ${n}`);
  });
  return (
    <>
      <SqlEditor
        sql={spec.sql}
        testIdPrefix="inspector-table"
        onApply={(sql) =>
          commitSpec(tile.id, { sql }, `Edited “${tile.title}” SQL`)
        }
      />
      <TextField
        label="Page size"
        testId="inspector-pagesize"
        type="number"
        value={pageDraft}
        placeholder="Default"
        error={pageError}
        hint="Rows per page (max 25)."
        onChange={(v) => {
          setPageDraft(v);
          pageDebounce.call(v);
        }}
        onFlush={pageDebounce.flush}
      />
    </>
  );
}
