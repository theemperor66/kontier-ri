"use client";

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
import {
  axisTickFormatter,
  markOpacity,
  tooltipValueFormatter,
  TOOLTIP_STYLE,
  type BaseChartProps,
} from "./common";

interface HBarViewProps extends BaseChartProps {
  /** Conditional bar fill from spec.format.rules (first series only). */
  ruleColorFor?: (value: number) => string | null;
  stacked?: boolean;
  children?: React.ReactNode;
}

/** Horizontal bars — categories on the y axis, values on x. */
export function HBarChartView({
  data,
  xKey,
  seriesKeys,
  colorFor,
  valueFormat,
  onItemClick,
  activeValue,
  hiddenKeys,
  ruleColorFor,
  stacked,
  children,
}: HBarViewProps) {
  const labelWidth = Math.min(
    132,
    Math.max(56, 8 * Math.max(0, ...data.map((r) => String(r[xKey] ?? "").length)) + 12),
  );
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 12, bottom: 0, left: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          tickLine={false}
          axisLine={false}
          tickFormatter={axisTickFormatter(valueFormat)}
        />
        <YAxis
          type="category"
          dataKey={xKey}
          tickLine={false}
          axisLine={false}
          width={labelWidth}
          tick={{ fontSize: 11 }}
        />
        <RechartsTooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={{ opacity: 0.2 }}
          formatter={tooltipValueFormatter(valueFormat)}
        />
        {seriesKeys.map((k, i) => (
          <Bar
            key={k}
            dataKey={k}
            stackId={stacked ? "stack" : undefined}
            fill={colorFor(i)}
            radius={stacked ? [0, 0, 0, 0] : [0, 3, 3, 0]}
            maxBarSize={22}
            hide={hiddenKeys?.has(k)}
            className={onItemClick ? "cursor-pointer" : undefined}
            onClick={(entry: { payload?: Record<string, unknown> }) => {
              const v = entry?.payload?.[xKey];
              if (v != null) onItemClick?.({ column: xKey, value: v });
            }}
          >
            {data.map((row, j) => {
              const raw = row[k];
              const ruleColor =
                i === 0 && ruleColorFor && typeof raw === "number"
                  ? ruleColorFor(raw)
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
        {children}
      </BarChart>
    </ResponsiveContainer>
  );
}
