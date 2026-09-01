"use client";

/**
 * Inspector Format section: value style (currency / number / percent /
 * compact) + conditional-formatting rules (op / value / color rows).
 * KPI tiles use spec.format + spec.rules; chart/table use spec.format.value
 * and spec.format.rules (existing schema — nothing new).
 */

import { useEffect, useRef, useState } from "react";
import { Plus, X } from "@phosphor-icons/react";
import type {
  FormatRule,
  KpiFormat,
  TileFormat,
  ValueFormat,
  ValueFormatOptions,
} from "@kontier-ri/studio";
import type { ChartSpec, KpiSpec, TableSpec, Tile } from "@/lib/dashboard-store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { commitSpec, useDebounced } from "./commit";
import { controlCls, RowError, Section, SelectField } from "./fields";

type StyleValue = ValueFormat | KpiFormat | ValueFormatOptions | undefined;

function styleOf(v: StyleValue): string {
  if (v == null) return "__auto";
  return typeof v === "string" ? v : v.style;
}

/** Preserve the object form (currency override) when one exists. */
function withStyle(existing: StyleValue, style: string): StyleValue {
  if (style === "__auto") return undefined;
  if (existing != null && typeof existing === "object") {
    return { ...existing, style: style as ValueFormat };
  }
  return style as ValueFormat;
}

const RULE_OPS = [
  { value: "lt", label: "<" },
  { value: "lte", label: "≤" },
  { value: "gt", label: ">" },
  { value: "gte", label: "≥" },
  { value: "eq", label: "=" },
];

const RULE_COLORS = [
  { value: "var(--chart-2)", label: "Green" },
  { value: "var(--destructive)", label: "Red" },
  { value: "var(--chart-4)", label: "Amber" },
  { value: "var(--chart-1)", label: "Blue" },
  { value: "var(--chart-3)", label: "Violet" },
  { value: "var(--chart-5)", label: "Gray" },
];

interface RuleDraft {
  op: FormatRule["op"];
  value: string;
  color: string;
}

function toDrafts(rules: FormatRule[]): RuleDraft[] {
  return rules.map((r) => ({ op: r.op, value: String(r.value), color: r.color }));
}

/**
 * Conditional-formatting rules editor. Rows live in local draft state so an
 * invalid value (red hairline) never reaches the doc; commits are debounced
 * and only fire when every row parses.
 */
