"use client";

/**
 * DataSource wiring: one DuckDB-WASM instance for the whole page.
 * Exposed as a module singleton so WebMCP tools (packages/studio) and tile
 * renderers query the same engine.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { DuckDBDataSource, type DatasetMeta } from "@kontier-ri/datasource";
import { withBasePath } from "@/lib/base-path";

// Bundles are copied into public/duckdb/ by scripts/copy-duckdb.mjs
// (predev/prebuild), so DuckDB loads same-origin with jsDelivr as fallback.
export const dataSource = new DuckDBDataSource({
  bundlesBaseURL: withBasePath("/duckdb/"),
});

/**
 * Uploaded datasets live in in-memory DuckDB and do NOT survive a reload,
 * while dashboards (localStorage) do. Rewrite DuckDB's missing-table error
 * into an actionable message so restored tiles explain themselves instead of
 * surfacing a raw catalog error.
 */
const MISSING_TABLE_RE =
  /Table with name (\S+) does not exist/i;

function rewriteMissingDataset(err: unknown): unknown {
  const msg = err instanceof Error ? err.message : String(err);
  const m = MISSING_TABLE_RE.exec(msg);
  const raw = m?.[1];
  if (!raw) return err;
  const name = raw.replaceAll('"', "").replaceAll("!", "");
  return new Error(
    `Dataset “${name}” is gone — uploads live only for this browser session. Re-upload ${name} (CSV/Parquet) to restore this tile.`,
  );
}

const rawRunQuery = dataSource.runQuery.bind(dataSource);
dataSource.runQuery = async (sql: string) => {
  try {
    return await rawRunQuery(sql);
  } catch (err) {
    throw rewriteMissingDataset(err);
  }
};

const DEMO_FILES: { name: string; group: string }[] = [
  { name: "plans", group: "saas_billing" },
  { name: "customers", group: "saas_billing" },
  { name: "subscriptions", group: "saas_billing" },
  { name: "invoices", group: "saas_billing" },
  { name: "charges", group: "payments" },
];

export type DataStatus = "booting" | "ready" | "error";

interface DataContextValue {
  status: DataStatus;
  statusDetail: string;
  datasets: DatasetMeta[];
  /** Bumped after every import; tiles use it to re-query. */
  dataVersion: number;
  importFiles: (files: FileList | File[]) => Promise<DatasetMeta[]>;
}

const DataContext = createContext<DataContextValue | null>(null);

export function useDataSource(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useDataSource must be used inside <DataProvider>");
  return ctx;
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<DataStatus>("booting");
  const [statusDetail, setStatusDetail] = useState("Booting DuckDB-WASM…");
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const [dataVersion, setDataVersion] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        for (const f of DEMO_FILES) {
          setStatusDetail(`Loading ${f.name}.csv…`);
          await dataSource.importFromURL(
            f.name,
            withBasePath(`/demo/${f.name}.csv`),
            "csv",
            f.group,
          );
        }
        setDatasets(await dataSource.listDatasets());
        setDataVersion((v) => v + 1);
        setStatus("ready");
        setStatusDetail("Demo data loaded");
      } catch (err) {
        setStatus("error");
        setStatusDetail(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  const importFiles = useCallback(async (files: FileList | File[]) => {
    const imported: DatasetMeta[] = [];
    for (const file of Array.from(files)) {
      imported.push(await dataSource.importFile(file));
    }
    setDatasets(await dataSource.listDatasets());
    setDataVersion((v) => v + 1);
    return imported;
  }, []);

  const value = useMemo(
    () => ({ status, statusDetail, datasets, dataVersion, importFiles }),
    [status, statusDetail, datasets, dataVersion, importFiles],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
