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
import {
  AXIS_TICK,
  axisTickFormatter,
  chartContextMenu,
  GRID_INK,
  type BaseChartProps,
} from "./common";
import { chartTooltip } from "./chart-tooltip";

/** Radar / spider chart over the xKey categories. */
export function RadarChartView({
  data,
  xKey,
  seriesKeys,
  colorFor,
  valueFormat,
  hiddenKeys,
  onItemContextMenu,
  children,
}: BaseChartProps & { children?: React.ReactNode }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <RadarChart
        data={data}
        margin={{ top: 8, right: 16, bottom: 4, left: 16 }}
        onContextMenu={chartContextMenu(xKey, onItemContextMenu)}
      >
        <PolarGrid stroke={GRID_INK} />
        <PolarAngleAxis dataKey={xKey} tick={AXIS_TICK} />
        <PolarRadiusAxis
          tick={{ fontSize: 10, fill: "var(--faint)" }}
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
