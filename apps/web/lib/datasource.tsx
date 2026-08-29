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

export const dataSource = new DuckDBDataSource();

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
          await dataSource.importFromURL(f.name, `/demo/${f.name}.csv`, "csv", f.group);
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
