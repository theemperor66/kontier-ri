"use client";

/**
 * Inspector Visualize section: chart type (sensible targets only), stacked /
 * legend toggles, xKey and series pickers. Alias options come from the
 * structured query; raw-SQL tiles fall back to free-text keys.
 */

import { useEffect, useMemo, useState } from "react";
import { measureAlias } from "@kontier-ri/studio";
import type { ChartQueryDims, ChartSpec, ChartType, Tile } from "@/lib/dashboard-store";
import { commitSpec, useDebounced } from "./commit";
import { RowError, Section, SelectField, TextField, ToggleField } from "./fields";
import {
  CHART_TYPE_LABEL,
  STACKABLE_TYPES,
  sensibleChartTypes,
} from "./chart-types";

export function VisualizeSection({ tile }: { tile: Tile }) {
  const spec = tile.spec as ChartSpec;
  const structured = !("sql" in spec.query);
  const q = structured ? (spec.query as ChartQueryDims) : null;
  const aliases = useMemo(
    () => (q ? q.measures.map(measureAlias) : []),
    [q],
  );

  const types = sensibleChartTypes(spec);
  const typeOptions = types.map((t) => ({
    value: t,
    label: CHART_TYPE_LABEL[t],
  }));

  // seriesKeys: undefined = auto (all numeric result columns / all measures).
  const effectiveSeries = spec.seriesKeys ?? aliases;
  const [seriesError, setSeriesError] = useState<string | null>(null);
  const toggleSeries = (alias: string, on: boolean) => {
    const next = on
      ? [...aliases.filter((a) => effectiveSeries.includes(a) || a === alias)]
      : effectiveSeries.filter((a) => a !== alias);
    if (next.length === 0) {
      setSeriesError("Pick at least one series.");
      return;
    }
    setSeriesError(null);
    const allSelected = aliases.every((a) => next.includes(a));
    commitSpec(
      tile.id,
      { seriesKeys: allSelected ? undefined : next },
      `Edited “${tile.title}” series`,
    );
  };

  // Raw-SQL fallbacks: free-text xKey + comma-separated series list.
  const [xDraft, setXDraft] = useState(spec.xKey);
  useEffect(() => {
    setXDraft(spec.xKey);
  }, [spec.xKey]);
  const xDebounce = useDebounced((v: string) => {
    const t = v.trim();
    if (t === "") return;
    commitSpec(tile.id, { xKey: t }, `Set “${tile.title}” x-axis to ${t}`);
  });
  const [seriesDraft, setSeriesDraft] = useState(
    (spec.seriesKeys ?? []).join(", "),
  );
  useEffect(() => {
    setSeriesDraft((spec.seriesKeys ?? []).join(", "));
  }, [spec.seriesKeys]);
  const seriesDebounce = useDebounced((v: string) => {
    const keys = v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    commitSpec(
      tile.id,
      { seriesKeys: keys.length > 0 ? keys : undefined },
      `Edited “${tile.title}” series`,
    );
  });

  return (
    <Section title="Visualize" testId="inspector-visualize">
      {types.length >= 2 ? (
        <SelectField
          label="Chart type"
          testId="inspector-chart-type"
          value={spec.chartType}
          options={typeOptions}
          onChange={(v) =>
            commitSpec(
              tile.id,
              { chartType: v as ChartType },
              `Switched “${tile.title}” to ${CHART_TYPE_LABEL[v as ChartType].toLowerCase()}`,
            )
          }
        />
      ) : (
        <p className="text-[11px] leading-snug text-muted-foreground/70">
          {CHART_TYPE_LABEL[spec.chartType]} layout is fixed by its query shape.
        </p>
      )}
      {STACKABLE_TYPES.has(spec.chartType) ? (
        <ToggleField
          label="Stacked"
          testId="inspector-stacked"
          checked={spec.stacked === true}
          onChange={(v) =>
            commitSpec(
              tile.id,
              { stacked: v ? true : undefined },
              v
                ? `Stacked “${tile.title}”`
                : `Unstacked “${tile.title}”`,
            )
          }
        />
      ) : null}
      <ToggleField
        label="Legend"
        testId="inspector-legend"
        checked={spec.legend === true}
        onChange={(v) =>
          commitSpec(
            tile.id,
            { legend: v ? true : undefined },
            v
              ? `Showed the “${tile.title}” legend`
              : `Hid the “${tile.title}” legend`,
          )
        }
      />
      {structured && q ? (
        <>
          <SelectField
            label="X axis"
            testId="inspector-xkey"
            value={spec.xKey}
            options={
              q.dims.includes(spec.xKey)
                ? q.dims.map((d) => ({ value: d, label: d }))
                : [
                    { value: spec.xKey, label: `${spec.xKey} (missing)` },
                    ...q.dims.map((d) => ({ value: d, label: d })),
                  ]
            }
            error={q.dims.includes(spec.xKey) ? null : "Not one of the dimensions."}
            onChange={(v) =>
              commitSpec(tile.id, { xKey: v }, `Set “${tile.title}” x-axis to ${v}`)
            }
          />
          {aliases.length > 0 ? (
            <fieldset className="space-y-1">
              <legend className="mb-1 block text-[11px] font-medium text-muted-foreground">
                Series
              </legend>
              {aliases.map((alias, i) => (
                <label
                  key={alias + i}
                  className="flex cursor-pointer items-center gap-2 text-xs text-foreground"
                >
                  <input
                    type="checkbox"
                    data-testid={`inspector-series-${i}`}
                    className="size-3.5 accent-primary"
                    checked={effectiveSeries.includes(alias)}
                    onChange={(e) => toggleSeries(alias, e.target.checked)}
                  />
                  <span className="truncate">{alias}</span>
                </label>
              ))}
              <RowError message={seriesError} />
            </fieldset>
          ) : null}
        </>
      ) : (
        <>
          <TextField
            label="X axis column"
            testId="inspector-xkey-raw"
            value={xDraft}
            error={xDraft.trim() === "" ? "Column name required." : null}
            hint="Column name from the SQL result."
            onChange={(v) => {
              setXDraft(v);
              xDebounce.call(v);
            }}
            onFlush={xDebounce.flush}
          />
          <TextField
            label="Series columns"
            testId="inspector-series-raw"
            value={seriesDraft}
            placeholder="Auto (all numeric columns)"
            hint="Comma-separated column names; empty = auto."
            onChange={(v) => {
              setSeriesDraft(v);
              seriesDebounce.call(v);
            }}
            onFlush={seriesDebounce.flush}
          />
        </>
      )}
    </Section>
  );
}
