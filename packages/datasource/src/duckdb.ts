/// <reference path="./duckdb-browser-bundle.d.ts" />
import type * as duckdb from "@duckdb/duckdb-wasm";

/**
 * Load the browser ESM bundle explicitly. The package's "." export resolves
 * to dist/duckdb-node.cjs under the "node" condition, whose dynamic requires
 * crash Turbopack's SSR chunking (and it is useless in the browser anyway).
 */
async function loadDuckDB(): Promise<typeof duckdb> {
  return (await import(
    "@duckdb/duckdb-wasm/dist/duckdb-browser.mjs"
  )) as unknown as typeof duckdb;
}
import { applyRowCap, assertReadOnly, quoteIdent } from "./guard";
import { buildStatsSQL, buildTopValuesSQL, shapeProfile } from "./profile";
import type {
  ColumnMeta,
  ColumnProfile,
  DataSource,
  DatasetMeta,
  QueryResult,
} from "./types";

export const DEFAULT_MAX_ROWS = 10_000;

export interface DuckDBDataSourceOptions {
  maxRows?: number;
  logLevel?: duckdb.LogLevel;
}

interface TableLike {
  schema: { fields: { name: string; type: unknown; nullable: boolean }[] };
  toArray(): { toJSON(): Record<string, unknown> }[];
  numRows: number;
}

function toJsonValue(v: unknown): unknown {
  if (typeof v === "bigint") {
    return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(v)
      : v.toString();
  }
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Uint8Array) return Array.from(v);
  if (Array.isArray(v)) return v.map(toJsonValue);
  return v;
}

/**
 * DataSource backed by DuckDB-WASM. Fully in-browser: raw data never leaves
 * the page. Lazily instantiates the engine on first use.
 */
export class DuckDBDataSource implements DataSource {
  private dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;
  private readonly datasets = new Map<string, DatasetMeta>();
  private readonly maxRows: number;
  private readonly logLevel: duckdb.LogLevel;

  constructor(options: DuckDBDataSourceOptions = {}) {
    this.maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
    this.logLevel = options.logLevel ?? (3 satisfies duckdb.LogLevel); // WARNING
  }

  /** Lazy engine init (jsDelivr bundles + blob worker; browser only). */
  private getDB(): Promise<duckdb.AsyncDuckDB> {
    if (!this.dbPromise) {
      this.dbPromise = (async () => {
        const mod = await loadDuckDB();
        const bundles = mod.getJsDelivrBundles();
        const bundle = await mod.selectBundle(bundles);
        if (!bundle.mainWorker) {
          throw new Error("DuckDB-WASM: no worker bundle available.");
        }
        const workerUrl = URL.createObjectURL(
          new Blob([`importScripts("${bundle.mainWorker}");`], {
            type: "text/javascript",
          }),
        );
        const worker = new Worker(workerUrl);
        const db = new mod.AsyncDuckDB(new mod.ConsoleLogger(this.logLevel), worker);
        await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
        URL.revokeObjectURL(workerUrl);
        return db;
      })();
    }
    return this.dbPromise;
  }

  /**
   * Execute SQL and return plain JSON-ish rows. Overridable in tests.
   * NOT guarded — internal use only.
   */
  protected async exec(sql: string): Promise<{ columns: ColumnMeta[]; rows: unknown[][] }> {
    const db = await this.getDB();
    const conn = await db.connect();
    try {
      const table = (await conn.query(sql)) as unknown as TableLike;
      const columns: ColumnMeta[] = table.schema.fields.map((f) => ({
        name: f.name,
        type: String(f.type),
        nullable: f.nullable,
      }));
      const rows = table
        .toArray()
        .map((r) => columns.map((c) => toJsonValue(r.toJSON()[c.name])));
      return { columns, rows };
    } finally {
      await conn.close();
    }
  }

  private async execObjects(sql: string): Promise<Record<string, unknown>[]> {
    const { columns, rows } = await this.exec(sql);
    return rows.map((row) => {
      const obj: Record<string, unknown> = {};
      columns.forEach((c, i) => {
        obj[c.name] = row[i];
      });
      return obj;
    });
  }

