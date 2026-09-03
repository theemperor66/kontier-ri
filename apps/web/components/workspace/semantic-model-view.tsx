"use client";

/**
 * Semantic model — the entities the engine exposes and the measures/views this
 * dashboard defines. Kontier RI models no foreign keys, so no relationship
 * lines are drawn: joins live inside view SQL and are shown as such.
 */

import { useMemo, useState } from "react";
import { Function as FunctionIcon, Table } from "@phosphor-icons/react";
import type { DatasetMeta } from "@kontier-ri/datasource";
import { useDashboardStore } from "@/lib/dashboard-store";
import {
  shortType,
  tileSources,
  useLiveDatasets,
} from "@/lib/workspace-data";
import {
  ActionButton,
  Card,
  CardTitle,
  EmptyPanel,
  Mono,
  PageHeader,
  Pill,
  WorkspacePage,
} from "./primitives";

const DOT_FIELD: React.CSSProperties = {
  backgroundImage: "radial-gradient(var(--grid) 1px, transparent 1px)",
  backgroundSize: "24px 24px",
  backgroundPosition: "12px 12px",
};

const VISIBLE_FIELDS = 8;

function EntityCard({
  meta,
  usedBy,
}: {
  meta: DatasetMeta;
  usedBy: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? meta.columns : meta.columns.slice(0, VISIBLE_FIELDS);
  const hidden = meta.columns.length - shown.length;

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
      <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
        <Table aria-hidden className="size-4 shrink-0 text-faint" />
        <span className="min-w-0 truncate font-semibold">{meta.name}</span>
        <span className="ml-auto shrink-0 text-[12px] text-faint">
          {meta.rowCount.toLocaleString("en-US")} rows
        </span>
      </div>
      <ul>
        {shown.map((column) => (
          <li
            key={column.name}
            className="flex items-center gap-2 border-b border-line px-3.5 py-1.5 text-[13px] last:border-b-0"
          >
            <span className="min-w-[28px] rounded bg-accent-soft px-1.5 py-px text-center font-mono text-[10px] font-semibold text-accent-strong">
              {shortType(column.type)}
            </span>
            <span className="min-w-0 truncate">{column.name}</span>
            <span className="ml-auto shrink-0 text-[11px] text-faint">
              {column.nullable ? "nullable" : "required"}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2 px-3.5 py-2">
        {hidden > 0 || expanded ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="cursor-pointer text-[12px] font-medium text-accent-strong hover:underline"
          >
            {expanded ? "Show fewer fields" : `+${hidden} more fields`}
          </button>
        ) : null}
        <span className="ml-auto text-[11.5px] text-faint">
          {usedBy === 0
            ? "not used by a tile"
            : `used by ${usedBy} ${usedBy === 1 ? "tile" : "tiles"}`}
        </span>
      </div>
    </div>
  );
}

export function SemanticModelView() {
  const doc = useDashboardStore((s) => s.doc);
  const removeCalculatedField = useDashboardStore((s) => s.removeCalculatedField);
  const { datasets, status, statusDetail } = useLiveDatasets(doc.views.length);

  const names = useMemo(() => datasets.map((d) => d.name), [datasets]);
  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const page of doc.pages) {
      for (const tile of page.tiles) {
        for (const source of tileSources(tile, names)) {
          counts.set(source, (counts.get(source) ?? 0) + 1);
        }
      }
    }
    return counts;
  }, [doc.pages, names]);

  const tables = datasets.filter((d) => !d.name.startsWith("view_"));
  const views = datasets.filter((d) => d.name.startsWith("view_"));

  const subtitle =
    status === "ready"
      ? `${tables.length} ${tables.length === 1 ? "table" : "tables"} · ${doc.calculatedFields.length} ${doc.calculatedFields.length === 1 ? "measure" : "measures"} · ${doc.views.length} SQL ${doc.views.length === 1 ? "view" : "views"}`
      : status === "booting"
        ? `Query engine starting · ${statusDetail}`
        : `Query engine error · ${statusDetail}`;

  return (
    <WorkspacePage label="Semantic model" testId="semantic-model-view">
      <PageHeader title="Semantic Model" subtitle={subtitle} />

      <section
        className="flex flex-col gap-3 rounded-xl border border-line p-3.5"
        style={DOT_FIELD}
      >
        <p className="text-[12.5px] text-faint">
          Entities are the live engine tables. Kontier RI stores no foreign
          keys, so no relationships are drawn — joins live in the view SQL
          below.
        </p>
        {tables.length === 0 ? (
          <EmptyPanel className="bg-surface">
            No tables are registered yet.
          </EmptyPanel>
        ) : (
          <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
            {tables.map((meta) => (
              <EntityCard
                key={meta.name}
                meta={meta}
                usedBy={usage.get(meta.name) ?? 0}
              />
            ))}
          </div>
        )}
      </section>

      <Card className="px-[18px] py-4">
        <CardTitle
          sub="Named SQL expressions saved in this dashboard (create_calculated_field)."
        >
          Measures
        </CardTitle>
        {doc.calculatedFields.length === 0 ? (
          <p className="mt-2.5 text-[13.5px] text-muted-foreground">
            No measures yet. You or an agent can define one with{" "}
            <Mono className="inline">create_calculated_field</Mono>; it then
            works anywhere a column works.
          </p>
        ) : (
          <ul className="mt-2.5">
            {doc.calculatedFields.map((field) => (
              <li
                key={field.name}
                className="flex items-center gap-3 border-b border-line py-2 text-[13.5px] last:border-b-0"
              >
                <span className="flex min-w-[190px] shrink-0 items-center gap-2 font-medium">
                  <FunctionIcon aria-hidden className="size-3.5 text-faint" />
                  {field.name}
                </span>
                <Mono className="flex-1" title={field.expression}>
                  {field.expression}
                </Mono>
                <Pill>{field.dataset}</Pill>
                <Pill tone={field.kind === "aggregate" ? "accent" : "neutral"}>
                  {field.kind}
                </Pill>
                <ActionButton
                  size="sm"
                  aria-label={`Remove measure ${field.name}`}
                  onClick={() =>
                    removeCalculatedField(field.name, {
                      origin: "human",
                      label: `Removed measure “${field.name}”`,
                    })
                  }
                >
                  Remove
                </ActionButton>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="px-[18px] py-4">
        <CardTitle sub="SELECT-only views stored in the doc and re-created in the engine on load.">
          SQL views
        </CardTitle>
        {doc.views.length === 0 ? (
          <p className="mt-2.5 text-[13.5px] text-muted-foreground">
            No views yet. Views are the only place a join is defined in this
            build.
          </p>
        ) : (
          <ul className="mt-2.5">
            {doc.views.map((view) => {
              const live = views.some((v) => v.name === view.name);
              return (
                <li
                  key={view.name}
                  className="flex items-center gap-3 border-b border-line py-2 text-[13.5px] last:border-b-0"
                >
                  <span className="min-w-[190px] shrink-0 font-medium">
                    {view.name}
                  </span>
                  <Mono className="flex-1" title={view.sql}>
                    {view.sql}
                  </Mono>
                  <Pill tone={live ? "ok" : "warn"}>
                    {live ? "in engine" : "not in engine"}
                  </Pill>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </WorkspacePage>
  );
}
