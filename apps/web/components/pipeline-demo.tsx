"use client";

import { useEffect, useRef, useState } from "react";
import { DuckDBDataSource, type DatasetMeta } from "@kontier-ri/datasource";

const DEMO_FILES: { name: string; group: string }[] = [
  { name: "plans", group: "saas_billing" },
  { name: "customers", group: "saas_billing" },
  { name: "subscriptions", group: "saas_billing" },
  { name: "invoices", group: "saas_billing" },
  { name: "charges", group: "payments" },
];

type State =
  | { phase: "loading"; detail: string }
  | { phase: "error"; detail: string }
  | { phase: "ready"; datasets: DatasetMeta[]; probe: string };

export function PipelineDemo() {
  const [state, setState] = useState<State>({
    phase: "loading",
    detail: "Booting DuckDB-WASM…",
  });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const ds = new DuckDBDataSource();
        for (const f of DEMO_FILES) {
          setState({ phase: "loading", detail: `Importing ${f.name}.csv…` });
          await ds.importFromURL(f.name, `/demo/${f.name}.csv`, "csv", f.group);
        }
        const datasets = await ds.listDatasets();
        // Prove SQL works end-to-end (read-only guard + row cap included).
        const res = await ds.runQuery(
          "SELECT month, round(sum(amount_eur)) AS mrr_eur FROM invoices WHERE status = 'paid' GROUP BY 1 ORDER BY 1 DESC LIMIT 1",
        );
        const [month, mrr] = res.rows[0] ?? ["?", "?"];
        setState({
          phase: "ready",
          datasets,
          probe: `Latest month ${String(month)}: ${Number(mrr).toLocaleString("en-US")} EUR paid MRR (via runQuery)`,
        });
      } catch (err) {
        setState({
          phase: "error",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  }, []);

  if (state.phase === "loading") {
    return (
      <p className="text-sm text-muted-foreground animate-pulse">{state.detail}</p>
    );
  }
  if (state.phase === "error") {
    return (
      <p className="text-sm text-destructive" role="alert">
        Pipeline error: {state.detail}
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 pr-4 font-medium">Dataset</th>
            <th className="py-2 pr-4 font-medium">Group</th>
            <th className="py-2 pr-4 font-medium text-right">Rows</th>
            <th className="py-2 font-medium text-right">Columns</th>
          </tr>
        </thead>
        <tbody>
          {state.datasets.map((d) => (
            <tr key={d.name} className="border-b border-border/50">
              <td className="py-2 pr-4 font-mono">{d.name}</td>
              <td className="py-2 pr-4 text-muted-foreground">{d.group}</td>
              <td className="py-2 pr-4 text-right tabular-nums">
                {d.rowCount.toLocaleString("en-US")}
              </td>
              <td className="py-2 text-right tabular-nums">{d.columns.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-muted-foreground">{state.probe}</p>
    </div>
  );
}
