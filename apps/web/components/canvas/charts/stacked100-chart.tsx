"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { markOpacity, type BaseChartProps } from "./common";
import { chartTooltip } from "./chart-tooltip";

/** 100%-stacked bars: each x bucket normalized to fractions of its total. */
export function Stacked100ChartView({
  data,
  xKey,
  seriesKeys,
  colorFor,
  onItemClick,
  activeValue,
  hiddenKeys,
  children,
}: BaseChartProps & { children?: React.ReactNode }) {
  const normalized = useMemo(() => {
    return data.map((row) => {
      let total = 0;
      for (const k of seriesKeys) {
        const v = row[k];
        if (typeof v === "number" && Number.isFinite(v) && v > 0) total += v;
      }
      const out: Record<string, unknown> = { ...row };
      for (const k of seriesKeys) {
        const v = row[k];
        out[k] =
          total > 0 && typeof v === "number" && Number.isFinite(v) && v > 0
            ? v / total
            : 0;
      }
      return out;
    });
  }, [data, seriesKeys]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={normalized}
        margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        stackOffset="expand"
        onClick={(state: { activeLabel?: unknown }) => {
          if (state?.activeLabel != null) {
            onItemClick?.({ column: xKey, value: state.activeLabel });
          }
        }}
        className={onItemClick ? "cursor-pointer" : undefined}
      >
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={xKey} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={48}
          domain={[0, 1]}
          ticks={[0, 0.25, 0.5, 0.75, 1]}
          tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
        />
        <RechartsTooltip
          content={chartTooltip({ formatFor: () => "percent" })}
          cursor={{ opacity: 0.2 }}
        />
        {seriesKeys.map((k, i) => (
          <Bar
            key={k}
            dataKey={k}
            stackId="stack"
            fill={colorFor(i)}
            maxBarSize={40}
            hide={hiddenKeys?.has(k)}
          >
            {normalized.map((row, j) => (
              <Cell key={j} opacity={markOpacity(activeValue, row[xKey])} />
            ))}
          </Bar>
        ))}
        {children}
      </BarChart>
    </ResponsiveContainer>
  );
}
