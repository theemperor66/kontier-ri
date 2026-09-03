"use client";

/**
 * Agent diagnostics: the page reporting its own WebMCP state.
 *
 * Why this exists as a product surface and not a console log: the ChatGPT
 * in-app browser has no devtools. When a tool fails to register there, the
 * only way anyone — user, judge, or the developer — can see why is if the page
 * says so itself, in copyable text.
 *
 * Every value here is read live. Nothing is inferred, defaulted or faked; an
 * unknown reads "unknown".
 */

import { useEffect, useMemo, useState } from "react";
import { CheckCircle, Copy, Warning, XCircle } from "@phosphor-icons/react";
import { toast } from "sonner";
import { DYNAMIC_TOOL_NAMES, STATIC_TOOL_NAMES } from "@kontier-ri/studio";
import { Modal } from "@/components/chrome/modal";
import { Button } from "@/components/ui/button";
import { useDashboardStore } from "@/lib/dashboard-store";
import { useDataSource } from "@/lib/datasource";
import { useUiState } from "@/lib/ui-state";
import { useWebMCPRegistry } from "@/lib/webmcp-registry";
import { cn } from "@/lib/utils";

/** A single observed fact about the host. `null` means "could not read". */
interface HostFacts {
  documentModelContext: boolean;
  navigatorModelContext: boolean;
  secureContext: boolean | null;
  crossOriginIsolated: boolean | null;
  userAgent: string;
  href: string;
  wasmSupported: boolean;
  sharedArrayBuffer: boolean;
  observedAt: string;
}

function readHostFacts(): HostFacts {
  const doc = typeof document === "undefined" ? undefined : (document as Document & { modelContext?: unknown });
  const nav = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { modelContext?: unknown });
  return {
    documentModelContext: Boolean(doc?.modelContext),
    navigatorModelContext: Boolean(nav?.modelContext),
    secureContext: typeof window === "undefined" ? null : window.isSecureContext,
    crossOriginIsolated:
      typeof window === "undefined" || !("crossOriginIsolated" in window)
        ? null
        : window.crossOriginIsolated,
    userAgent: nav?.userAgent ?? "unknown",
    href: typeof window === "undefined" ? "unknown" : window.location.href,
    wasmSupported: typeof WebAssembly !== "undefined",
    sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
    observedAt: new Date().toISOString(),
  };
}

