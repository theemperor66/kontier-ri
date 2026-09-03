"use client";

import { Circle, Plugs, PlugsConnected, Warning } from "@phosphor-icons/react";
import { DYNAMIC_TOOL_NAMES, STATIC_TOOL_NAMES } from "@kontier-ri/studio";
import { useDashboardStore } from "@/lib/dashboard-store";
import { useUiState } from "@/lib/ui-state";
import { useWebMCPRegistry } from "@/lib/webmcp-registry";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function WebMCPStatus() {
  const hasSelection = useDashboardStore((s) => s.selectedTileId != null);
  const openDiagnostics = useUiState((s) => s.setDiagnosticsOpen);
  const {
    runtimeAvailable,
    tools,
    readyCount,
    registeringCount,
    failedTools,
  } = useWebMCPRegistry();
  const expectedCount = STATIC_TOOL_NAMES.length + (hasSelection ? DYNAMIC_TOOL_NAMES.length : 0);
  const failed = failedTools.length > 0;
  const ready =
    runtimeAvailable &&
    readyCount >= expectedCount &&
    registeringCount === 0 &&
    !failed;
  const partial = runtimeAvailable && readyCount > 0 && !ready && !failed;
  const label = failed
    ? "Agent setup issue"
    : ready
      ? "Agent ready"
      : partial || registeringCount > 0
        ? `Connecting ${readyCount}/${expectedCount}`
        : "Connect agent";

  return (
    <Tooltip
      content={
        failed ? (
          <div className="max-w-80 space-y-2">
            <p className="font-medium">Some WebMCP tools did not register.</p>
            <ul className="space-y-1 font-mono text-[10px] leading-4">
              {failedTools.slice(0, 6).map((item) => (
                <li key={item.name}>
                  <span className="text-foreground">{item.name}</span>: {item.error}
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground">
              Reload once. If this continues, check the browser’s WebMCP flag,
              secure-context policy, and duplicate tool registrations.
            </p>
          </div>
        ) : ready ? (
          <div className="max-w-72 space-y-1.5">
            <p className="font-medium">WebMCP registration verified</p>
            <p className="text-muted-foreground">
              {readyCount} tools are registered successfully in this page.
              {hasSelection
                ? " The selected tile added contextual edit tools."
                : ` Select a tile to expose ${DYNAMIC_TOOL_NAMES.length} contextual tools.`}
            </p>
          </div>
        ) : runtimeAvailable ? (
          <div className="space-y-1">
            <p className="font-medium">Registering WebMCP tools</p>
            <p className="text-muted-foreground">
              {readyCount} of {expectedCount} ready. This status reports real
              registration results, not feature detection alone.
            </p>
          </div>
        ) : (
          <span>
            Open this page in the ChatGPT browser or Chrome 149+ with{" "}
            <code>chrome://flags/#enable-webmcp-testing</code>. Human mode stays
            fully available.
          </span>
        )
      }
    >
      <button
        type="button"
        data-testid="webmcp-status"
        data-ready-count={readyCount}
        data-expected-count={expectedCount}
        aria-label={`${label}. Open agent diagnostics.`}
        onClick={() => openDiagnostics(true)}
        className={cn(
          "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-opacity hover:opacity-90",
          failed
            ? "border-destructive/30 bg-destructive/10 text-destructive"
            : ready
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : partial || registeringCount > 0
                ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                : "border-border text-muted-foreground",
        )}
      >
        {failed ? (
          <Warning weight="fill" className="size-3.5" />
        ) : ready ? (
          <PlugsConnected className="size-3.5" />
        ) : (
          <Plugs className="size-3.5" />
        )}
        <Circle
          weight="fill"
          className={cn(
            "size-1.5",
            ready
              ? "status-pulse text-emerald-500"
              : failed
                ? "text-destructive"
                : partial || registeringCount > 0
                  ? "animate-pulse text-amber-500"
                  : "text-muted-foreground/50",
          )}
        />
        {label}
        <span className="sr-only">
          {Object.keys(tools).length} tool states observed.
        </span>
      </button>
    </Tooltip>
  );
}
