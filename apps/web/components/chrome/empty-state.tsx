"use client";

import { useRef } from "react";
import {
  CursorClick,
  Robot,
  Sparkle,
  UploadSimple,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useDataSource } from "@/lib/datasource";

const SUGGESTED_PROMPTS = [
  "Profile my data and build a revenue dashboard.",
  "Show me MRR by month and find the churn spike.",
  "Why did churn spike? Add a drill-down chart.",
  "Add a KPI for average revenue per customer.",
] as const;

export function EmptyState({ onLoadDemo }: { onLoadDemo: () => void }) {
  const { importFiles, status } = useDataSource();
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex min-h-[70dvh] items-center justify-center px-4">
      <div className="w-full max-w-xl text-center">
        <div className="mx-auto mb-6 flex size-14 items-center justify-center rounded-2xl border border-violet-500/30 bg-violet-500/10">
          <Robot weight="duotone" className="size-7 text-violet-500 dark:text-violet-300" />
        </div>
        <h1 className="text-balance text-2xl font-semibold tracking-tight">
          Build dashboards <span className="text-violet-500 dark:text-violet-300">with</span> your AI agent
        </h1>
        <p className="mx-auto mt-3 max-w-md text-pretty text-sm leading-relaxed text-muted-foreground">
          This page registers WebMCP tools for AI agents. Open it in the{" "}
          <strong className="font-medium text-foreground">ChatGPT browser</strong> or in{" "}
          <strong className="font-medium text-foreground">Chrome 149+</strong> with{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            chrome://flags/#enable-webmcp-testing
          </code>{" "}
          and ask your agent to build a revenue dashboard. You drag, restyle and
          brush; the agent queries and drafts tiles. SQL runs locally in your
          browser — raw data never leaves the page.
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
          <Button
            size="default"
            data-testid="load-demo"
            disabled={status !== "ready"}
            onClick={onLoadDemo}
          >
            <Sparkle weight="fill" className="size-4" />
            {status === "ready" ? "Load demo dashboard" : "Loading demo data…"}
          </Button>
          <Button
            variant="outline"
            onClick={() => fileRef.current?.click()}
          >
            <UploadSimple className="size-4" />
            Upload CSV / Parquet
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.parquet"
            multiple
            className="hidden"
            onChange={async (e) => {
              const files = e.target.files;
              if (files && files.length > 0) {
                try {
                  const imported = await importFiles(files);
                  toast.success(
                    `Imported ${imported.map((d) => d.name).join(", ")} — ask your agent to chart it.`,
                  );
                } catch (err) {
                  toast.error(
                    `Import failed: ${err instanceof Error ? err.message : String(err)}`,
                  );
                }
              }
              e.target.value = "";
            }}
          />
        </div>
        <div className="mt-6">
          <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <CursorClick className="size-3.5" />
            Try asking — click to copy:
          </p>
          <div className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5">
            {SUGGESTED_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className="rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-violet-500/40 hover:bg-violet-500/10 hover:text-foreground"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(prompt)
                    .then(() => toast.success("Copied — paste it to your agent."))
                    .catch(() => toast.error("Could not access the clipboard."));
                }}
              >
                “{prompt}”
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
