"use client";

/**
 * Command palette (cmd+K, cmdk). Every human shell action + "copy prompt for
 * agent" entries. Rendered in a shell-owned overlay (no portal deps).
 */

import { useEffect, useMemo, useRef } from "react";
import { Command } from "cmdk";
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ChartBar,
  Copy,
  DownloadSimple,
  FileImage,
  LinkSimple,
  FilePng,
  Gauge,
  Layout,
  MoonStars,
  Note,
  Play,
  PlusCircle,
  Robot,
  Sparkle,
  SquaresFour,
  Table,
  UploadSimple,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import type { AddTileInput, DashboardDoc } from "@/lib/dashboard-store";
import { useDashboardStore } from "@/lib/dashboard-store";
import { useDataSource } from "@/lib/datasource";
import { useUiState } from "@/lib/ui-state";
import { buildDemoDoc } from "@/lib/demo";
import { AGENT_PROMPTS } from "@/lib/agent-prompts";
import { TEMPLATES } from "@/lib/templates";
import {
  createDashboard,
  exportDashboardJSON,
  importDashboardJSON,
  openDocAsDashboard,
} from "@/lib/dashboards";
import { exportTileCSV } from "@/lib/export-csv";
import { exportDashboardPNG, exportTilePNG } from "@/lib/export-image";
import { buildShareURL } from "@/lib/share-url";
import type { DatasetMeta } from "@kontier-ri/datasource";

function firstDataset(datasets: DatasetMeta[]): DatasetMeta | null {
  return datasets.find((d) => d.name === "invoices") ?? datasets[0] ?? null;
}

/** Default tile inputs so "Add … tile" works instantly on any dataset. */
function defaultTileInput(
  type: "kpi" | "chart" | "table" | "markdown",
  datasets: DatasetMeta[],
): AddTileInput | null {
  if (type === "markdown") {
    return {
      type: "markdown",
      title: "Notes",
      spec: { content: "## Notes\n\nDouble-click to edit, or ask your agent." },
    };
  }
  const ds = firstDataset(datasets);
  if (!ds) return null;
  if (type === "kpi") {
    return {
      type: "kpi",
      title: `${ds.name} rows`,
      spec: { dataset: ds.name, measure: "*", agg: "count", format: "number" },
    };
  }
  if (type === "table") {
    return {
      type: "table",
      title: `${ds.name} sample`,
      spec: { dataset: ds.name, sql: `SELECT * FROM ${ds.name} LIMIT 100`, pageSize: 10 },
    };
  }
  const dim =
    ds.columns.find((c) => ["month", "date", "status", "segment"].includes(c.name)) ??
    ds.columns.find((c) => c.type.toLowerCase().includes("varchar")) ??
    ds.columns[0];
  if (!dim) return null;
  return {
    type: "chart",
    title: `${ds.name} by ${dim.name}`,
    spec: {
      dataset: ds.name,
      query: { dims: [dim.name], measures: [{ col: "*", agg: "count" }] },
      chartType: "bar",
      xKey: dim.name,
    },
  };
}

function copyPrompt(prompt: string) {
  void navigator.clipboard
    .writeText(prompt)
    .then(() => toast.success("Prompt copied — paste it to your agent."))
    .catch(() => toast.error("Could not access the clipboard."));
}

