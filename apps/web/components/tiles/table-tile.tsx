"use client";

import { useEffect, useState } from "react";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import type { TableSpec, Tile } from "@/lib/dashboard-store";
import { useTileData } from "@/lib/use-tile-data";
import { formatValue, resolveRuleColor } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { useCrossFilterEmit } from "@/components/canvas/charts/common";
import { TileError } from "./tile-error";
import { TileShimmer } from "./tile-shimmer";

function cellText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") {
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  }
  const s = String(v);
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
}

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "bigint") return Number(v);
  return null;
}

export function TableTile({ tile }: { tile: Tile }) {
  const spec = tile.spec as TableSpec;
  const { loading, error, result } = useTileData(tile);
  const pageSize = Math.min(spec.pageSize ?? 10, 25);
  const [page, setPage] = useState(0);
  const { crossFilter, emit } = useCrossFilterEmit(tile.id);

  useEffect(() => {
    setPage(0);
  }, [result]);

  if (error) return <TileError message={error} />;
  if (loading || !result) return <TileShimmer kind="table" />;

  const pages = Math.max(1, Math.ceil(result.rows.length / pageSize));
  const current = Math.min(page, pages - 1);
  const rows = result.rows.slice(current * pageSize, (current + 1) * pageSize);
  const valueFormat = spec.format?.value;
  const rules = spec.format?.rules;

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b text-left text-muted-foreground">
              {result.columns.map((c) => (
                <th key={c.name} className="whitespace-nowrap py-1.5 pr-3 font-medium">
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-border/50 last:border-0">
                {r.map((v, j) => {
                  const col = result.columns[j]?.name ?? String(j);
                  const n = toNum(v);
                  const ruleColor = n != null ? resolveRuleColor(n, rules) : null;
                  const active =
                    crossFilter != null &&
                    crossFilter.column === col &&
                    String(crossFilter.value) === String(v);
                  const text =
                    n != null && valueFormat != null
                      ? formatValue(n, valueFormat)
                      : cellText(v);
                  return (
                    <td
                      key={j}
                      className={
                        "whitespace-nowrap py-1.5 pr-3 tabular-nums text-foreground/90" +
                        (v != null
                          ? " cursor-pointer hover:bg-accent/60"
                          : "") +
                        (active ? " ring-1 ring-inset ring-ring/70" : "")
                      }
                      style={
                        ruleColor
                          ? {
                              backgroundColor: `color-mix(in oklab, ${ruleColor} 18%, transparent)`,
                            }
                          : undefined
                      }
                      onClick={() =>
                        v != null && emit({ column: col, value: v })
                      }
                      title={
                        v != null ? `Filter dashboard by ${col}` : undefined
                      }
                    >
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 ? (
        <div className="flex items-center justify-between border-t pt-1.5 text-[11px] text-muted-foreground">
          <span>
            {result.rows.length} rows{result.truncated ? " (capped)" : ""}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
              aria-label="Previous page"
            >
              <CaretLeft className="size-3.5" />
            </Button>
            <span className="tabular-nums">
              {current + 1}/{pages}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={current >= pages - 1}
              onClick={() => setPage(current + 1)}
              aria-label="Next page"
            >
              <CaretRight className="size-3.5" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