function RulesEditor({
  rules,
  onCommit,
  testIdPrefix,
}: {
  rules: FormatRule[];
  onCommit: (rules: FormatRule[]) => void;
  testIdPrefix: string;
}) {
  const [drafts, setDrafts] = useState<RuleDraft[]>(() => toDrafts(rules));
  const lastCommitted = useRef(JSON.stringify(rules));
  useEffect(() => {
    const j = JSON.stringify(rules);
    if (j !== lastCommitted.current) {
      lastCommitted.current = j;
      setDrafts(toDrafts(rules));
    }
  }, [rules]);

  const errors = drafts.map((d) =>
    d.value.trim() !== "" && Number.isFinite(Number(d.value.trim()))
      ? null
      : "Enter a number.",
  );

  const debounced = useDebounced((next: RuleDraft[]) => {
    if (
      next.some(
        (d) => d.value.trim() === "" || !Number.isFinite(Number(d.value.trim())),
      )
    ) {
      return; // invalid rows are never applied
    }
    const parsed: FormatRule[] = next.map((d) => ({
      op: d.op,
      value: Number(d.value.trim()),
      color: d.color,
    }));
    lastCommitted.current = JSON.stringify(parsed);
    onCommit(parsed);
  });

  const update = (next: RuleDraft[]) => {
    setDrafts(next);
    debounced.call(next);
  };

  return (
    <div className="space-y-1.5">
      <span className="block text-[11px] font-medium text-muted-foreground">
        Conditional formatting
      </span>
      {drafts.map((d, i) => {
        const knownColor = RULE_COLORS.some((c) => c.value === d.color);
        return (
          <div key={`rule-${i}`} className="space-y-1">
            <div className="flex items-center gap-1">
              <select
                aria-label={`Rule ${i + 1} operator`}
                data-testid={`${testIdPrefix}-rule-op-${i}`}
                value={d.op}
                onChange={(e) =>
                  update(
                    drafts.map((dd, j) =>
                      j === i
                        ? { ...dd, op: e.target.value as FormatRule["op"] }
                        : dd,
                    ),
                  )
                }
                className={cn(
                  controlCls(false),
                  "w-14 flex-none [&>option]:bg-popover [&>option]:text-popover-foreground",
                )}
              >
                {RULE_OPS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <input
                aria-label={`Rule ${i + 1} value`}
                data-testid={`${testIdPrefix}-rule-value-${i}`}
                type="number"
                value={d.value}
                onChange={(e) =>
                  update(
                    drafts.map((dd, j) =>
                      j === i ? { ...dd, value: e.target.value } : dd,
                    ),
                  )
                }
                onBlur={debounced.flush}
                className={cn(controlCls(!!errors[i]), "flex-1")}
              />
              <span
                aria-hidden
                className="size-3.5 shrink-0 rounded-full border border-border/70"
                style={{ background: d.color }}
              />
              <select
                aria-label={`Rule ${i + 1} color`}
                data-testid={`${testIdPrefix}-rule-color-${i}`}
                value={d.color}
                onChange={(e) =>
                  update(
                    drafts.map((dd, j) =>
                      j === i ? { ...dd, color: e.target.value } : dd,
                    ),
                  )
                }
                className={cn(
                  controlCls(false),
                  "w-20 flex-none [&>option]:bg-popover [&>option]:text-popover-foreground",
                )}
              >
                {!knownColor ? <option value={d.color}>Custom</option> : null}
                {RULE_COLORS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove rule ${i + 1}`}
                onClick={() => {
                  const next = drafts.filter((_, j) => j !== i);
                  setDrafts(next);
                  debounced.call(next);
                  debounced.flush();
                }}
              >
                <X className="size-3" />
              </Button>
            </div>
            <RowError message={errors[i] ?? null} />
          </div>
        );
      })}
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        data-testid={`${testIdPrefix}-add-rule`}
        onClick={() => {
          const next = [
            ...drafts,
            { op: "gt" as const, value: "0", color: "var(--chart-2)" },
          ];
          setDrafts(next);
          debounced.call(next);
          debounced.flush();
        }}
      >
        <Plus className="size-3" /> Add rule
      </Button>
      <p className="text-[11px] leading-snug text-muted-foreground/70">
        First matching rule colors the value.
      </p>
    </div>
  );
}

const CHART_STYLES = [
  { value: "__auto", label: "Auto" },
  { value: "currency", label: "Currency" },
  { value: "number", label: "Number" },
  { value: "percent", label: "Percent" },
  { value: "compact", label: "Compact" },
];

const KPI_STYLES = [
  { value: "currency", label: "Currency" },
  { value: "number", label: "Number" },
  { value: "percent", label: "Percent" },
];

export function FormatSection({ tile }: { tile: Tile }) {
  if (tile.type === "kpi") {
    const spec = tile.spec as KpiSpec;
    return (
      <Section title="Format" testId="inspector-format">
        <SelectField
          label="Value style"
          testId="inspector-value-style"
          value={styleOf(spec.format)}
          options={KPI_STYLES}
          onChange={(v) =>
            commitSpec(
              tile.id,
              { format: withStyle(spec.format, v) },
              `Set “${tile.title}” format to ${v}`,
            )
          }
        />
        <RulesEditor
          rules={spec.rules ?? []}
          testIdPrefix="inspector"
          onCommit={(rules) =>
            commitSpec(
              tile.id,
              { rules: rules.length > 0 ? rules : undefined },
              `Edited “${tile.title}” formatting rules`,
            )
          }
        />
      </Section>
    );
  }

  const spec = tile.spec as ChartSpec | TableSpec;
  const format: TileFormat = spec.format ?? {};
  const isCombo = tile.type === "chart" && (spec as ChartSpec).chartType === "combo";
  const commitFormat = (patch: Partial<TileFormat>, label: string) => {
    const next: TileFormat = { ...format, ...patch };
    if (next.value === undefined) delete next.value;
    if (next.y2 === undefined) delete next.y2;
    if (next.rules === undefined || next.rules.length === 0) delete next.rules;
    commitSpec(
      tile.id,
      { format: Object.keys(next).length > 0 ? next : undefined },
      label,
    );
  };

  return (
    <Section title="Format" testId="inspector-format">
      <SelectField
        label="Value style"
        testId="inspector-value-style"
        value={styleOf(format.value)}
        options={CHART_STYLES}
        onChange={(v) =>
          commitFormat(
            { value: withStyle(format.value, v) as TileFormat["value"] },
            `Set “${tile.title}” value format to ${v === "__auto" ? "auto" : v}`,
          )
        }
      />
      {isCombo ? (
        <SelectField
          label="Right-axis style"
          testId="inspector-y2-style"
          value={styleOf(format.y2)}
          options={CHART_STYLES}
          onChange={(v) =>
            commitFormat(
              { y2: withStyle(format.y2, v) as TileFormat["y2"] },
              `Set “${tile.title}” right-axis format to ${v === "__auto" ? "auto" : v}`,
            )
          }
        />
      ) : null}
      <RulesEditor
        rules={format.rules ?? []}
        testIdPrefix="inspector"
        onCommit={(rules) =>
          commitFormat(
            { rules: rules.length > 0 ? rules : undefined },
            `Edited “${tile.title}” formatting rules`,
          )
        }
      />
    </Section>
  );
}
