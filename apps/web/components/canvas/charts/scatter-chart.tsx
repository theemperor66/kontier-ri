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
  axisWidth,
  chartContextMenu,
  markOpacity,
  sectorContextMenu,
  TREND_KEY,
  type BaseChartProps,
} from "./common";
import { chartTooltip } from "./chart-tooltip";
import { linearRegression } from "./regression";
import { humanizeIdent } from "@/lib/format";

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
  onItemContextMenu,
  activeValue,
  hiddenKeys,
  trend,
  children,
}: ScatterViewProps) {
  const numericX = data.length > 0 && data.every((r) => num(r[xKey]) != null);
  // L7: y starts at 0 unless the data actually goes negative — a scatter
  // floating over a -€8K phantom range reads as noise.
  const hasNegative = data.some((r) =>
    seriesKeys.some((k) => {
      const v = num(r[k]);
      return v != null && v < 0;
    }),
  );

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
    // L7: the trend guide must not drag the y domain below the data —
    // with all-positive data the fitted line is clipped at 0 instead of
    // opening a phantom negative range (recharts expands past a [0, auto]
    // domain for out-of-range data).
    const floor = pts.some(([, y]) => y < 0) ? -Infinity : 0;
    return data.map((r, i) => {
      const x = numericX ? num(r[xKey]) : i;
      if (x == null) return r;
      const t = fit.intercept + fit.slope * x;
      return t < floor ? r : { ...r, [TREND_KEY]: t };
    });
  }, [data, trend, seriesKeys, xKey, numericX]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart
        data={plotted}
        margin={{ top: 8, right: 8, bottom: 14, left: 0 }}
        onClick={(state: { activeLabel?: unknown }) => {
          if (state?.activeLabel != null) {
            onItemClick?.({ column: xKey, value: state.activeLabel });
          }
        }}
        onContextMenu={chartContextMenu(xKey, onItemContextMenu)}
        className={onItemClick ? "cursor-crosshair" : undefined}
      >
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey={xKey}
          type={numericX ? "number" : "category"}
          domain={numericX ? ["auto", "auto"] : undefined}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
          tickFormatter={numericX ? axisTickFormatter("number") : undefined}
          label={{
            value: humanizeIdent(xKey),
            position: "insideBottom",
            offset: -10,
            fill: "var(--muted-foreground)",
            fontSize: 10,
          }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          domain={[hasNegative ? "auto" : 0, "auto"]}
          width={axisWidth(valueFormat) + 14}
          tickFormatter={axisTickFormatter(valueFormat)}
          label={
            seriesKeys.length === 1
              ? {
                  value: humanizeIdent(seriesKeys[0]!),
                  angle: -90,
                  position: "insideLeft",
                  offset: 0,
                  fill: "var(--muted-foreground)",
                  fontSize: 10,
                }
              : undefined
          }
        />
        <RechartsTooltip
          content={chartTooltip({
            formatFor: (key) => (key === xKey ? "number" : valueFormat),
          })}
          cursor={{ strokeDasharray: "3 3" }}
        />
        {seriesKeys.map((k, i) => (
          <Scatter
            key={k}
            name={k}
            dataKey={k}
            fill={colorFor(i)}
            hide={hiddenKeys?.has(k)}
            className={onItemClick ? "cursor-crosshair" : undefined}
            onContextMenu={sectorContextMenu(xKey, onItemContextMenu) as never}
            onClick={(item: unknown) => {
              // recharts 3 spreads the datum into the item; payload is not
              // always present (Pie sectors, Scatter points).
              const entry = item as
                | ({ payload?: Record<string, unknown>; name?: unknown } & Record<string, unknown>)
                | undefined;
              const v = entry?.payload?.[xKey] ?? entry?.[xKey] ?? entry?.name;
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
                  stroke="var(--card)"
                  strokeWidth={1}
                  opacity={0.75 * markOpacity(activeValue, p.payload?.[xKey])}
                />
              );
            }}
          />
        ))}
        {trend ? (
          <Line
            dataKey={TREND_KEY}
            stroke="color-mix(in oklab, var(--foreground) 55%, transparent)"
            strokeDasharray="6 4"
            strokeWidth={1.75}
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
