"use client";

/**
 * Rich tooltip content for every canvas chart (A9): card surface, friendly
 * series labels, formatted values via the single formatValue path, and
 * % of total for part-to-whole charts (stacked bars, pie, donut).
 *
 * Used as <RechartsTooltip content={chartTooltip({...})} /> — recharts calls
 * it with the live payload; we render plain HTML (recharts positions it).
 */

import type { CSSProperties, ReactNode } from "react";
import {
  formatValue,
  prettifySeriesLabel,
  type FormatOptions,
  type ValueFormat,
} from "@/lib/format";
import { TREND_KEY } from "./common";

interface TooltipEntry {
  dataKey?: string | number | ((obj: unknown) => unknown);
  name?: string | number;
  value?: unknown;
  color?: string;
  hide?: boolean;
  type?: string;
}

interface TooltipRenderProps {
  active?: boolean;
  label?: string | number;
  payload?: ReadonlyArray<TooltipEntry>;
}

export interface ChartTooltipOptions {
  /** Number format for a series key (combo right axis differs per key). */
  formatFor?: (key: string) => ValueFormat | FormatOptions | undefined;
  /**
   * Friendly label for a row. Receives the series key and the payload name
   * (pie/donut carry the category there). Default: prettifySeriesLabel.
   */
  labelFor?: (key: string, name: string) => string;
  /** Show each row's share of the payload total (stacked / pie / donut). */
  share?: boolean;
  /** Whole-chart total for share (pie/donut hover only one slice). */
  total?: number;
  /** Header text override (pie/donut have no axis label). */
  labelText?: (props: TooltipRenderProps) => ReactNode;
}

const numeric = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function formatEntryValue(
  v: unknown,
  fmt: ValueFormat | FormatOptions | undefined,
): string {
  const n = numeric(v);
  if (n == null) return String(v ?? "—");
  return formatValue(n, fmt ?? "number");
}

/** Factory: returns a recharts Tooltip `content` renderer. */
export function chartTooltip(options: ChartTooltipOptions = {}) {
  const { formatFor, labelFor, share, labelText } = options;
  return function ChartTooltipContent(props: TooltipRenderProps) {
    const { active, label, payload } = props;
    if (!active || !payload || payload.length === 0) return null;
    const rows = payload.filter(
      (p) => p.dataKey !== TREND_KEY && !p.hide && p.type !== "none",
    );
    if (rows.length === 0) return null;
    const total =
      options.total ??
      (share
        ? rows.reduce((acc, p) => acc + (numeric(p.value) ?? 0), 0)
        : 0);
    const header = labelText ? labelText(props) : label;
    return (
      <div className="min-w-32 rounded-lg border border-border bg-popover/95 px-2.5 py-2 text-popover-foreground shadow-md backdrop-blur-sm">
        {header != null && header !== "" ? (
          <div className="mb-1 text-[11px] font-semibold leading-tight">
            {header}
          </div>
        ) : null}
        <div className="flex flex-col gap-0.5">
          {rows.map((p, i) => {
            const key = String(
              (typeof p.dataKey === "function" ? undefined : p.dataKey) ??
                p.name ??
                i,
            );
            const rawName = String(p.name ?? key);
            const name = labelFor
              ? labelFor(key, rawName)
              : prettifySeriesLabel(rawName);
            const fmt = formatFor?.(key);
            const n = numeric(p.value);
            const pct =
              share && total > 0 && n != null ? n / total : null;
            return (
              <div
                key={`${key}-${i}`}
                className="flex items-baseline justify-between gap-4"
              >
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 self-center rounded-[2px]"
                    style={
                      {
                        backgroundColor: p.color ?? "var(--muted-foreground)",
                      } as CSSProperties
                    }
                  />
                  <span className="truncate text-[11px] text-muted-foreground">
                    {name}
                  </span>
                </span>
                <span className="shrink-0 text-xs font-medium tabular-nums">
                  {formatEntryValue(p.value, fmt)}
                  {pct != null ? (
                    <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                      {formatValue(pct, "percent")}
                    </span>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };
}
