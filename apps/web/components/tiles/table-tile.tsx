"use client";

import { useEffect, useMemo, useState } from "react";
import { CaretDown, CaretLeft, CaretRight, CaretUp } from "@phosphor-icons/react";
import type { TableSpec, Tile } from "@/lib/dashboard-store";
import { useTileData } from "@/lib/use-tile-data";
import type { SortSpec } from "@/lib/sql";
import { formatValue, humanizeIdent, resolveRuleColor } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { useCrossFilterEmit } from "@/components/canvas/charts/common";
import {
  MarkMenu,
  type MarkMenuTarget,
} from "@/components/canvas/charts/mark-menu";
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

/** Client-side comparator for the page-sort fallback. */
function compareCells(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // nulls last
  if (b == null) return -1;
  const na = toNum(a);
  const nb = toNum(b);
  if (na != null && nb != null) return na - nb;
  return String(a).localeCompare(String(b));
}

export function TableTile({ tile }: { tile: Tile }) {
  const spec = tile.spec as TableSpec;
  // Sort is SESSION view state (like chart legend toggles): header clicks
  // re-order what you see without mutating the doc.
  const [sort, setSort] = useState<SortSpec | null>(null);
  const { loading, error, result, serverSorted } = useTileData(tile, sort);
  const pageSize = Math.min(spec.pageSize ?? 10, 25);
  const [page, setPage] = useState(0);
  const { crossFilter, emit } = useCrossFilterEmit(tile.id);
  const [markTarget, setMarkTarget] = useState<MarkMenuTarget | null>(null);

  useEffect(() => {
    setPage(0);
  }, [result]);

  const pageSorted = sort != null && serverSorted === false;
  const rows = useMemo(() => {
    if (!result) return [];
    const maxPage = Math.max(0, Math.ceil(result.rows.length / pageSize) - 1);
    const start = Math.min(Math.max(0, page), maxPage) * pageSize;
    const current = result.rows.slice(start, start + pageSize);
    if (!pageSorted || !sort) return current;
    // Server sort unavailable: sort just this page, flagged below.
    const ci = result.columns.findIndex((c) => c.name === sort.column);
    if (ci < 0) return current;
    const dir = sort.dir === "desc" ? -1 : 1;
    return [...current].sort((a, b) => dir * compareCells(a[ci], b[ci]));
  }, [result, page, pageSize, pageSorted, sort]);

  const markValues = useMemo(() => {
    if (!result || !markTarget) return [];
    const ci = result.columns.findIndex((c) => c.name === markTarget.column);
    if (ci < 0) return [];
    return result.rows.map((r) => r[ci]);
  }, [result, markTarget]);

  if (error) return <TileError message={error} />;
  if (loading || !result) return <TileShimmer kind="table" />;

  const pages = Math.max(1, Math.ceil(result.rows.length / pageSize));
  const current = Math.min(page, pages - 1);
  const valueFormat = spec.format?.value;
  const rules = spec.format?.rules;

  const cycleSort = (column: string) => {
    setSort((prev) => {
      if (prev?.column !== column) return { column, dir: "asc" };
      if (prev.dir === "asc") return { column, dir: "desc" };
      return null;
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b text-left text-muted-foreground">
              {result.columns.map((c) => {
                const active = sort?.column === c.name;
                return (
                  <th
                    key={c.name}
                    aria-sort={
                      active
                        ? sort!.dir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                    className="whitespace-nowrap py-0 pr-1 font-medium"
                  >
                    <button
                      type="button"
                      title={`Sort by ${c.name}`}
                      className={`group/sort flex items-center gap-0.5 py-1.5 pr-2 transition-colors hover:text-foreground ${
                        active ? "text-foreground" : ""
                      }`}
                      onClick={() => cycleSort(c.name)}
                    >
                      {humanizeIdent(c.name)}
                      {active ? (
                        sort!.dir === "asc" ? (
                          <CaretUp weight="bold" className="size-2.5 shrink-0" />
                        ) : (
                          <CaretDown weight="bold" className="size-2.5 shrink-0" />
                        )
                      ) : (
                        <CaretUp
                          weight="bold"
                          className="size-2.5 shrink-0 opacity-0 transition-opacity group-hover/sort:opacity-40"
                        />
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={i}
                className="border-b border-border/50 transition-colors last:border-0 hover:bg-accent/40"
              >
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
                      onContextMenu={(e) => {
                        if (v == null) return;
                        e.preventDefault();
                        e.stopPropagation();
                        setMarkTarget({
                          column: col,
                          value: v,
                          x: e.clientX,
                          y: e.clientY,
                        });
                      }}
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
      {pages > 1 || pageSorted ? (
        <div className="flex items-center justify-between border-t pt-1.5 text-[11px] text-muted-foreground">
          <span>
            {result.rows.length} rows{result.truncated ? " (capped)" : ""}
            {pageSorted ? (
              <span
                className="ml-1.5 text-[10px] italic opacity-80"
                title="This query could not be re-ordered — only the visible page is sorted."
              >
                page sorted
              </span>
            ) : null}
          </span>
          {pages > 1 ? (
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
          ) : null}
        </div>
      ) : null}
      {markTarget ? (
        <MarkMenu
          tile={tile}
          target={markTarget}
          values={markValues}
          onClose={() => setMarkTarget(null)}
          onCrossFilter={emit}
        />
      ) : null}
    </div>
  );
}
