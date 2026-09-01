"use client";

/**
 * Inspector Filters section: tile-scoped filters (column / op / value rows)
 * + the per-tile cross-filter opt-out. Rows are drafted locally so invalid
 * values never reach the doc; valid drafts commit through setTileFilters
 * (origin "human", debounced) — replace-whole-array semantics, [] clears.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X } from "@phosphor-icons/react";
import type { FilterOp, TileFilter } from "@kontier-ri/studio";
import type { Tile } from "@/lib/dashboard-store";
import { useDashboardStore } from "@/lib/dashboard-store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDebounced } from "./commit";
import { controlCls, RowError, Section, ToggleField } from "./fields";
import { useColumns } from "./section-data";

const OP_OPTIONS: { value: FilterOp; label: string }[] = [
  { value: "eq", label: "=" },
  { value: "contains", label: "contains" },
  { value: "in", label: "in (list)" },
  { value: "between", label: "between" },
];

interface FilterDraft {
  column: string;
  op: FilterOp;
  /** Raw text: scalar, comma list (in) or two bounds (between: value/value2). */
  value: string;
  value2: string;
}

function coerceScalar(raw: string): string | number {
  const t = raw.trim();
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t;
}

function toDraft(f: TileFilter): FilterDraft {
  if (f.op === "between" && Array.isArray(f.value)) {
    return {
      column: f.column,
      op: f.op,
      value: String(f.value[0] ?? ""),
      value2: String(f.value[1] ?? ""),
    };
  }
  return {
    column: f.column,
    op: f.op,
    value: Array.isArray(f.value)
      ? f.value.map(String).join(", ")
      : String(f.value ?? ""),
    value2: "",
  };
}

function parseDraft(d: FilterDraft): { filter?: TileFilter; error?: string } {
  if (!d.column) return { error: "Pick a column." };
  if (d.op === "between") {
    if (d.value.trim() === "" || d.value2.trim() === "") {
      return { error: "Enter both bounds." };
    }
    return {
      filter: {
        column: d.column,
        op: d.op,
        value: [coerceScalar(d.value), coerceScalar(d.value2)],
      },
    };
  }
  if (d.value.trim() === "") return { error: "Enter a value." };
  if (d.op === "in") {
    const values = d.value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(coerceScalar);
    if (values.length === 0) return { error: "Enter at least one value." };
    return { filter: { column: d.column, op: d.op, value: values } };
  }
  return { filter: { column: d.column, op: d.op, value: coerceScalar(d.value) } };
}