  /**
   * Fetch a CSV or Parquet file, register it, and expose it as a view.
   * `name` must be a valid dataset name (letters, digits, underscore).
   */
  async importFromURL(
    name: string,
    url: string,
    format: "csv" | "parquet",
    group?: string,
  ): Promise<DatasetMeta> {
    this.validateName(name);
    const db = await this.getDB();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    return this.registerBuffer(name, buf, format, group, db);
  }

  /** Optional DataSource.importFile: CSV/Parquet upload from the browser. */
  async importFile(file: File): Promise<DatasetMeta> {
    const lower = file.name.toLowerCase();
    const format = lower.endsWith(".parquet") ? "parquet" : "csv";
    const base = (file.name.split("/").pop() ?? file.name)
      .replace(/\.(csv|parquet)$/i, "")
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .replace(/^([0-9])/, "_$1");
    const buf = new Uint8Array(await file.arrayBuffer());
    return this.registerBuffer(base, buf, format, "uploads");
  }

  private async registerBuffer(
    name: string,
    buf: Uint8Array,
    format: "csv" | "parquet",
    group?: string,
    dbArg?: duckdb.AsyncDuckDB,
  ): Promise<DatasetMeta> {
    this.validateName(name);
    const db = dbArg ?? (await this.getDB());
    const fileName = `${name}.${format}`;
    await db.registerFileBuffer(fileName, buf);
    const reader =
      format === "parquet"
        ? `parquet_scan('${fileName}')`
        : `read_csv_auto('${fileName}', header=true)`;
    await this.exec(
      `CREATE OR REPLACE VIEW ${quoteIdent(name)} AS SELECT * FROM ${reader}`,
    );
    const countRows = await this.execObjects(
      `SELECT count(*)::DOUBLE AS n FROM ${quoteIdent(name)}`,
    );
    const rowCount = Number(countRows[0]?.["n"] ?? 0);
    const columns = await this.describeColumns(name);
    const meta: DatasetMeta = { name, group, rowCount, columns };
    this.datasets.set(name, meta);
    return meta;
  }

  /** Register dataset metadata directly (used by tests and adapters). */
  protected registerMeta(meta: DatasetMeta): void {
    this.datasets.set(meta.name, meta);
  }

  private validateName(name: string): void {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      throw new Error(`Invalid dataset name: ${JSON.stringify(name)}`);
    }
  }

  private requireDataset(name: string): DatasetMeta {
    const meta = this.datasets.get(name);
    if (!meta) {
      const known = [...this.datasets.keys()].join(", ") || "(none)";
      throw new Error(`Unknown dataset ${JSON.stringify(name)}. Known: ${known}`);
    }
    return meta;
  }

  private async describeColumns(name: string): Promise<ColumnMeta[]> {
    const rows = await this.execObjects(`DESCRIBE ${quoteIdent(name)}`);
    return rows.map((r) => ({
      name: String(r["column_name"]),
      type: String(r["column_type"]),
      nullable: r["null"] !== "NO",
    }));
  }

  // ---- DataSource interface ------------------------------------------------

  async listDatasets(): Promise<DatasetMeta[]> {
    return [...this.datasets.values()];
  }

  async getSchema(dataset: string): Promise<ColumnMeta[]> {
    return this.requireDataset(dataset).columns;
  }

  async runQuery(sql: string): Promise<QueryResult> {
    const validated = assertReadOnly(sql);
    const capped = applyRowCap(validated, this.maxRows);
    const { columns, rows } = await this.exec(capped);
    const truncated = rows.length > this.maxRows;
    const limited = truncated ? rows.slice(0, this.maxRows) : rows;
    return { columns, rows: limited, rowCount: limited.length, truncated };
  }

  async profileColumn(dataset: string, column: string): Promise<ColumnProfile> {
    const meta = this.requireDataset(dataset);
    const col = meta.columns.find((c) => c.name === column);
    if (!col) {
      throw new Error(
        `Unknown column ${JSON.stringify(column)} on dataset ${JSON.stringify(dataset)}.`,
      );
    }
    const statsRows = await this.execObjects(buildStatsSQL(dataset, column));
    const topRows = await this.execObjects(buildTopValuesSQL(dataset, column));
    return shapeProfile(dataset, column, col.type, statsRows[0] ?? {}, topRows);
  }
}
