"use client";

/**
 * Datasets — every table the query engine can see right now, grouped by where
 * it came from. Row and column counts are read from DuckDB, not stored copy.
 */

import { useState } from "react";
import { CaretRight, Database } from "@phosphor-icons/react";
import type { DatasetMeta } from "@kontier-ri/datasource";
import { useDashboardStore } from "@/lib/dashboard-store";
import {
  ORIGIN_LABEL,
  ORIGIN_NOTE,
  datasetOrigin,
  shortType,
  totalRows,
  useLiveDatasets,
  type DatasetOrigin,
} from "@/lib/workspace-data";
import { cn } from "@/lib/utils";
import {
  Card,
  EmptyPanel,
  PageHeader,
  Pill,
  WorkspacePage,
} from "./primitives";

const ORDER: DatasetOrigin[] = ["demo", "uploaded", "view"];

function DatasetRow({ meta }: { meta: DatasetMeta }) {
  const [open, setOpen] = useState(false);
  const panelId = `dataset-columns-${meta.name}`;
  return (
    <li className="border-b border-line last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-3 px-[18px] py-3 text-left transition-colors hover:bg-surface-2"
        data-testid="dataset-row"
      >
        <CaretRight
          aria-hidden
          weight="bold"
          className={cn(
            "size-3 shrink-0 text-faint transition-transform",
            open && "rotate-90",
          )}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[14px] font-medium">{meta.name}</span>
          {meta.description ? (
            <span className="truncate text-[12px] text-faint">
              {meta.description}
            </span>
          ) : null}
        </span>
        <span className="hidden w-[140px] shrink-0 sm:block">
          {meta.group ? <Pill>{meta.group}</Pill> : null}
        </span>
        <span className="w-[110px] shrink-0 text-right text-[13px] text-muted-foreground">
          {meta.rowCount.toLocaleString("en-US")} rows
        </span>
        <span className="w-[90px] shrink-0 text-right text-[13px] text-muted-foreground">
          {meta.columns.length} cols
        </span>
      </button>
      {open ? (
        <div id={panelId} className="border-t border-line bg-surface-2/50 px-[18px] py-3">
          <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-3">
            {meta.columns.map((column) => (
              <li
                key={column.name}
                className="flex items-center gap-2 text-[13px]"
              >
                <span className="min-w-[30px] rounded border-0 bg-accent-soft px-1.5 py-px text-center font-mono text-[10px] font-semibold text-accent-strong">
                  {shortType(column.type)}
                </span>
                <span className="min-w-0 truncate">{column.name}</span>
                <span
                  className="ml-auto shrink-0 text-[11px] text-faint"
                  title={column.type}
                >
                  {column.type}
                  {column.nullable ? "" : " · required"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

export function DatasetsView() {
  const viewCount = useDashboardStore((s) => s.doc.views.length);
  const { datasets, status, statusDetail } = useLiveDatasets(viewCount);

  const rows = totalRows(datasets);
  const subtitle =
    status === "ready"
      ? `${datasets.length} ${datasets.length === 1 ? "dataset" : "datasets"} · ${rows.toLocaleString("en-US")} rows in this browser tab`
      : status === "booting"
        ? `Query engine starting · ${statusDetail}`
        : `Query engine error · ${statusDetail}`;

  const groups = ORDER.map((origin) => ({
    origin,
    items: datasets.filter((d) => datasetOrigin(d) === origin),
  })).filter((group) => group.items.length > 0);

  return (
    <WorkspacePage label="Datasets" testId="datasets-view">
      <PageHeader title="Datasets" subtitle={subtitle} />

      {datasets.length === 0 ? (
        <EmptyPanel>
          {status === "error"
            ? `The query engine did not start: ${statusDetail}`
            : "No datasets are registered yet. Demo tables load when the tab opens; drop a CSV or Parquet file on the canvas to add your own."}
        </EmptyPanel>
      ) : (
        groups.map((group) => (
          <section key={group.origin} className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-baseline gap-2.5">
              <h2 className="flex items-center gap-2 text-[15px] font-semibold">
                <Database aria-hidden className="size-4 text-faint" />
                {ORIGIN_LABEL[group.origin]}
              </h2>
              <Pill tone={group.origin === "uploaded" ? "warn" : "neutral"}>
                {group.items.length}
              </Pill>
              <p className="text-[12.5px] text-faint">
                {ORIGIN_NOTE[group.origin]}
              </p>
            </div>
            <Card className="overflow-hidden">
              <div className="flex items-center gap-3 border-b border-line px-[18px] py-2.5 text-[12.5px] text-faint">
                <span aria-hidden className="size-3 shrink-0" />
                <span className="flex-1">Dataset</span>
                <span className="hidden w-[140px] shrink-0 sm:block">Group</span>
                <span className="w-[110px] shrink-0 text-right">Rows</span>
                <span className="w-[90px] shrink-0 text-right">Columns</span>
              </div>
              <ul>
                {group.items.map((meta) => (
                  <DatasetRow key={meta.name} meta={meta} />
                ))}
              </ul>
            </Card>
          </section>
        ))
      )}
    </WorkspacePage>
  );
}