export function FiltersSection({ tile }: { tile: Tile }) {
  const spec = tile.spec as { dataset: string; filters?: TileFilter[] };
  const columns = useColumns(spec.dataset);
  const external = useMemo(() => spec.filters ?? [], [spec.filters]);

  const [drafts, setDrafts] = useState<FilterDraft[]>(() =>
    external.map(toDraft),
  );
  const lastCommitted = useRef(JSON.stringify(external));
  useEffect(() => {
    const j = JSON.stringify(external);
    if (j !== lastCommitted.current) {
      lastCommitted.current = j;
      setDrafts(external.map(toDraft));
    }
  }, [external]);

  const parsed = drafts.map(parseDraft);

  const debounced = useDebounced((next: FilterDraft[]) => {
    const results = next.map(parseDraft);
    if (results.some((r) => !r.filter)) return; // apply only valid changes
    const filters = results.map((r) => r.filter!);
    lastCommitted.current = JSON.stringify(filters);
    useDashboardStore.getState().setTileFilters(tile.id, filters, {
      origin: "human",
      label:
        filters.length > 0
          ? `Set ${filters.length} filter${filters.length === 1 ? "" : "s"} on “${tile.title}”`
          : `Cleared “${tile.title}” filters`,
    });
  });

  const update = (next: FilterDraft[], immediate = false) => {
    setDrafts(next);
    debounced.call(next);
    if (immediate) debounced.flush();
  };

  return (
    <Section title="Filters" testId="inspector-filters">
      {drafts.map((d, i) => {
        const knownCol = columns.some((c) => c.name === d.column);
        return (
          <div key={`filter-${i}`} className="space-y-1">
            <div className="flex items-center gap-1">
              <select
                aria-label={`Filter ${i + 1} column`}
                data-testid={`inspector-filter-column-${i}`}
                value={d.column}
                onChange={(e) =>
                  update(
                    drafts.map((dd, j) =>
                      j === i ? { ...dd, column: e.target.value } : dd,
                    ),
                    true,
                  )
                }
                className={cn(
                  controlCls(!knownCol && d.column !== ""),
                  "flex-1 [&>option]:bg-popover [&>option]:text-popover-foreground",
                )}
              >
                {!knownCol ? (
                  <option value={d.column}>
                    {d.column === "" ? "Pick a column…" : `${d.column} (missing)`}
                  </option>
                ) : null}
                {columns.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                aria-label={`Filter ${i + 1} operator`}
                data-testid={`inspector-filter-op-${i}`}
                value={d.op}
                onChange={(e) =>
                  update(
                    drafts.map((dd, j) =>
                      j === i ? { ...dd, op: e.target.value as FilterOp } : dd,
                    ),
                    true,
                  )
                }
                className={cn(
                  controlCls(false),
                  "w-24 flex-none [&>option]:bg-popover [&>option]:text-popover-foreground",
                )}
              >
                {OP_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove filter ${i + 1}`}
                onClick={() =>
                  update(
                    drafts.filter((_, j) => j !== i),
                    true,
                  )
                }
              >
                <X className="size-3" />
              </Button>
            </div>
            {d.op === "between" ? (
              <div className="flex items-center gap-1">
                <input
                  aria-label={`Filter ${i + 1} lower bound`}
                  data-testid={`inspector-filter-value-${i}`}
                  value={d.value}
                  placeholder="From"
                  onChange={(e) =>
                    update(
                      drafts.map((dd, j) =>
                        j === i ? { ...dd, value: e.target.value } : dd,
                      ),
                    )
                  }
                  onBlur={debounced.flush}
                  className={cn(controlCls(!!parsed[i]?.error), "flex-1")}
                />
                <input
                  aria-label={`Filter ${i + 1} upper bound`}
                  data-testid={`inspector-filter-value2-${i}`}
                  value={d.value2}
                  placeholder="To"
                  onChange={(e) =>
                    update(
                      drafts.map((dd, j) =>
                        j === i ? { ...dd, value2: e.target.value } : dd,
                      ),
                    )
                  }
                  onBlur={debounced.flush}
                  className={cn(controlCls(!!parsed[i]?.error), "flex-1")}
                />
              </div>
            ) : (
              <input
                aria-label={`Filter ${i + 1} value`}
                data-testid={`inspector-filter-value-${i}`}
                value={d.value}
                placeholder={
                  d.op === "in" ? "value1, value2, …" : "Value"
                }
                onChange={(e) =>
                  update(
                    drafts.map((dd, j) =>
                      j === i ? { ...dd, value: e.target.value } : dd,
                    ),
                  )
                }
                onBlur={debounced.flush}
                className={controlCls(!!parsed[i]?.error)}
              />
            )}
            <RowError message={parsed[i]?.error ?? null} />
          </div>
        );
      })}
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        data-testid="inspector-add-filter"
        onClick={() =>
          update([
            ...drafts,
            {
              column: columns[0]?.name ?? "",
              op: "eq",
              value: "",
              value2: "",
            },
          ])
        }
      >
        <Plus className="size-3" /> Add filter
      </Button>
      <ToggleField
        label="Ignore cross-filter"
        testId="inspector-ignore-crossfilter"
        checked={tile.ignoreCrossFilter === true}
        hint="Clicks on other tiles will not filter this tile."
        onChange={(v) =>
          useDashboardStore.getState().setTileIgnoreCrossFilter(tile.id, v, {
            origin: "human",
            label: v
              ? `Excluded “${tile.title}” from cross-filtering`
              : `Included “${tile.title}” in cross-filtering`,
          })
        }
      />
    </Section>
  );
}
