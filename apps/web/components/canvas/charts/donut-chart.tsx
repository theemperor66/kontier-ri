"use client";

import { useMemo } from "react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";
import { formatValue } from "@/lib/format";
import {
  markOpacity,
  tooltipValueFormatter,
  TOOLTIP_STYLE,
  type BaseChartProps,
} from "./common";

/** Donut with a centered total; slices emit cross-filter clicks. */
export function DonutChartView({
  data,
  xKey,
  seriesKeys,
  colorFor,
  valueFormat,
  onItemClick,
  activeValue,
}: BaseChartProps) {
  const valueKey = seriesKeys[0];
  const total = useMemo(() => {
    if (!valueKey) return null;
    let sum = 0;
    for (const row of data) {
      const v = row[valueKey];
      if (typeof v === "number" && Number.isFinite(v)) sum += v;
    }
    return sum;
  }, [data, valueKey]);
  if (!valueKey) return null;

  return (
    <div className="relative h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <Pie
            data={data}
            dataKey={valueKey}
            nameKey={xKey}
            innerRadius="68%"
            outerRadius="88%"
            paddingAngle={2}
            stroke="var(--card)"
            className={onItemClick ? "cursor-pointer" : undefined}
            onClick={(item: unknown) => {
              // recharts 3 spreads the datum into the item; payload is not
              // always present (Pie sectors, Scatter points).
              const entry = item as
                | ({ payload?: Record<string, unknown>; name?: unknown } & Record<string, unknown>)
                | undefined;
              const v = entry?.payload?.[xKey] ?? entry?.[xKey] ?? entry?.name;
              if (v != null) onItemClick?.({ column: xKey, value: v });
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
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-semibold tabular-nums leading-tight">
          {total != null ? formatValue(total, valueFormat ?? "compact") : "—"}
        </span>
        <span className="text-[10px] text-muted-foreground">total</span>
      </div>
    </div>
  );
}
