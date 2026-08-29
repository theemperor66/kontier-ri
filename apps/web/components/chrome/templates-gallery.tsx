"use client";

/**
 * Templates gallery: 3 curated dashboards instantiated against the demo
 * datasets. Entry points: empty state, command palette, dashboard manager.
 */

import { ChartBar, Gauge, Note, Table } from "@phosphor-icons/react";
import { toast } from "sonner";
import type { TileType } from "@/lib/dashboard-store";
import { useDashboardStore } from "@/lib/dashboard-store";
import { Modal } from "@/components/chrome/modal";
import { useUiState } from "@/lib/ui-state";
import { useDataSource } from "@/lib/datasource";
import { TEMPLATES } from "@/lib/templates";
import { openDocAsDashboard } from "@/lib/dashboards";

const PREVIEW_ICON: Record<TileType, React.ComponentType<{ className?: string }>> = {
  kpi: Gauge,
  chart: ChartBar,
  table: Table,
  markdown: Note,
};

export function TemplatesGallery() {
  const open = useUiState((s) => s.templatesOpen);
  const setOpen = useUiState((s) => s.setTemplatesOpen);
  const mode = useDashboardStore((s) => s.doc.theme.mode);
  const { status } = useDataSource();

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Templates"
      testId="templates-gallery"
      className="max-w-2xl"
    >
      <p className="px-4 pt-3 text-xs text-muted-foreground">
        Instant dashboards built on the bundled demo billing data — use them
        as starting points and let your agent adapt them to your own uploads.
      </p>
      <div className="grid gap-3 p-4 sm:grid-cols-3">
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            data-testid={`template-${t.id}`}
            disabled={status !== "ready"}
            className="group flex cursor-pointer flex-col rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-agent/50 hover:bg-agent/5 disabled:cursor-default disabled:opacity-50"
            onClick={() => {
              openDocAsDashboard(t.build(mode));
              setOpen(false);
              toast.success(`Template "${t.name}" ready — ask your agent to riff on it.`);
            }}
          >
            <span className="flex items-center gap-1">
              {t.preview.map((p, i) => {
                const Icon = PREVIEW_ICON[p];
                return (
                  <span
                    key={`${p}-${i}`}
                    className="flex size-6 items-center justify-center rounded-md border border-border/70 bg-muted/50"
                  >
                    <Icon className="size-3.5 text-muted-foreground" />
                  </span>
                );
              })}
            </span>
            <span className="mt-3 text-sm font-semibold">{t.name}</span>
            <span className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t.description}
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
