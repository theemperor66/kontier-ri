"use client";

/**
 * Data health & lineage — what the engine holds right now and which tile reads
 * what. Kontier RI has no scheduled refresh and no owner registry, so no
 * refresh times, durations or owners are shown: only facts the app can prove.
 */

import { useMemo } from "react";
import { ArrowRight, Database, Table, Warning } from "@phosphor-icons/react";
import { summarizeSpec } from "@kontier-ri/studio";
import { useDashboardStore } from "@/lib/dashboard-store";
import type { Tile } from "@/lib/dashboard-store";
import {
  datasetOrigin,
  ORIGIN_LABEL,
  tileMeasures,
  tileSources,
  totalRows,
  useLiveDatasets,
} from "@/lib/workspace-data";
import {
  Card,
  CardTitle,
  EmptyPanel,
  Mono,
  PageHeader,
  Pill,
  StatCard,
  StatusDot,
  WorkspacePage,
} from "./primitives";

function Node({
  name,
  kind,
  tone = "neutral",
}: {
  name: string;
  kind: string;
  tone?: "neutral" | "accent" | "danger";
}) {
  const styles =
    tone === "accent"
      ? "border-accent-mid bg-accent-soft"
      : tone === "danger"
        ? "border-danger/40 bg-danger-soft"
        : "border-line bg-surface-2";
  return (
    <span
      className={`inline-flex max-w-[220px] shrink-0 flex-col rounded-lg border px-3 py-2 ${styles}`}
    >
      <span className="truncate text-[13px] font-medium">{name}</span>
      <span className="truncate text-[11.5px] text-muted-foreground">{kind}</span>
    </span>
  );
}

function LineageRow({
  tile,
  names,
  fieldNames,
}: {
  tile: Tile;
  names: string[];
  fieldNames: string[];
}) {
  const sources = tileSources(tile, names);
  const measures = tileMeasures(tile, fieldNames);
  const known = new Set(names);

  return (
    <li className="flex flex-col gap-1.5 border-b border-line py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2.5 text-[13px]">
        {sources.length === 0 ? (
          <Node name="No dataset" kind="reads no data" />
        ) : (
          sources.map((source) => (
            <span key={source} className="flex items-center gap-2.5">
              <Node
                name={source}
                kind={
                  !known.has(source)
                    ? "not loaded"
                    : source.startsWith("view_")
                      ? "SQL view"
                      : "table"
                }
                tone={known.has(source) ? "neutral" : "danger"}
              />
              <ArrowRight aria-hidden className="size-3.5 shrink-0 text-faint" />
            </span>
          ))
        )}
        {measures.map((measure) => (
          <span key={measure} className="flex items-center gap-2.5">
            <Node name={measure} kind="measure" tone="accent" />
            <ArrowRight aria-hidden className="size-3.5 shrink-0 text-faint" />
          </span>
        ))}
        <Node name={tile.title} kind={`${tile.type} tile`} tone="accent" />
      </div>
      <Mono className="block text-[11.5px]" title={summarizeSpec(tile)}>
        {summarizeSpec(tile)}
      </Mono>
    </li>
  );
}

