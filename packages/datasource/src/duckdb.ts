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
import { applyRowCap, assertReadOnly, assertSelectOnly, quoteIdent } from "./guard";
import { buildNetStatsPreamble } from "./net-stats";
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
  /**
   * Base URL serving self-hosted duckdb-wasm bundle files (e.g. "/duckdb/",
   * containing duckdb-{mvp,eh}.wasm + duckdb-browser-{mvp,eh}.worker.js).
   * When set, these same-origin bundles are preferred and jsDelivr is only a
   * fallback; when unset, bundles load from jsDelivr.
   */
  bundlesBaseURL?: string;
}

/** Build a DuckDBBundles map pointing at self-hosted files under `base`. */
function selfHostedBundles(base: string): duckdb.DuckDBBundles {
  const origin =
    typeof globalThis.location !== "undefined" ? globalThis.location.href : undefined;
  const abs = (file: string): string =>
    new URL(`${base.replace(/\/?$/, "/")}${file}`, origin).href;
  return {
    mvp: {
      mainModule: abs("duckdb-mvp.wasm"),
      mainWorker: abs("duckdb-browser-mvp.worker.js"),
    },
    eh: {
      mainModule: abs("duckdb-eh.wasm"),
      mainWorker: abs("duckdb-browser-eh.worker.js"),
    },
  };
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

/** Views created via createView are namespaced with this prefix. */
export const VIEW_NAME_PREFIX = "view_";

/**
 * Turn an arbitrary label (upload filename, agent input) into a safe SQL
 * identifier: strip diacritics, replace runs of unsafe chars with `_`,
 * trim, guard the leading digit, never return an empty string.
 */
export function sanitizeDatasetName(raw: string): string {
  const cleaned = raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const named = cleaned.length > 0 ? cleaned : "dataset";
  return /^[0-9]/.test(named) ? `_${named}` : named;
}

/** First free name among `name`, `name_2`, `name_3`, ... */
export function dedupeDatasetName(
  name: string,
  isTaken: (candidate: string) => boolean,
): string {
  if (!isTaken(name)) return name;
  for (let i = 2; ; i++) {
    const candidate = `${name}_${i}`;
    if (!isTaken(candidate)) return candidate;
  }
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
  private readonly bundlesBaseURL: string | undefined;

  constructor(options: DuckDBDataSourceOptions = {}) {
    this.maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
    this.logLevel = options.logLevel ?? (3 satisfies duckdb.LogLevel); // WARNING
    this.bundlesBaseURL = options.bundlesBaseURL;
  }

  /** Pick the bundle: self-hosted (same-origin) first, jsDelivr as fallback. */
  private async pickBundle(mod: typeof duckdb): Promise<duckdb.DuckDBBundle> {
    if (this.bundlesBaseURL) {
      try {
        const candidate = await mod.selectBundle(
          selfHostedBundles(this.bundlesBaseURL),
        );
        // Probe so a missing copy step fails fast into the CDN fallback
        // instead of a cryptic wasm-compile error later.
        const probe = await fetch(candidate.mainModule, { method: "HEAD" });
        if (probe.ok) return candidate;
        console.warn(
          `DuckDB-WASM: self-hosted bundle missing (${probe.status} for ${candidate.mainModule}); falling back to jsDelivr.`,
        );
      } catch (err) {
        console.warn("DuckDB-WASM: self-hosted bundle probe failed; falling back to jsDelivr.", err);
      }
    }
    return mod.selectBundle(mod.getJsDelivrBundles());
  }

  /** Lazy engine init (same-origin or jsDelivr bundles + blob worker; browser only). */
  private getDB(): Promise<duckdb.AsyncDuckDB> {
    if (!this.dbPromise) {
      this.dbPromise = (async () => {
        const mod = await loadDuckDB();
        const bundle = await this.pickBundle(mod);
        if (!bundle.mainWorker) {
          throw new Error("DuckDB-WASM: no worker bundle available.");
        }
        const workerUrl = URL.createObjectURL(
          // The net-stats preamble instruments the worker's XHRs so remote
          // parquet reads can report fetched bytes (see net-stats.ts). It is
          // defensively written and degrades to a no-op on any mismatch.
          new Blob([buildNetStatsPreamble(), `importScripts("${bundle.mainWorker}");`], {
            type: "text/javascript",
          }),
        );
        const worker = new Worker(workerUrl);
        const db = new mod.AsyncDuckDB(new mod.ConsoleLogger(this.logLevel), worker);
        await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
        // Boot-time filesystem config (must happen before any file is open;
        // open() resets the catalog — which is empty right here).
        // duckdb-wasm 1.32 ships with forceFullHTTPReads effectively ON, so
        // every remote parquet is downloaded whole regardless of server
        // Range support (verified: 0 partial responses, ~500 MB moved for a
        // count(*)). Turning it off restores the probe chain — GET with
        // `Range: bytes=0-0` (real 206) plus a HEAD fallback for the total
        // size (reliableHeadRequests=false, since GitHub Pages/Fastly
        // answer HEAD-with-Range with 200) — after which the same count(*)
        // moves ~16 KB of parquet footer per file.
        await db.open({
          filesystem: {
            allowFullHTTPReads: true,
            forceFullHTTPReads: false,
            reliableHeadRequests: false,
          },
        });
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
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    return this.registerBuffer(name, buf, format, group);
  }

  /**
   * Optional DataSource.importFile: CSV/Parquet upload from the browser.
   * Names are sanitized to safe SQL identifiers and deduped (`name_2`, ...);
   * the original filename is kept as DatasetMeta.description.
   */
  async importFile(file: File): Promise<DatasetMeta> {
    const original = file.name.split("/").pop() ?? file.name;
    const format = original.toLowerCase().endsWith(".parquet")
      ? "parquet"
      : "csv";
    const base = sanitizeDatasetName(original.replace(/\.(csv|parquet)$/i, ""));
    const name = dedupeDatasetName(base, (n) => this.datasets.has(n));
    const buf = new Uint8Array(await file.arrayBuffer());
    return this.registerBuffer(name, buf, format, "uploads", original);
  }

  /** Register a file buffer with the engine. Overridable in tests. */
  protected async registerFile(fileName: string, buf: Uint8Array): Promise<void> {
    const db = await this.getDB();
    await db.registerFileBuffer(fileName, buf);
  }

  private async registerBuffer(
    name: string,
    buf: Uint8Array,
    format: "csv" | "parquet",
    group?: string,
    description?: string,
  ): Promise<DatasetMeta> {
    this.validateName(name);
    const fileName = `${name}.${format}`;
    await this.registerFile(fileName, buf);
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
    const meta: DatasetMeta = {
      name,
      group,
      ...(description ? { description } : {}),
      rowCount,
      columns,
    };
    this.datasets.set(name, meta);
    return meta;
  }


  /**
   * Register a set of remote (https) parquet files as one queryable view.
   *
   * DuckDB-WASM's HTTP filesystem issues Range requests, so queries read
   * only the parquet footers and the row groups they actually need — the
   * dataset can be far larger than browser memory. URLs with hive-style
   * path segments (e.g. `.../month=2024-01/part-0.parquet`) expose their
   * partition column when `hivePartitioning` stays enabled (the default),
   * and equality/range predicates on that column prune whole files.
   *
   * The real row count is read once at registration (parquet metadata only,
   * no row data) and cached on the DatasetMeta surfaced by listDatasets.
   */
  async registerRemoteParquet(
    name: string,
    urls: string[],
    options: {
      /** listDatasets group; defaults to "remote". */
      group?: string;
      description?: string;
      /** Derive partition columns from `key=value` path segments (default true). */
      hivePartitioning?: boolean;
    } = {},
  ): Promise<DatasetMeta> {
    this.validateName(name);
    if (urls.length === 0) {
      throw new Error("registerRemoteParquet needs at least one URL.");
    }
    for (const url of urls) {
      if (!/^https?:\/\//.test(url) || /['\\;\s]/.test(url)) {
        throw new Error(`Not a plain http(s) URL: ${JSON.stringify(url)}`);
      }
    }
    const hive = options.hivePartitioning ?? true;
    const list = urls.map((u) => `'${u}'`).join(", ");
    // Cache parquet footer metadata across queries: every query re-opens
    // the remote files, and without this each one re-fetches all footers.
    await this.exec(`SET enable_http_metadata_cache=true`);
    await this.exec(
      `CREATE OR REPLACE VIEW ${quoteIdent(name)} AS SELECT * FROM read_parquet([${list}], hive_partitioning=${hive ? 1 : 0})`,
    );
    const countRows = await this.execObjects(
      `SELECT count(*)::DOUBLE AS n FROM ${quoteIdent(name)}`,
    );
    const rowCount = Number(countRows[0]?.["n"] ?? 0);
    const columns = await this.describeColumns(name);
    const meta: DatasetMeta = {
      name,
      group: options.group ?? "remote",
      ...(options.description ? { description: options.description } : {}),
      rowCount,
      columns,
    };
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

  /**
   * Create (or replace) a SQL view. `name` must live in the `view_`
   * namespace; the body must be a single SELECT (read-only guard). The view
   * is registered as a dataset (group "views") and listed by listDatasets.
   */
  async createView(name: string, sql: string): Promise<DatasetMeta> {
    this.validateName(name);
    if (!name.startsWith(VIEW_NAME_PREFIX)) {
      throw new Error(
        `View names must start with "${VIEW_NAME_PREFIX}" (got ${JSON.stringify(name)}).`,
      );
    }
    const existing = this.datasets.get(name);
    if (existing && existing.group !== "views") {
      throw new Error(
        `Name ${JSON.stringify(name)} is taken by a non-view dataset.`,
      );
    }
    const body = assertSelectOnly(sql);
    await this.exec(`CREATE OR REPLACE VIEW ${quoteIdent(name)} AS ${body}`);
    const countRows = await this.execObjects(
      `SELECT count(*)::DOUBLE AS n FROM ${quoteIdent(name)}`,
    );
    const rowCount = Number(countRows[0]?.["n"] ?? 0);
    const columns = await this.describeColumns(name);
    const meta: DatasetMeta = {
      name,
      group: "views",
      description: body.length > 160 ? `${body.slice(0, 159)}…` : body,
      rowCount,
      columns,
    };
    this.datasets.set(name, meta);
    return meta;
  }

  /** Drop a view created via createView. Refuses names outside `view_*`. */
  async dropView(name: string): Promise<void> {
    this.validateName(name);
    if (!name.startsWith(VIEW_NAME_PREFIX)) {
      throw new Error(
        `Only "${VIEW_NAME_PREFIX}"-namespaced views can be dropped (got ${JSON.stringify(name)}).`,
      );
    }
    const existing = this.datasets.get(name);
    if (existing && existing.group !== "views") {
      throw new Error(`${JSON.stringify(name)} is not a view.`);
    }
    await this.exec(`DROP VIEW IF EXISTS ${quoteIdent(name)}`);
    this.datasets.delete(name);
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