export function CommandPalette() {
  const open = useUiState((s) => s.paletteOpen);
  const setOpen = useUiState((s) => s.setPaletteOpen);
  const setManagerOpen = useUiState((s) => s.setManagerOpen);
  const setTemplatesOpen = useUiState((s) => s.setTemplatesOpen);
  const togglePresentation = useUiState((s) => s.togglePresentation);
  const { datasets, importFiles, status } = useDataSource();
  const inputRef = useRef<HTMLInputElement>(null);

  // cmd+K / ctrl+K toggles.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!useUiState.getState().paletteOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const store = useDashboardStore;
  const selectedTile = useDashboardStore((s) =>
    s.selectedTileId ? s.doc.tiles.find((t) => t.id === s.selectedTileId) : undefined,
  );
  const mode = useDashboardStore((s) => s.doc.theme.mode);

  const run = useMemo(
    () => (fn: () => unknown) => () => {
      setOpen(false);
      void Promise.resolve(fn()).catch((err) =>
        toast.error(err instanceof Error ? err.message : String(err)),
      );
    },
    [setOpen],
  );

  if (!open) return null;

  const addTile = (type: "kpi" | "chart" | "table" | "markdown") => {
    const input = defaultTileInput(type, datasets);
    if (!input) {
      toast.error("No dataset available yet — load the demo or upload data first.");
      return;
    }
    const result = store
      .getState()
      .addTile(input, { origin: "human", label: `Added ${type} tile "${input.title}"` });
    if (result.ok) toast.success(`Added ${type} tile — drag it into place.`);
  };

  const pickFilesAndImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,.parquet";
    input.multiple = true;
    input.onchange = async () => {
      if (!input.files || input.files.length === 0) return;
      try {
        const imported = await importFiles(input.files);
        toast.success(`Imported ${imported.map((d) => d.name).join(", ")}.`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    };
    input.click();
  };

  const pickJSONAndImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const doc = await importDashboardJSON(file);
        toast.success(`Imported dashboard "${doc.title}".`);
      } catch (err) {
        toast.error(
          `Import failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    };
    input.click();
  };

  const doc: DashboardDoc = store.getState().doc;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[12vh] backdrop-blur-sm"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <Command
        label="Command palette"
        data-testid="command-palette"
        className="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        <Command.Input
          ref={inputRef}
          placeholder="Type a command or search…"
          className="h-12 w-full border-b border-border/70 bg-transparent px-4 text-sm outline-none placeholder:text-muted-foreground"
        />
        <Command.List className="max-h-[50vh] overflow-y-auto p-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-item]]:flex [&_[cmdk-item]]:cursor-pointer [&_[cmdk-item]]:items-center [&_[cmdk-item]]:gap-2.5 [&_[cmdk-item]]:rounded-md [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2 [&_[cmdk-item]]:text-sm [&_[cmdk-item][data-selected=true]]:bg-accent [&_[cmdk-item][data-selected=true]]:text-accent-foreground">
          <Command.Empty className="px-2 py-6 text-center text-sm text-muted-foreground">
            No matching command.
          </Command.Empty>

          <Command.Group heading="Add">
            <Command.Item onSelect={run(() => addTile("kpi"))}>
              <Gauge className="size-4 text-muted-foreground" /> Add KPI tile
            </Command.Item>
            <Command.Item onSelect={run(() => addTile("chart"))}>
              <ChartBar className="size-4 text-muted-foreground" /> Add chart tile
            </Command.Item>
            <Command.Item onSelect={run(() => addTile("table"))}>
              <Table className="size-4 text-muted-foreground" /> Add table tile
            </Command.Item>
            <Command.Item onSelect={run(() => addTile("markdown"))}>
              <Note className="size-4 text-muted-foreground" /> Add markdown tile
            </Command.Item>
          </Command.Group>

          <Command.Group heading="Dashboard">
            <Command.Item onSelect={run(() => setManagerOpen(true))}>
              <SquaresFour className="size-4 text-muted-foreground" /> Manage dashboards
            </Command.Item>
            <Command.Item onSelect={run(() => createDashboard())}>
              <PlusCircle className="size-4 text-muted-foreground" /> New blank dashboard
            </Command.Item>
            <Command.Item onSelect={run(() => setTemplatesOpen(true))}>
              <Layout className="size-4 text-muted-foreground" /> Browse templates
            </Command.Item>
            <Command.Item
              disabled={status !== "ready"}
              onSelect={run(() => openDocAsDashboard(buildDemoDoc(mode)))}
            >
              <Sparkle className="size-4 text-muted-foreground" /> Load demo dashboard
            </Command.Item>
            <Command.Item onSelect={run(pickFilesAndImport)}>
              <UploadSimple className="size-4 text-muted-foreground" /> Upload CSV / Parquet
            </Command.Item>
            <Command.Item
              onSelect={run(() =>
                store.getState().setTheme(
                  { mode: mode === "dark" ? "light" : "dark" },
                  {
                    origin: "human",
                    label: `Switched to ${mode === "dark" ? "light" : "dark"} mode`,
                  },
                ),
              )}
            >
              <MoonStars className="size-4 text-muted-foreground" /> Toggle dark / light mode
            </Command.Item>
            <Command.Item onSelect={run(() => store.getState().undo())}>
              <ArrowCounterClockwise className="size-4 text-muted-foreground" /> Undo
            </Command.Item>
            <Command.Item onSelect={run(() => store.getState().redo())}>
              <ArrowClockwise className="size-4 text-muted-foreground" /> Redo
            </Command.Item>
            <Command.Item onSelect={run(() => togglePresentation())}>
              <Play className="size-4 text-muted-foreground" /> Presentation mode
              <kbd className="ml-auto rounded border border-border bg-muted px-1.5 text-[10px] text-muted-foreground">F</kbd>
            </Command.Item>
          </Command.Group>

          <Command.Group heading="Export">
            <Command.Item onSelect={run(() => exportDashboardJSON())}>
              <DownloadSimple className="size-4 text-muted-foreground" /> Export dashboard as JSON
            </Command.Item>
            <Command.Item onSelect={run(pickJSONAndImport)}>
              <UploadSimple className="size-4 text-muted-foreground" /> Import dashboard from JSON
            </Command.Item>
            <Command.Item onSelect={run(() => exportDashboardPNG(doc.title))}>
              <FileImage className="size-4 text-muted-foreground" /> Export dashboard as PNG
            </Command.Item>
            <Command.Item
              onSelect={run(() =>
                navigator.clipboard
                  .writeText(buildShareURL(doc))
                  .then(() => toast.success("Share link copied — the whole dashboard travels in the URL."))
              )}
            >
              <LinkSimple className="size-4 text-muted-foreground" /> Copy share link
            </Command.Item>
            {selectedTile ? (
              <>
                <Command.Item
                  onSelect={run(() => exportTilePNG(selectedTile.id, selectedTile.title))}
                >
                  <FilePng className="size-4 text-muted-foreground" /> Export tile
                  &nbsp;&ldquo;{selectedTile.title}&rdquo; as PNG
                </Command.Item>
                {selectedTile.type !== "markdown" ? (
                  <Command.Item
                    onSelect={run(() => exportTileCSV(selectedTile, doc))}
                  >
                    <DownloadSimple className="size-4 text-muted-foreground" /> Export tile
                    &nbsp;&ldquo;{selectedTile.title}&rdquo; data as CSV
                  </Command.Item>
                ) : null}
              </>
            ) : null}
          </Command.Group>

          <Command.Group heading="Templates">
            {TEMPLATES.map((t) => (
              <Command.Item
                key={t.id}
                onSelect={run(() => {
                  openDocAsDashboard(t.build(mode));
                  toast.success(`Template "${t.name}" ready.`);
                })}
              >
                <Layout className="size-4 text-muted-foreground" /> Template: {t.name}
              </Command.Item>
            ))}
          </Command.Group>

          <Command.Group heading="Ask your agent (copies a prompt)">
            {AGENT_PROMPTS.map((p) => (
              <Command.Item key={p.id} onSelect={run(() => copyPrompt(p.prompt))}>
                <Robot className="size-4 text-agent" />
                <span>{p.label}</span>
                <Copy className="ml-auto size-3.5 text-muted-foreground" />
              </Command.Item>
            ))}
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}