function Row({
  label,
  value,
  tone = "neutral",
  mono,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "bad" | "neutral";
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line/60 py-1.5 last:border-0">
      <span className="shrink-0 text-[12px] text-muted-foreground">{label}</span>
      <span
        className={cn(
          "min-w-0 break-words text-right text-[12px] font-medium",
          mono && "font-mono text-[11px]",
          tone === "ok" && "text-ok",
          tone === "warn" && "text-warn",
          tone === "bad" && "text-destructive",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function yesNo(value: boolean | null): { text: string; tone: "ok" | "bad" | "neutral" } {
  if (value === null) return { text: "unknown", tone: "neutral" };
  return value ? { text: "yes", tone: "ok" } : { text: "no", tone: "bad" };
}

export function AgentDiagnostics() {
  const open = useUiState((s) => s.diagnosticsOpen);
  const setOpen = useUiState((s) => s.setDiagnosticsOpen);
  const hasSelection = useDashboardStore((s) => s.selectedTileId != null);
  const { runtimeAvailable, tools, readyCount, registeringCount, failedTools } =
    useWebMCPRegistry();
  const { status: engineStatus } = useDataSource();
  const [facts, setFacts] = useState<HostFacts | null>(null);

  // Re-read while the dialog is open: a host may inject modelContext late.
  useEffect(() => {
    if (!open) return;
    setFacts(readHostFacts());
    const id = setInterval(() => setFacts(readHostFacts()), 1000);
    return () => clearInterval(id);
  }, [open]);

  // `?diag=1` opens it directly, so a bug report can be a single URL.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("diag") === "1") {
      setOpen(true);
    }
  }, [setOpen]);

  const expected = useMemo(
    () => [...STATIC_TOOL_NAMES, ...(hasSelection ? DYNAMIC_TOOL_NAMES : [])],
    [hasSelection],
  );
  const missing = useMemo(
    () => expected.filter((name) => !(name in tools)),
    [expected, tools],
  );

  const report = useMemo(() => {
    if (!facts) return "";
    const lines = [
      "Kontier RI — agent diagnostics",
      `observed_at: ${facts.observedAt}`,
      `url: ${facts.href}`,
      `user_agent: ${facts.userAgent}`,
      "",
      "[webmcp runtime]",
      `document.modelContext: ${facts.documentModelContext}`,
      `navigator.modelContext: ${facts.navigatorModelContext}`,
      `runtime_available: ${runtimeAvailable}`,
      "",
      "[tools]",
      `expected: ${expected.length} (static ${STATIC_TOOL_NAMES.length}${
        hasSelection ? ` + selection ${DYNAMIC_TOOL_NAMES.length}` : ""
      })`,
      `ready: ${readyCount}`,
      `registering: ${registeringCount}`,
      `failed: ${failedTools.length}`,
      `never_reported: ${missing.length}${missing.length ? ` (${missing.join(", ")})` : ""}`,
      ...failedTools.map((item) => `  FAILED ${item.name}: ${item.error}`),
      "",
      "[host]",
      `secure_context: ${facts.secureContext}`,
      `cross_origin_isolated: ${facts.crossOriginIsolated}`,
      `webassembly: ${facts.wasmSupported}`,
      `shared_array_buffer: ${facts.sharedArrayBuffer}`,
      `data_engine: ${engineStatus}`,
    ];
    return lines.join("\n");
  }, [
    engineStatus,
    expected.length,
    facts,
    failedTools,
    hasSelection,
    missing,
    readyCount,
    registeringCount,
    runtimeAvailable,
  ]);

  const allReady =
    runtimeAvailable && readyCount >= expected.length && failedTools.length === 0;

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Agent diagnostics"
      testId="agent-diagnostics"
      className="max-w-2xl"
    >
      <div className="space-y-4 p-4">
        <div
          className={cn(
            "flex items-start gap-2.5 rounded-lg border p-3",
            allReady
              ? "border-ok/30 bg-ok-soft"
              : failedTools.length > 0
                ? "border-destructive/30 bg-destructive/10"
                : "border-line bg-surface-2",
          )}
        >
          {allReady ? (
            <CheckCircle weight="fill" className="mt-px size-4 shrink-0 text-ok" />
          ) : failedTools.length > 0 ? (
            <XCircle weight="fill" className="mt-px size-4 shrink-0 text-destructive" />
          ) : (
            <Warning weight="fill" className="mt-px size-4 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0 text-[12.5px] leading-relaxed">
            <p className="font-medium">
              {allReady
                ? `WebMCP is live: ${readyCount} tools registered in this page.`
                : failedTools.length > 0
                  ? `${failedTools.length} tool${failedTools.length === 1 ? "" : "s"} failed to register.`
                  : runtimeAvailable
                    ? `Registering: ${readyCount} of ${expected.length} ready.`
                    : "No WebMCP runtime in this browser — human mode only."}
            </p>
            {!runtimeAvailable ? (
              <p className="mt-1 text-muted-foreground">
                Open this page in the ChatGPT browser, or Chrome 149+ with{" "}
                <code className="font-mono text-[11px]">
                  chrome://flags/#enable-webmcp-testing
                </code>
                . Every human feature works without it.
              </p>
            ) : null}
          </div>
        </div>

        <section>
          <h3 className="mb-1 text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            WebMCP runtime
          </h3>
          <Row
            label="document.modelContext"
            {...(() => {
              const v = yesNo(facts?.documentModelContext ?? null);
              return { value: v.text, tone: v.tone };
            })()}
          />
          <Row
            label="navigator.modelContext (fallback)"
            {...(() => {
              const v = yesNo(facts?.navigatorModelContext ?? null);
              return { value: v.text, tone: v.tone === "bad" ? "neutral" : v.tone };
            })()}
          />
          <Row
            label="Tools expected"
            value={`${expected.length}${hasSelection ? " (tile selected)" : ""}`}
          />
          <Row
            label="Tools ready"
            value={String(readyCount)}
            tone={readyCount >= expected.length ? "ok" : "warn"}
          />
          <Row
            label="Tools failed"
            value={String(failedTools.length)}
            tone={failedTools.length ? "bad" : "ok"}
          />
          <Row
            label="Never reported"
            value={String(missing.length)}
            tone={missing.length ? "warn" : "ok"}
          />
          <Row label="Local data engine" value={engineStatus} />
        </section>

        {failedTools.length > 0 ? (
          <section>
            <h3 className="mb-1 text-[11.5px] font-medium uppercase tracking-[0.08em] text-destructive">
              Registration failures
            </h3>
            <ul className="space-y-1 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 font-mono text-[11px] leading-4">
              {failedTools.map((item) => (
                <li key={item.name}>
                  <span className="font-medium">{item.name}</span>: {item.error}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section>
          <h3 className="mb-1 text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Host
          </h3>
          <Row
            label="Secure context"
            {...(() => {
              const v = yesNo(facts?.secureContext ?? null);
              return { value: v.text, tone: v.tone };
            })()}
          />
          <Row
            label="Cross-origin isolated"
            {...(() => {
              const v = yesNo(facts?.crossOriginIsolated ?? null);
              return { value: v.text, tone: "neutral" as const };
            })()}
          />
          <Row
            label="WebAssembly"
            {...(() => {
              const v = yesNo(facts?.wasmSupported ?? null);
              return { value: v.text, tone: v.tone };
            })()}
          />
          <Row label="User agent" value={facts?.userAgent ?? "reading…"} mono />
        </section>

        <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
          <p className="text-[11.5px] text-muted-foreground">
            Read live from this page. Paste this into a bug report.
          </p>
          <Button
            variant="outline"
            size="sm"
            data-testid="copy-diagnostics"
            onClick={() => {
              void navigator.clipboard
                .writeText(report)
                .then(() => toast.success("Diagnostics copied."))
                .catch(() => toast.error("Clipboard blocked by this browser."));
            }}
          >
            <Copy className="size-3.5" /> Copy report
          </Button>
        </div>
      </div>
    </Modal>
  );
}
