"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  Area,
  Bar,
  Brush,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartSpec, Tile } from "@/lib/dashboard-store";
import { useDashboardStore } from "@/lib/dashboard-store";
import { useTileData } from "@/lib/use-tile-data";
import { resolveRuleColor } from "@/lib/format";
import { TileError } from "./tile-error";
import { TileShimmer } from "./tile-shimmer";
import {
  axisTickFormatter,
  axisWidth,
  CHART_PALETTE,
  markOpacity,
  tooltipValueFormatter,
  TOOLTIP_STYLE,
  TREND_KEY,
  useCrossFilterEmit,
  useHiddenSeries,
} from "@/components/canvas/charts/common";
import { withTrend } from "@/components/canvas/charts/regression";
import { ScatterChartView } from "@/components/canvas/charts/scatter-chart";
import { ComboChartView } from "@/components/canvas/charts/combo-chart";
import { DonutChartView } from "@/components/canvas/charts/donut-chart";
import { HBarChartView } from "@/components/canvas/charts/hbar-chart";
import { Stacked100ChartView } from "@/components/canvas/charts/stacked100-chart";
import { FunnelChartView } from "@/components/canvas/charts/funnel-chart";
import { RadarChartView } from "@/components/canvas/charts/radar-chart";
import { HeatmapChartView } from "@/components/canvas/charts/heatmap-chart";

/** Coerce DB values into something recharts can plot. */
function toPlottable(v: unknown): unknown {
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string" && v !== "" && !Number.isNaN(Number(v))) {
    return v.match(/^-?\d+(\.\d+)?$/) ? Number(v) : v;
  }
  return v;
}

function isNumericType(type: string): boolean {
  const t = type.toLowerCase();
  return (
    t.includes("int") ||
    t.includes("float") ||
    t.includes("double") ||
    t.includes("decimal")
  );
}

