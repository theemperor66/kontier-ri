"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  axisTickFormatter,
  markOpacity,
  tooltipValueFormatter,
  TOOLTIP_STYLE,
  TREND_KEY,
  type BaseChartProps,
} from "./common";
import { linearRegression } from "./regression";

interface ScatterViewProps extends BaseChartProps {
  /** Dashed least-squares trendline over the first series. */
  trend?: boolean;
  children?: React.ReactNode;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string" && v !== "" && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return null;
}

/** Scatter plot (ComposedChart so a dashed trendline can overlay). */
export function ScatterChartView({
  data,
  xKey,
  seriesKeys,
  colorFor,
  valueFormat,
  onItemClick,
  activeValue,
  hiddenKeys,
  trend,
  children,
}: ScatterViewProps) {
  const numericX = data.length > 0 && data.every((r) => num(r[xKey]) != null);

  const plotted = useMemo(() => {
    if (!trend || seriesKeys.length === 0) return data;
    const yKey = seriesKeys[0]!;
    const pts: Array<readonly [number, number]> = [];
    data.forEach((r, i) => {
      const x = numericX ? num(r[xKey]) : i;
      const y = num(r[yKey]);
      if (x != null && y != null) pts.push([x, y] as const);
    });
    const fit = linearRegression(pts);
    if (!fit) return data;
    return data.map((r, i) => {
      const x = numericX ? num(r[xKey]) : i;
      return x == null
        ? r
        : { ...r, [TREND_KEY]: fit.intercept + fit.slope * x };
    });
  }, [data, trend, seriesKeys, xKey, numericX]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart
        data={plotted}
        margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey={xKey}
          type={numericX ? "number" : "category"}
          domain={numericX ? ["auto", "auto"] : undefined}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={44}
          tickFormatter={axisTickFormatter(valueFormat)}
        />
        <RechartsTooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={tooltipValueFormatter(valueFormat)}
          cursor={{ strokeDasharray: "3 3" }}
        />
        {seriesKeys.map((k, i) => (
          <Scatter
            key={k}
            name={k}
            dataKey={k}
            fill={colorFor(i)}
            hide={hiddenKeys?.has(k)}
            className={onItemClick ? "cursor-pointer" : undefined}
            onClick={(entry: { payload?: Record<string, unknown> }) => {
              const v = entry?.payload?.[xKey];
              if (v != null) onItemClick?.({ column: xKey, value: v });
            }}
            shape={(props: unknown) => {
              const p = props as {
                cx?: number;
                cy?: number;
                payload?: Record<string, unknown>;
              };
              if (p.cx == null || p.cy == null) return <g />;
              return (
                <circle
                  cx={p.cx}
                  cy={p.cy}
                  r={4}
                  fill={colorFor(i)}
                  opacity={markOpacity(activeValue, p.payload?.[xKey])}
                />
              );
            }}
          />
        ))}
        {trend ? (
          <Line
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
        {children}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
