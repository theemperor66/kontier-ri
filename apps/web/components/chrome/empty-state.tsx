"use client";

import { useRef } from "react";
import {
  ArrowRight,
  Check,
  Database,
  Layout,
  MagnifyingGlass,
  Plugs,
  Scan,
  Sparkle,
  UploadSimple,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useDashboardStore } from "@/lib/dashboard-store";
import { useDataSource } from "@/lib/datasource";
import { useScaleDemo } from "@/lib/scale-demo";
import { useUiState } from "@/lib/ui-state";
import { useWebMCPRegistry } from "@/lib/webmcp-registry";

const DEMO_BRIEF =
  "Explain the March churn spike. Show the evidence on the canvas, and ask for my judgment before making a business assumption.";

const STEPS = [
  {
    Icon: Scan,
    title: "You set the question and point.",
    body: "Write the brief, brush a dip, select a tile or set a filter. That exact focus becomes structured agent context.",
    tone: "ink" as const,
  },
  {
    Icon: MagnifyingGlass,
    title: "The agent works in the open.",
    body: "Its plan, local SQL, canvas edits and open questions stay visible while you keep using the dashboard.",
    tone: "accent" as const,
  },
  {
    Icon: Check,
    title: "You decide what becomes true.",
    body: "Answer decisions, approve evidence, edit the result or undo it. The outcome is a real, reusable report.",
    tone: "ok" as const,
  },
];

