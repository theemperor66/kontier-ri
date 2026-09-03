"use client";

/**
 * Version history dialog: snapshots of this report kept in the browser, with
 * the reason each one was taken. Restoring loads that document back onto the
 * canvas through the normal dashboard-load path.
 */

import { toast } from "sonner";
import { ClockCounterClockwise, Trash } from "@phosphor-icons/react";
import { useDashboardStore } from "@/lib/dashboard-store";
import { formatAgo } from "@/lib/format";
import { useUiState } from "@/lib/ui-state";
import { deleteVersion, saveVersion, useVersions } from "@/lib/versions";
import { Modal } from "@/components/chrome/modal";
import { Button } from "@/components/ui/button";

export function VersionHistory() {
  const open = useUiState((s) => s.versionsOpen);
  const setOpen = useUiState((s) => s.setVersionsOpen);
  const versions = useVersions();
  const resetDashboard = useDashboardStore((s) => s.resetDashboard);

  if (!open) return null;
  const now = Date.now();

  return (
    <Modal
      open
      title="Version history"
      onClose={() => setOpen(false)}
      testId="version-history"
      className="max-w-xl"
    >
      <div className="px-4 py-3">
      <p className="pb-3 text-[13px] leading-relaxed text-muted-foreground">
        Snapshots of this report, kept in this browser. One is taken
        automatically before a staged change set is applied.
      </p>
      <div className="flex items-center justify-between gap-3 border-b border-line pb-3">
        <p className="text-[13px] text-muted-foreground">
          {versions.length === 0
            ? "No snapshots yet."
            : `${versions.length} snapshot${versions.length === 1 ? "" : "s"}`}
        </p>
        <Button
          size="sm"
          data-testid="save-version"
          onClick={() => {
            const doc = useDashboardStore.getState().doc;
            saveVersion(doc, "Saved by you");
            toast.success("Version saved.");
          }}
        >
          Save version now
        </Button>
      </div>

      {versions.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-muted-foreground">
          Save one before a big edit, or let the next approved change set do it
          for you.
        </p>
      ) : (
        <ul className="max-h-[50vh] overflow-y-auto">
          {versions.map((version) => (
            <li
              key={version.id}
              data-testid="version-entry"
              className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0"
            >
              <ClockCounterClockwise className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-medium">
                  {version.label}
                </p>
                <p className="text-[11.5px] text-muted-foreground">
                  {formatAgo(version.savedAt, now)} · {version.tileCount}{" "}
                  {version.tileCount === 1 ? "tile" : "tiles"} ·{" "}
                  {version.doc.title}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 shrink-0 text-[12px]"
                data-testid="restore-version"
                onClick={() => {
                  saveVersion(
                    useDashboardStore.getState().doc,
                    "Before restore",
                  );
                  resetDashboard(version.doc);
                  setOpen(false);
                  toast.success(`Restored “${version.label}”.`);
                }}
              >
                Restore
              </Button>
              <button
                type="button"
                aria-label={`Delete version ${version.label}`}
                onClick={() => deleteVersion(version.id)}
                className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-danger"
              >
                <Trash className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      </div>
    </Modal>
  );
}
