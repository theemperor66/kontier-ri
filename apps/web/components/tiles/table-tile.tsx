"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

/**
 * Design: status-like values render as soft pills (High -> danger,
 * Medium/Watch -> warn, the healthy end -> ok). Only KNOWN status words
 * are pilled — an account name never turns into a badge.
 */
const STATUS_TONE: Record<string, string> = {
  high: "bg-danger-soft text-danger",
  critical: "bg-danger-soft text-danger",
  severe: "bg-danger-soft text-danger",
  failed: "bg-danger-soft text-danger",
  churned: "bg-danger-soft text-danger",
  medium: "bg-warn-soft text-warn",
  watch: "bg-warn-soft text-warn",
  warning: "bg-warn-soft text-warn",
  pending: "bg-warn-soft text-warn",
  "at risk": "bg-warn-soft text-warn",
  low: "bg-ok-soft text-ok",
  ok: "bg-ok-soft text-ok",
  good: "bg-ok-soft text-ok",
  healthy: "bg-ok-soft text-ok",
  active: "bg-ok-soft text-ok",
  succeeded: "bg-ok-soft text-ok",
  success: "bg-ok-soft text-ok",
  paid: "bg-ok-soft text-ok",
};

function statusTone(v: unknown): string | null {
  if (typeof v !== "string") return null;
  return STATUS_TONE[v.trim().toLowerCase()] ?? null;
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

  // Does the table reach past its tile? Measured, so the edge affordance
  // only appears when there is something to scroll to.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () =>
      setOverflows(element.scrollWidth - element.clientWidth > 4);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
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

  // L8: numeric columns right-align; when a `currency` column neighbors a
  // money-ish numeric column, that column renders as real currency.
  const numericCols = result.columns.map((c, idx) => {
    const t = c.type.toLowerCase();
    if (
      t.includes("int") ||
      t.includes("float") ||
      t.includes("double") ||
      t.includes("decimal")
    ) {
      return true;
    }
    return result.rows.some(
      (r) => typeof r[idx] === "number" || typeof r[idx] === "bigint",
    );
  });
  const currencyIdx = result.columns.findIndex(
    (c) => c.name.toLowerCase() === "currency",
  );
  const moneyCol = (idx: number): boolean =>
    currencyIdx >= 0 &&
    numericCols[idx] === true &&
    /amount|price|total|revenue|value/i.test(result.columns[idx]?.name ?? "");

  const cycleSort = (column: string) => {
    setSort((prev) => {
      if (prev?.column !== column) return { column, dir: "asc" };
      if (prev.dir === "asc") return { column, dir: "desc" };
      return null;
    });
  };

  return (
    <div className="flex h-full flex-col">
      {/* A wide table scrolls sideways inside the tile. Overlay scrollbars
          hide at rest, so the right edge dims while there is more to reach —
          measured, never decorative. */}
      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} className="h-full overflow-auto">
        {/* min-w-max keeps every column at its natural width: a wide table
            scrolls inside the tile instead of clipping its last column. */}
        <table className="w-full min-w-max text-[13px]">
          <thead className="sticky top-0 z-[1] bg-card">
            <tr className="border-b border-line text-left text-[12px] text-faint">
              {result.columns.map((c, ci) => {
                const active = sort?.column === c.name;
                const numeric = numericCols[ci] === true;
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
                    className="whitespace-nowrap px-2 py-0 font-normal first:pl-4 last:pr-4"
                  >
                    <button
                      type="button"
                      title={`Sort by ${c.name}`}
                      className={`group/sort flex w-full items-center gap-0.5 pb-1.5 pt-1 transition-colors hover:text-foreground ${
                        numeric ? "justify-end text-right" : ""
                      } ${active ? "text-foreground" : ""}`}
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
                className="border-b border-line transition-colors last:border-0 hover:bg-surface-2"
              >
                {r.map((v, j) => {
                  const col = result.columns[j]?.name ?? String(j);
                  const n = toNum(v);
                  const ruleColor = n != null ? resolveRuleColor(n, rules) : null;
                  const active =
                    crossFilter != null &&
                    crossFilter.column === col &&
                    String(crossFilter.value) === String(v);
                  const rowCurrency =
                    moneyCol(j) && n != null ? String(r[currencyIdx] ?? "") : "";
                  const text =
                    n != null && /^[A-Za-z]{3}$/.test(rowCurrency)
                      ? formatValue(n, {
                          style: "currency",
                          currency: rowCurrency.toUpperCase(),
                        })
                      : n != null && valueFormat != null
                        ? formatValue(n, valueFormat)
                        : cellText(v);
                  const pill = statusTone(v);
                  return (
                    <td
                      key={j}
                      className={
                        "whitespace-nowrap px-2 py-[7px] tabular-nums first:pl-4 last:pr-4 " +
                        (j === 0
                          ? "font-medium text-foreground"
                          : "text-foreground/90") +
                        (numericCols[j] === true ? " text-right" : "") +
                        (v != null ? " cursor-pointer" : "") +
                        (active ? " ring-1 ring-inset ring-accent-mid" : "")
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
                      {pill ? (
                        <span
                          className={`inline-flex rounded-full px-2 py-[2px] text-[11.5px] font-medium ${pill}`}
                        >
                          {text}
                        </span>
                      ) : (
                        text
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {overflows ? (
          <div
            aria-hidden
            data-testid="table-scroll-affordance"
            className="pointer-events-none absolute inset-y-0 right-0 z-[2] w-8 bg-gradient-to-l from-card via-card/80 to-transparent"
          />
        ) : null}
      </div>
      {pages > 1 || pageSorted ? (
        <div className="flex items-center justify-between border-t border-line px-4 pt-1.5 text-[12px] text-faint">
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
