"use client";

/**
 * WebMCP status pill: green when `document.modelContext` (or the
 * `navigator.modelContext` fallback) is present. The tooltip lists the tools
 * registered by the studio (reported on `window.__kontierRiTools` /
 * `kontier-ri:tools` events; falls back to a presence-only message).
 */

import { useEffect, useState } from "react";
import { Circle, Plugs, PlugsConnected } from "@phosphor-icons/react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

declare global {
  interface Window {
    __kontierRiTools?: string[];
  }
}

function detectModelContext(): boolean {
  if (typeof document === "undefined") return false;
  const d = document as Document & { modelContext?: unknown };
  const n = navigator as Navigator & { modelContext?: unknown };
  return d.modelContext != null || n.modelContext != null;
}

export function WebMCPStatus() {
  const [present, setPresent] = useState(false);
  const [tools, setTools] = useState<string[]>([]);

  useEffect(() => {
    const read = () => {
      setPresent(detectModelContext());
      setTools(window.__kontierRiTools ?? []);
    };
    read();
    const interval = setInterval(read, 2000);
    const onTools = (e: Event) => {
      const detail = (e as CustomEvent<string[]>).detail;
      if (Array.isArray(detail)) setTools(detail);
    };
    window.addEventListener("kontier-ri:tools", onTools);
    return () => {
      clearInterval(interval);
      window.removeEventListener("kontier-ri:tools", onTools);
    };
  }, []);

  const connected = present;
  const label = connected
    ? tools.length > 0
      ? `WebMCP · ${tools.length} tools`
      : "WebMCP ready"
    : "WebMCP off";

  return (
    <Tooltip
      content={
        connected ? (
          tools.length > 0 ? (
            <div className="space-y-1">
              <p className="font-medium">Registered tools</p>
              <ul className="grid grid-cols-2 gap-x-3 font-mono text-[10px] leading-4">
                {tools.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          ) : (
            "Agent interface detected. Tools register when the studio mounts."
          )
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
          connected
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
            : "border-border text-muted-foreground",
        )}
      >
        {connected ? (
          <PlugsConnected className="size-3.5" />
        ) : (
          <Plugs className="size-3.5" />
        )}
        <Circle
          weight="fill"
          className={cn(
            "size-1.5",
            connected ? "status-pulse text-emerald-500" : "text-muted-foreground/50",
          )}
        />
        {label}
      </span>
    </Tooltip>
  );
}
