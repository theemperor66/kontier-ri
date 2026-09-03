"use client";

import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FormatOptions, ValueFormat } from "@/lib/format";
import { prettifySeriesLabel } from "@/lib/format";
import {
  AXIS_TICK,
  axisTickFormatter,
  axisWidth,
  chartContextMenu,
  GRID_INK,
  markOpacity,
  type BaseChartProps,
} from "./common";
import { chartTooltip } from "./chart-tooltip";

export interface ComboSeriesConfig {
  key: string;
  type?: "bar" | "line";
  axis?: "left" | "right";
}

interface ComboViewProps extends BaseChartProps {
  /** Per-series config; defaults: first key bar/left, rest line/left. */
  series?: ComboSeriesConfig[];
  /** Number format for the right axis (spec.format.y2). */
  y2Format?: ValueFormat | FormatOptions;
  children?: React.ReactNode;
}

/** Combo chart: bars + lines, optional right axis. */
export function ComboChartView({
  data,
  xKey,
  seriesKeys,
  colorFor,
  valueFormat,
  y2Format,
  onItemClick,
  onItemContextMenu,
  activeValue,
  hiddenKeys,
  series,
  children,
}: ComboViewProps) {
  const configs: ComboSeriesConfig[] = seriesKeys.map((key, i) => {
    const explicit = series?.find((s) => s.key === key);
    return {
      key,
      type: explicit?.type ?? (i === 0 ? "bar" : "line"),
      axis: explicit?.axis ?? "left",
    };
  });
  const hasRight = configs.some((c) => c.axis === "right");
  const rightKey = configs.find((c) => c.axis === "right")?.key;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart
        data={data}
        barCategoryGap="12%"
        margin={{ top: 8, right: hasRight ? 0 : 8, bottom: 0, left: 0 }}
        onClick={(state: { activeLabel?: unknown }) => {
          if (state?.activeLabel != null) {
            onItemClick?.({ column: xKey, value: state.activeLabel });
          }
        }}
        onContextMenu={chartContextMenu(xKey, onItemContextMenu)}
        className={onItemClick ? "cursor-crosshair" : undefined}
      >
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID_INK} />
        <XAxis
          dataKey={xKey}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
          tick={AXIS_TICK}
          stroke={GRID_INK}
        />
        <YAxis
          yAxisId="left"
          tickLine={false}
          axisLine={false}
          width={axisWidth(valueFormat)}
          tickFormatter={axisTickFormatter(valueFormat)}
          tick={AXIS_TICK}
          stroke={GRID_INK}
        />
        {hasRight ? (
          <YAxis
            yAxisId="right"
            orientation="right"
            tickLine={false}
            axisLine={false}
            width={axisWidth(y2Format ?? valueFormat) + 14}
            tickFormatter={axisTickFormatter(y2Format ?? valueFormat)}
            tick={AXIS_TICK}
            stroke={GRID_INK}
            label={
              rightKey
                ? {
                    value: prettifySeriesLabel(rightKey),
                    angle: 90,
                    position: "insideRight",
                    fill: "var(--muted-foreground)",
                    fontSize: 10,
                    offset: 0,
                  }
                : undefined
            }
          />
        ) : null}
        <RechartsTooltip
          content={chartTooltip({
            formatFor: (key) => {
              const cfg = configs.find((c) => c.key === key);
              return cfg?.axis === "right"
                ? (y2Format ?? valueFormat)
                : valueFormat;
            },
          })}
          cursor={{ opacity: 0.2 }}
        />
        {configs.map((cfg, i) =>
          cfg.type === "line" ? (
            <Line
              key={cfg.key}
              yAxisId={cfg.axis}
              type="monotone"
              dataKey={cfg.key}
              stroke={colorFor(i)}
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 3 }}
              hide={hiddenKeys?.has(cfg.key)}
            />
          ) : (
            <Bar
              key={cfg.key}
              yAxisId={cfg.axis}
              dataKey={cfg.key}
              fill={colorFor(i)}
              fillOpacity={0.85}
              radius={[3, 3, 0, 0]}
              maxBarSize={28}
              hide={hiddenKeys?.has(cfg.key)}
            >
              {data.map((row, j) => (
                <Cell
                  key={j}
                  opacity={markOpacity(activeValue, row[xKey])}
                />
              ))}
            </Bar>
          ),
        )}
        {children}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