export function GovernanceView() {
  const doc = useDashboardStore((s) => s.doc);
  const { datasets, status, statusDetail } = useLiveDatasets(doc.views.length);

  const names = useMemo(() => datasets.map((d) => d.name), [datasets]);
  const fieldNames = useMemo(
    () => doc.calculatedFields.map((f) => f.name),
    [doc.calculatedFields],
  );
  const known = useMemo(() => new Set(names), [names]);

  const allTiles = useMemo(
    () => doc.pages.flatMap((page) => page.tiles),
    [doc.pages],
  );

  /** Sources a tile asks for, mapped to whether the engine can resolve them. */
  const referenced = useMemo(() => {
    const map = new Map<string, number>();
    for (const tile of allTiles) {
      for (const source of tileSources(tile, names)) {
        map.set(source, (map.get(source) ?? 0) + 1);
      }
    }
    return map;
  }, [allTiles, names]);

  const missing = useMemo(
    () => [...referenced.keys()].filter((name) => !known.has(name)),
    [referenced, known],
  );

  const dataTiles = allTiles.filter((tile) => tile.type !== "markdown").length;
  const rows = totalRows(datasets);

  return (
    <WorkspacePage label="Data health and lineage" testId="governance-view">
      <PageHeader
        title="Data health & lineage"
        subtitle={
          status === "ready"
            ? `Live engine state in this tab · ${datasets.length} ${datasets.length === 1 ? "dataset" : "datasets"} loaded`
            : status === "booting"
              ? `Query engine starting · ${statusDetail}`
              : `Query engine error · ${statusDetail}`
        }
      />

      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<Database className="size-[18px]" weight="bold" />}
          label="Datasets in the engine"
          value={datasets.length}
        />
        <StatCard
          icon={<Table className="size-[18px]" weight="bold" />}
          label="Rows loaded"
          value={rows.toLocaleString("en-US")}
          tone="ok"
        />
        <StatCard
          icon={<Table className="size-[18px]" weight="bold" />}
          label="Tiles reading data"
          value={dataTiles}
          tone="neutral"
        />
        <StatCard
          icon={<Warning className="size-[18px]" weight="bold" />}
          label="Sources that will not resolve"
          value={missing.length}
          tone={missing.length > 0 ? "danger" : "ok"}
        />
      </div>

      <p className="-mt-2 text-[12.5px] leading-relaxed text-faint">
        There is no refresh schedule to report: datasets are registered when the
        tab loads the demo files or when you import a file, and they live only
        in this browser session. Uploads disappear on reload.
      </p>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-[2fr_1.2fr_1fr_1fr_1.4fr] border-b border-line px-[18px] py-2.5 text-[12.5px] text-faint">
          <span>Dataset</span>
          <span>Source</span>
          <span className="text-right">Rows</span>
          <span className="text-right">Columns</span>
          <span className="pl-6">Status</span>
        </div>
        {datasets.length === 0 ? (
          <p className="px-[18px] py-6 text-center text-[13.5px] text-muted-foreground">
            {status === "error"
              ? statusDetail
              : "No datasets registered in this tab yet."}
          </p>
        ) : (
          <ul>
            {datasets.map((meta) => {
              const uses = referenced.get(meta.name) ?? 0;
              return (
                <li
                  key={meta.name}
                  className="grid grid-cols-[2fr_1.2fr_1fr_1fr_1.4fr] items-center border-b border-line px-[18px] py-3 text-[14px] transition-colors last:border-b-0 hover:bg-surface-2"
                >
                  <span className="min-w-0 truncate font-medium">{meta.name}</span>
                  <span className="min-w-0 truncate text-muted-foreground">
                    {ORIGIN_LABEL[datasetOrigin(meta)]}
                    {meta.group ? ` · ${meta.group}` : ""}
                  </span>
                  <span className="text-right">
                    {meta.rowCount.toLocaleString("en-US")}
                  </span>
                  <span className="text-right">{meta.columns.length}</span>
                  <span className="flex items-center gap-2 pl-6">
                    <StatusDot tone="ok" />
                    <span className="truncate">
                      In the engine
                      {uses > 0
                        ? ` · ${uses} ${uses === 1 ? "tile" : "tiles"}`
                        : ""}
                    </span>
                  </span>
                </li>
              );
            })}
            {missing.map((name) => (
              <li
                key={name}
                className="grid grid-cols-[2fr_1.2fr_1fr_1fr_1.4fr] items-center border-b border-line px-[18px] py-3 text-[14px] last:border-b-0"
              >
                <span className="min-w-0 truncate font-medium">{name}</span>
                <span className="min-w-0 truncate text-muted-foreground">
                  Referenced by a tile
                </span>
                <span className="text-right text-faint">unknown</span>
                <span className="text-right text-faint">unknown</span>
                <span className="flex items-center gap-2 pl-6">
                  <StatusDot tone="danger" />
                  <span className="truncate text-danger">Not loaded</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="px-[18px] py-4">
        <CardTitle sub="Read from each tile's own spec and SQL — not a stored graph.">
          Lineage · {doc.title}
        </CardTitle>
        {doc.pages.every((page) => page.tiles.length === 0) ? (
          <EmptyPanel className="mt-3">
            No tiles yet, so there is nothing to trace. Add a tile or load the
            demo dashboard.
          </EmptyPanel>
        ) : (
          <div className="mt-2 flex flex-col gap-4">
            {doc.pages
              .filter((page) => page.tiles.length > 0)
              .map((page) => (
                <section key={page.id}>
                  <div className="flex items-center gap-2">
                    <h3 className="text-[13.5px] font-medium">{page.name}</h3>
                    <Pill>
                      {page.tiles.length}{" "}
                      {page.tiles.length === 1 ? "tile" : "tiles"}
                    </Pill>
                  </div>
                  <ul className="mt-1">
                    {page.tiles.map((tile) => (
                      <LineageRow
                        key={tile.id}
                        tile={tile}
                        names={names}
                        fieldNames={fieldNames}
                      />
                    ))}
                  </ul>
                </section>
              ))}
          </div>
        )}
      </Card>
    </WorkspacePage>
  );
}
