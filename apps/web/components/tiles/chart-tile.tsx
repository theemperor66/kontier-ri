"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Brush,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
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
import { formatCompact } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { TileError } from "./tile-error";

const PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

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
  const brushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          (isNumericType(c.type) ||
            result.rows.some((r) => typeof r[cols.indexOf(c)] === "number")),
      )
      .map((c) => c.name);
    const series =
      spec.seriesKeys && spec.seriesKeys.length > 0
        ? spec.seriesKeys.filter((k) => cols.some((c) => c.name === k))
        : numeric;
    const rows = result.rows.map((r) => {
      const obj: Record<string, unknown> = {};
      cols.forEach((c, i) => {
        obj[c.name] = c.name === x ? r[i] : toPlottable(r[i]);
      });
      return obj;
    });
    return { data: rows, xKey: x, seriesKeys: series };
  }, [result, spec.xKey, spec.seriesKeys]);

  // Flush pending brush updates on unmount.
  useEffect(
    () => () => {
      if (brushTimer.current) clearTimeout(brushTimer.current);
    },
    [],
  );

  if (error) return <TileError message={error} />;
  if (loading || !result) return <Skeleton className="h-full w-full" />;
  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        No rows for the current filters.
      </div>
    );
  }

  const colorFor = (i: number) =>
    i === 0 && spec.color ? spec.color : PALETTE[i % PALETTE.length];

  const temporal =
    typeof data[0]?.[xKey] === "string" &&
    /^\d{4}-\d{2}/.test(String(data[0][xKey]));
  const showBrush = spec.chartType !== "pie" && temporal && data.length > 8;

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

  const tooltipStyle = {
    backgroundColor: "var(--popover)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    fontSize: 12,
    color: "var(--popover-foreground)",
  } as const;

  const annotations = (tile.annotations ?? []).filter((a) => a.anchor?.x != null);

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
          >
            {data.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
          <RechartsTooltip contentStyle={tooltipStyle} />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  const common = {
    data,
    margin: { top: 8, right: 8, bottom: 0, left: 0 },
  };
  const axes = (
    <>
      <CartesianGrid strokeDasharray="3 3" vertical={false} />
      <XAxis dataKey={xKey} tickLine={false} axisLine={false} minTickGap={24} />
      <YAxis
        tickLine={false}
        axisLine={false}
        width={44}
        tickFormatter={(v: number) => formatCompact(v)}
      />
      <RechartsTooltip contentStyle={tooltipStyle} cursor={{ opacity: 0.2 }} />
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
  const refLines = annotations.map((a, i) => (
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

  if (spec.chartType === "line") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart {...common}>
          {axes}
          {refLines}
          {seriesKeys.map((k, i) => (
            <Line
              key={k}
              type="monotone"
              dataKey={k}
              stroke={colorFor(i)}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
            />
          ))}
          {brush}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  if (spec.chartType === "area") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart {...common}>
          {axes}
          {refLines}
          {seriesKeys.map((k, i) => (
            <Area
              key={k}
              type="monotone"
              dataKey={k}
              stackId={spec.stacked ? "stack" : undefined}
              stroke={colorFor(i)}
              fill={colorFor(i)}
              fillOpacity={0.18}
              strokeWidth={2}
            />
          ))}
          {brush}
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart {...common}>
        {axes}
        {refLines}
        {seriesKeys.map((k, i) => (
          <Bar
            key={k}
            dataKey={k}
            stackId={spec.stacked ? "stack" : undefined}
            fill={colorFor(i)}
            radius={spec.stacked ? [0, 0, 0, 0] : [3, 3, 0, 0]}
            maxBarSize={40}
          />
        ))}
        {brush}
      </BarChart>
    </ResponsiveContainer>
  );
}
