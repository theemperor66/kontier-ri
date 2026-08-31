"use client";

/**
 * WebMCP status pill: green when `document.modelContext` (or the
 * `navigator.modelContext` fallback) is present. Tool inventory comes from
 * @kontier-ri/studio: STATIC_TOOL_NAMES always mounted, +3 dynamic tools
 * while a tile is selected.
 */

import { useEffect, useState } from "react";
import { Circle, Plugs, PlugsConnected } from "@phosphor-icons/react";
import { DYNAMIC_TOOL_NAMES, STATIC_TOOL_NAMES } from "@kontier-ri/studio";
import { useDashboardStore } from "@/lib/dashboard-store";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

function detectModelContext(): boolean {
  if (typeof document === "undefined") return false;
  const d = document as Document & { modelContext?: unknown };
  const n = navigator as Navigator & { modelContext?: unknown };
  return d.modelContext != null || n.modelContext != null;
}

export function WebMCPStatus() {
  const [present, setPresent] = useState(false);
  const hasSelection = useDashboardStore((s) => s.selectedTileId != null);

  useEffect(() => {
    const read = () => setPresent(detectModelContext());
    read();
    const interval = setInterval(read, 2000);
    return () => clearInterval(interval);
  }, []);

  const tools: string[] = present
    ? [
        ...STATIC_TOOL_NAMES,
        ...(hasSelection ? DYNAMIC_TOOL_NAMES : []),
      ]
    : [];
  const label = present ? `WebMCP · ${tools.length} tools` : "WebMCP off";

  return (
    <Tooltip
      content={
        present ? (
          <div className="space-y-1">
            <p className="font-medium">
              Registered tools{hasSelection ? " (incl. selection tools)" : ""}
            </p>
            <ul className="grid grid-cols-2 gap-x-3 font-mono text-[10px] leading-4">
              {tools.map((t) => (
                <li key={t} className="break-all">
                  {t}
                </li>
              ))}
            </ul>
            {!hasSelection ? (
              <p className="text-muted-foreground">
                +{DYNAMIC_TOOL_NAMES.length} more while a tile is selected.
              </p>
            ) : null}
          </div>
        ) : (
          <span>
            No agent interface. Open this page in the ChatGPT browser or Chrome
            149+ with <code>chrome://flags/#enable-webmcp-testing</code>.
          </span>
        )
      }
    >
      <span
        data-testid="webmcp-status"
        className={cn(
          "inline-flex h-8 cursor-default items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium",
          present
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
            : "border-border text-muted-foreground",
        )}
      >
        {present ? (
          <PlugsConnected className="size-3.5" />
        ) : (
          <Plugs className="size-3.5" />
        )}
        <Circle
          weight="fill"
          className={cn(
            "size-1.5",
            present ? "status-pulse text-emerald-500" : "text-muted-foreground/50",
          )}
        />
        {label}
      </span>
    </Tooltip>
  );
}