export function ChartTile({ tile }: { tile: Tile }) {
  const spec = tile.spec as ChartSpec;
  const { loading, error, result } = useTileData(tile);
  const setBrushedRange = useDashboardStore((s) => s.setBrushedRange);
  const { crossFilter, emit: handleItemClick } = useCrossFilterEmit(tile.id);
  const brushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { hidden, toggle } = useHiddenSeries();

  const { data, xKey, seriesKeys } = useMemo(() => {
    if (!result || result.columns.length === 0) {
      return { data: [] as Record<string, unknown>[], xKey: "x", seriesKeys: [] as string[] };
    }
    const cols = result.columns;
    const x =
      spec.xKey && cols.some((c) => c.name === spec.xKey)
        ? spec.xKey
        : (cols[0]?.name ?? "x");
    const numeric = cols
      .filter(
        (c) =>
          c.name !== x &&
          c.name !== spec.yKey &&
          (isNumericType(c.type) ||
            result.rows.some((r) => typeof r[cols.indexOf(c)] === "number")),
      )
      .map((c) => c.name);
    const series =
      spec.seriesKeys && spec.seriesKeys.length > 0
        ? spec.seriesKeys.filter((k) => cols.some((c) => c.name === k))
        : spec.chartType === "scatter" &&
            spec.yKey &&
            cols.some((c) => c.name === spec.yKey)
          ? [spec.yKey]
          : numeric;
    const rows = result.rows.map((r) => {
      const obj: Record<string, unknown> = {};
      cols.forEach((c, i) => {
        obj[c.name] = c.name === x ? r[i] : toPlottable(r[i]);
      });
      return obj;
    });
    return { data: rows, xKey: x, seriesKeys: series };
  }, [result, spec.xKey, spec.seriesKeys, spec.yKey, spec.chartType]);

  // Highlight marks matching the active cross-filter on this tile's x column.
  const activeValue =
    crossFilter && crossFilter.column === xKey ? crossFilter.value : undefined;

  // Flush pending brush updates on unmount.
  useEffect(
    () => () => {
      if (brushTimer.current) clearTimeout(brushTimer.current);
    },
    [],
  );

  if (error) return <TileError message={error} />;
  if (loading || !result) return <TileShimmer kind="chart" />;
  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        No rows for the current filters.
      </div>
    );
  }

  const colorFor = (i: number) =>
    i === 0 && spec.color ? spec.color : CHART_PALETTE[i % CHART_PALETTE.length]!;

  const valueFormat = spec.format?.value;
  const y2Format = spec.format?.y2;
  const rules = spec.format?.rules;
  const analytics = spec.analytics;
  const trend = analytics?.trendline === true;
  const refLine = analytics?.referenceLine;

  const temporal =
    typeof data[0]?.[xKey] === "string" &&
    /^\d{4}-\d{2}/.test(String(data[0][xKey]));
  const showBrush =
    ["line", "bar", "area"].includes(spec.chartType) &&
    temporal &&
    data.length > 8;

  const handleBrush = (range: { startIndex?: number; endIndex?: number }) => {
    if (brushTimer.current) clearTimeout(brushTimer.current);
    brushTimer.current = setTimeout(() => {
      const { startIndex, endIndex } = range;
      if (startIndex == null || endIndex == null) return;
      if (startIndex <= 0 && endIndex >= data.length - 1) {
        setBrushedRange(null);
        return;
      }
      setBrushedRange({
        tileId: tile.id,
        from: String(data[startIndex]?.[xKey] ?? ""),
        to: String(data[endIndex]?.[xKey] ?? ""),
      });
    }, 250);
  };

  const annotations = (tile.annotations ?? []).filter((a) => a.anchor?.x != null);
  const annotationLines = annotations.map((a, i) => (
    <ReferenceLine
      key={`ann-${i}`}
      x={a.anchor?.x as string | number}
      stroke="var(--chart-4)"
      strokeDasharray="4 3"
      label={{
        value: a.text.length > 24 ? `${a.text.slice(0, 24)}…` : a.text,
        position: "insideTopRight",
        fill: "var(--muted-foreground)",
        fontSize: 10,
      }}
    />
  ));
  const referenceLineEl = refLine ? (
    <ReferenceLine
      key="spec-ref"
      {...(spec.chartType === "hbar" ? { x: refLine.value } : { y: refLine.value })}
      stroke={refLine.color ?? "var(--chart-4)"}
      strokeDasharray="6 4"
      strokeWidth={1.5}
      ifOverflow="extendDomain"
      label={
        refLine.label
          ? {
              value: refLine.label,
              position: "insideBottomRight",
              fill: "var(--muted-foreground)",
              fontSize: 10,
            }
          : undefined
      }
    />
  ) : null;
  const legendEl = spec.legend ? (
    <Legend
      onClick={(entry: { dataKey?: unknown; value?: unknown }) =>
        toggle(typeof entry.dataKey === "string" ? entry.dataKey : entry.value)
      }
      wrapperStyle={{ fontSize: 11, cursor: "pointer" }}
      iconSize={8}
    />
  ) : null;

  // ---- New v2 chart types (renderers in components/canvas/charts) ----
  const baseProps = {
    data,
    xKey,
    seriesKeys,
    colorFor,
    valueFormat,
    onItemClick: handleItemClick,
    activeValue,
    hiddenKeys: hidden,
  };

  switch (spec.chartType) {
    case "scatter":
      return (
        <ScatterChartView {...baseProps} trend={trend}>
          {referenceLineEl}
          {legendEl}
        </ScatterChartView>
      );
    case "combo": {
      const comboData = trend && seriesKeys[0] ? withTrend(data, seriesKeys[0], TREND_KEY) : data;
      return (
        <ComboChartView
          {...baseProps}
          data={comboData}
          series={spec.series}
          y2Format={y2Format}
        >
          {trend ? (
            <Line
              yAxisId="left"
              dataKey={TREND_KEY}
              stroke="var(--muted-foreground)"
              strokeDasharray="6 4"
              strokeWidth={1.5}
              dot={false}
              activeDot={false}
              legendType="none"
              tooltipType="none"
              isAnimationActive={false}
            />
          ) : null}
          {referenceLineEl}
          {legendEl}
        </ComboChartView>
      );
    }
    case "donut":
      return <DonutChartView {...baseProps} />;
    case "hbar":
      return (
        <HBarChartView
          {...baseProps}
          stacked={spec.stacked}
          ruleColorFor={(v) => resolveRuleColor(v, rules)}
        >
          {referenceLineEl}
          {legendEl}
        </HBarChartView>
      );
    case "stacked100":
      return (
        <Stacked100ChartView {...baseProps}>{legendEl}</Stacked100ChartView>
      );
    case "funnel":
      return <FunnelChartView {...baseProps} />;
    case "radar":
      return <RadarChartView {...baseProps}>{legendEl}</RadarChartView>;
    case "heatmap": {
      const yKey =
        spec.yKey && data.some((r) => spec.yKey! in r)
          ? spec.yKey
          : (result.columns.find(
              (c) => c.name !== xKey && !seriesKeys.includes(c.name),
            )?.name ?? xKey);
      return <HeatmapChartView {...baseProps} yKey={yKey} />;
    }
    default:
      break;
  }

  // ---- v1 chart types (line / bar / area / pie) ----
  if (spec.chartType === "pie") {
    const valueKey = seriesKeys[0];
    if (!valueKey) return <TileError message="Pie chart needs a numeric column." />;
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <Pie
            data={data}
            dataKey={valueKey}
            nameKey={xKey}
            innerRadius="55%"
            outerRadius="85%"
            paddingAngle={2}
            stroke="var(--card)"
            className="cursor-pointer"
            onClick={(item: unknown) => {
              // recharts 3 spreads the datum into the sector item; payload
              // is not always present.
              const entry = item as
                | ({ payload?: Record<string, unknown>; name?: unknown } & Record<string, unknown>)
                | undefined;
              const v = entry?.payload?.[xKey] ?? entry?.[xKey] ?? entry?.name;
              if (v != null) handleItemClick({ column: xKey, value: v });
            }}
          >
            {data.map((row, i) => (
              <Cell
                key={i}
                fill={colorFor(i)}
                opacity={markOpacity(activeValue, row[xKey])}
              />
            ))}
          </Pie>
          <RechartsTooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={tooltipValueFormatter(valueFormat)}
          />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  const plotted =
    trend && seriesKeys[0] ? withTrend(data, seriesKeys[0], TREND_KEY) : data;
  const common = {
    data: plotted,
    margin: { top: 8, right: 8, bottom: 0, left: 0 },
  };
  const axes = (
    <>
      <CartesianGrid strokeDasharray="3 3" vertical={false} />
      <XAxis dataKey={xKey} tickLine={false} axisLine={false} minTickGap={24} />
      <YAxis
        tickLine={false}
        axisLine={false}
        width={axisWidth(valueFormat)}
        tickFormatter={axisTickFormatter(valueFormat)}
      />
      <RechartsTooltip
        contentStyle={TOOLTIP_STYLE}
        cursor={{ opacity: 0.2 }}
        formatter={tooltipValueFormatter(valueFormat)}
      />
    </>
  );
  const brush = showBrush ? (
    <Brush
      dataKey={xKey}
      height={18}
      travellerWidth={8}
      onChange={handleBrush}
    />
  ) : null;
  const trendLine = trend ? (
    <Line
      key={TREND_KEY}
      dataKey={TREND_KEY}
      stroke="var(--muted-foreground)"
      strokeDasharray="6 4"
      strokeWidth={1.5}
      dot={false}
      activeDot={false}
      legendType="none"
      tooltipType="none"
      isAnimationActive={false}
    />
  ) : null;

  // Single ComposedChart for line/area/bar so the dashed trendline (a Line)
  // renders in every cartesian chart type. Cross-filter uses the CHART-level
  // onClick (activeLabel): recharts 3 re-renders hovered bars into
  // active/inactive overlay layers that swallow per-<Bar> onClick.
  const cartesianClick = (
    state: { activeLabel?: unknown },
    e?: { target?: EventTarget | null },
  ) => {
    const t = e?.target as HTMLElement | null | undefined;
    if (t && typeof t.closest === "function" && t.closest(".recharts-brush")) {
      return; // brush drags must not emit cross-filters
    }
    if (state?.activeLabel != null) {
      handleItemClick({ column: xKey, value: state.activeLabel });
    }
  };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart
        {...common}
        onClick={cartesianClick}
        className="cursor-pointer"
      >
        {axes}
        {annotationLines}
        {referenceLineEl}
        {legendEl}
        {spec.chartType === "line"
          ? seriesKeys.map((k, i) => (
              <Line
                key={k}
                type="monotone"
                dataKey={k}
                stroke={colorFor(i)}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3 }}
                hide={hidden.has(k)}
              />
            ))
          : spec.chartType === "area"
            ? seriesKeys.map((k, i) => (
                <Area
                  key={k}
                  type="monotone"
                  dataKey={k}
                  stackId={spec.stacked ? "stack" : undefined}
                  stroke={colorFor(i)}
                  fill={colorFor(i)}
                  fillOpacity={0.18}
                  strokeWidth={2}
                  hide={hidden.has(k)}
                />
              ))
            : seriesKeys.map((k, i) => (
                <Bar
                  key={k}
                  dataKey={k}
                  stackId={spec.stacked ? "stack" : undefined}
                  fill={colorFor(i)}
                  radius={spec.stacked ? [0, 0, 0, 0] : [3, 3, 0, 0]}
                  maxBarSize={40}
                  hide={hidden.has(k)}
                >
                  {plotted.map((row, j) => {
                    const raw = row[k];
                    const ruleColor =
                      i === 0 && rules && typeof raw === "number"
                        ? resolveRuleColor(raw, rules)
                        : null;
                    return (
                      <Cell
                        key={j}
                        fill={ruleColor ?? colorFor(i)}
                        opacity={markOpacity(activeValue, row[xKey])}
                      />
                    );
                  })}
                </Bar>
              ))}
        {trendLine}
        {brush}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