export function EmptyState({ onLoadDemo }: { onLoadDemo: () => void }) {
  const { importFiles, status } = useDataSource();
  const startWorkSession = useDashboardStore((s) => s.startWorkSession);
  const setTemplatesOpen = useUiState((s) => s.setTemplatesOpen);
  const setAgentPanelOpen = useUiState((s) => s.setAgentPanelOpen);
  const { runtimeAvailable, readyCount, failedTools } = useWebMCPRegistry();
  const scaleDemo = useScaleDemo();
  const fileRef = useRef<HTMLInputElement>(null);
  const agentReady = runtimeAvailable && readyCount > 0 && failedTools.length === 0;

  const openInvestigation = () => {
    onLoadDemo();
    startWorkSession(DEMO_BRIEF);
    setAgentPanelOpen(true);
  };

  return (
    <div
      data-canvas-root
      className="min-h-0 flex-1 overflow-y-auto px-1 pb-8 pt-1.5"
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3 pb-5">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-[30px] font-semibold leading-[1.1] tracking-[-0.02em]">
            Start an investigation
          </h1>
          <p className="max-w-[64ch] text-[15px] text-muted-foreground">
            The analytics workspace of the{" "}
            <a
              href="https://kontier.eu"
              target="_blank"
              rel="noreferrer"
              className="underline decoration-line-2 underline-offset-2 hover:text-foreground"
            >
              Kontier
            </a>{" "}
            billing platform. Point at a revenue signal and resolve it with your
            browser agent on one canvas — the query engine runs in this tab, so
            raw rows never leave it.
          </p>
        </div>
        <span className="ml-auto flex h-[38px] shrink-0 items-center gap-2 rounded-[9px] border border-line bg-card px-3 text-[13px] text-muted-foreground">
          <span
            className={`size-[7px] rounded-full ${
              agentReady ? "status-pulse bg-ok" : "bg-faint"
            }`}
          />
          {agentReady ? `Agent connected · ${readyCount} tools` : "Human mode ready"}
        </span>
      </div>

      <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1.05fr)_minmax(21rem,0.95fr)]">
        <section className="rounded-xl border border-line bg-card p-6 shadow-card">
          <h2 className="text-lg font-semibold">Open the demo investigation</h2>
          <p className="mt-1.5 max-w-[52ch] text-[13.5px] leading-relaxed text-muted-foreground">
            Loads 24 months of synthetic SaaS billing data, opens the churn
            brief, and hands your agent a finish line it can read through
            <code className="mx-1 font-mono text-[11.5px]">get_work_context</code>.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <Button
              data-testid="load-demo"
              disabled={status !== "ready"}
              onClick={openInvestigation}
              className="h-10 justify-between gap-4 px-4"
            >
              <span className="flex items-center gap-2">
                <Sparkle weight="fill" className="size-4" />
                {status === "ready" ? "Open investigation demo" : "Preparing local data…"}
              </span>
              <ArrowRight className="size-4" />
            </Button>
            <Button
              variant="outline"
              className="h-10"
              onClick={() => fileRef.current?.click()}
            >
              <UploadSimple className="size-4" /> Use my data
            </Button>
            {/* The scale proof used to be a grey text link under a stat block
                that advertised 16,160 rows. It is the strongest single claim
                this product can make, so it gets a real control. */}
            <Button
              variant="outline"
              className="h-10"
              data-testid="load-scale-demo"
              disabled={status !== "ready" || scaleDemo.loading}
              onClick={scaleDemo.load}
            >
              <Database className="size-4" />
              {scaleDemo.loading ? "Counting 100M rows…" : "Query 100M rows"}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.parquet"
              multiple
              className="hidden"
              onChange={async (event) => {
                const files = event.target.files;
                if (files && files.length > 0) {
                  try {
                    const imported = await importFiles(files);
                    toast.success(
                      `Imported ${imported.map((dataset) => dataset.name).join(", ")} — set a brief in the agent panel.`,
                    );
                    setAgentPanelOpen(true);
                  } catch (error) {
                    toast.error(
                      `Import failed: ${error instanceof Error ? error.message : String(error)}`,
                    );
                  }
                }
                event.target.value = "";
              }}
            />
          </div>

          <dl className="mt-6 grid grid-cols-3 gap-3 border-t border-line pt-4">
            {[
              ["100M rows", "queried live over HTTP in this tab — no server"],
              ["0 bytes", "of your data ever leave the browser"],
              [
                agentReady ? `${readyCount} tools` : "46 tools",
                "registered for your agent over WebMCP",
              ],
            ].map(([value, note]) => (
              <div key={value}>
                <dt className="text-[15px] font-semibold tracking-[-0.01em]">{value}</dt>
                <dd className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
                  {note}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-4 text-[13px] text-muted-foreground">
            <button
              type="button"
              data-testid="browse-templates"
              disabled={status !== "ready"}
              onClick={() => setTemplatesOpen(true)}
              className="inline-flex cursor-pointer items-center gap-1.5 transition-colors hover:text-foreground disabled:opacity-50"
            >
              <Layout className="size-3.5" /> Browse report templates
            </button>

            {!agentReady ? (
              <span className="inline-flex items-center gap-1.5">
                <Plugs className="size-3.5" />
                Agent tools appear in the ChatGPT browser or Chrome 149+ with{" "}
                <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[11px]">
                  chrome://flags/#enable-webmcp-testing
                </code>
              </span>
            ) : null}
          </div>
        </section>

        <section
          aria-label="How a shared investigation works"
          className="rounded-xl border border-line bg-card p-6 shadow-card"
        >
          <h2 className="text-lg font-semibold">One canvas. Two kinds of hands.</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            The page itself is the shared working memory.
          </p>
          <ol className="relative mt-5 space-y-5 before:absolute before:bottom-4 before:left-[15px] before:top-4 before:w-px before:bg-line">
            {STEPS.map((step) => (
              <li key={step.title} className="relative flex gap-3.5">
                <span
                  className={`relative z-10 grid size-8 shrink-0 place-items-center rounded-lg ${
                    step.tone === "ink"
                      ? "bg-nav text-white"
                      : step.tone === "accent"
                        ? "bg-primary text-primary-foreground"
                        : "bg-ok text-white"
                  }`}
                >
                  <step.Icon className="size-3.5" weight="bold" />
                </span>
                <div>
                  <h3 className="text-[13.5px] font-semibold">{step.title}</h3>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-5 flex items-center gap-2 border-t border-line pt-3.5 text-[11.5px] text-muted-foreground">
            <Check className="size-3.5 text-ok" />
            Local SQL · explicit decisions · attributed edits · one-click undo
          </p>
        </section>
      </div>
    </div>
  );
}
