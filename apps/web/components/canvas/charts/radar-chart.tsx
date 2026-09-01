"use client";

import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";
import { axisTickFormatter, type BaseChartProps } from "./common";
import { chartTooltip } from "./chart-tooltip";

/** Radar / spider chart over the xKey categories. */
export function RadarChartView({
  data,
  xKey,
  seriesKeys,
  colorFor,
  valueFormat,
  hiddenKeys,
  children,
}: BaseChartProps & { children?: React.ReactNode }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <RadarChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 16 }}>
        <PolarGrid stroke="var(--border)" />
        <PolarAngleAxis
          dataKey={xKey}
          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
        />
        <PolarRadiusAxis
          tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
          tickFormatter={axisTickFormatter(valueFormat)}
          axisLine={false}
        />
        <RechartsTooltip
          content={chartTooltip({ formatFor: () => valueFormat })}
        />
        {seriesKeys.map((k, i) => (
          <Radar
            key={k}
            name={k}
            dataKey={k}
            stroke={colorFor(i)}
            fill={colorFor(i)}
            fillOpacity={0.15}
            strokeWidth={2}
            hide={hiddenKeys?.has(k)}
          />
        ))}
        {children}
      </RadarChart>
    </ResponsiveContainer>
  );
}
