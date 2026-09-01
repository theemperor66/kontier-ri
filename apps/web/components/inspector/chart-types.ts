import type {
  ChartQueryDims,
  ChartSpec,
  ChartType,
} from "@/lib/dashboard-store";

/**
 * Chart-type metadata for the inspector. The sensible-target rules mirror
 * the hover quick-switcher in canvas/tile-frame.tsx (not exported from
 * there; the mapping is deliberately duplicated per the pack brief).
 */

export const CHART_TYPE_LABEL: Record<ChartType, string> = {
  line: "Line",
  bar: "Bar",
  area: "Area",
  hbar: "Horizontal bar",
  pie: "Pie",
  donut: "Donut",
  funnel: "Funnel",
  scatter: "Scatter",
  combo: "Combo",
  stacked100: "100% stacked",
  radar: "Radar",
  heatmap: "Heatmap",
};

/**
 * Chart types this spec can switch to without breaking its query shape:
 * cartesian swaps always work; part-to-whole needs a single series; scatter
 * and heatmap have structural requirements, so they are never offered as
 * targets (only kept when current).
 */
export function sensibleChartTypes(spec: ChartSpec): ChartType[] {
  if (spec.chartType === "heatmap") return [];
  const structured = !("sql" in spec.query);
  const measureCount = structured
    ? (spec.query as ChartQueryDims).measures.length
    : Math.max(1, spec.seriesKeys?.length ?? 1);
  const single = measureCount <= 1;
  const types: ChartType[] = ["line", "bar", "area", "hbar"];
  if (single) types.push("donut", "pie", "funnel");
  else types.push("stacked100", "radar", "combo");
  if (!types.includes(spec.chartType)) types.unshift(spec.chartType);
  return types;
}

/** Chart types whose renderer draws the dashed regression trendline. */
export const TRENDLINE_TYPES: ReadonlySet<ChartType> = new Set([
  "line",
  "bar",
  "area",
  "scatter",
  "combo",
]);

/** Chart types whose renderer draws spec.analytics.referenceLine. */
export const REFERENCE_LINE_TYPES: ReadonlySet<ChartType> = new Set([
  "line",
  "bar",
  "area",
  "scatter",
  "combo",
  "hbar",
]);

/** Chart types where the stacked toggle changes anything. */
export const STACKABLE_TYPES: ReadonlySet<ChartType> = new Set([
  "bar",
  "area",
  "hbar",
]);
