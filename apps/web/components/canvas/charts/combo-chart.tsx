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
import {
  axisTickFormatter,
  markOpacity,
  tooltipValueFormatter,
  TOOLTIP_STYLE,
  type BaseChartProps,
} from "./common";

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

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart
        data={data}
        margin={{ top: 8, right: hasRight ? 0 : 8, bottom: 0, left: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={xKey} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis
          yAxisId="left"
          tickLine={false}
          axisLine={false}
          width={44}
          tickFormatter={axisTickFormatter(valueFormat)}
        />
        {hasRight ? (
          <YAxis
            yAxisId="right"
            orientation="right"
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={axisTickFormatter(y2Format ?? valueFormat)}
          />
        ) : null}
        <RechartsTooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={{ opacity: 0.2 }}
          formatter={(v: unknown, name: unknown) => {
            const cfg = configs.find((c) => c.key === name);
            const fmt =
              cfg?.axis === "right" ? (y2Format ?? valueFormat) : valueFormat;
            return tooltipValueFormatter(fmt)(v);
          }}
        />
        {configs.map((cfg, i) =>
          cfg.type === "line" ? (
            <Line
              key={cfg.key}
              yAxisId={cfg.axis}
              type="monotone"
              dataKey={cfg.key}
              stroke={colorFor(i)}
              strokeWidth={2}
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
              radius={[3, 3, 0, 0]}
              maxBarSize={40}
              hide={hiddenKeys?.has(cfg.key)}
              className={onItemClick ? "cursor-pointer" : undefined}
              onClick={(entry: { payload?: Record<string, unknown> }) => {
                const v = entry?.payload?.[xKey];
                if (v != null) onItemClick?.({ column: xKey, value: v });
              }}
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
