/** Metadata for a registered dataset (table/view visible to SQL). */
export interface DatasetMeta {
  /** SQL-addressable name, e.g. `invoices`. */
  name: string;
  /** Logical group, e.g. `saas_billing`, `payments`, `uploads`, `views`. */
  group?: string;
  /** Human-readable label, e.g. the original upload filename or view SQL. */
  description?: string;
  rowCount: number;
  columns: ColumnMeta[];
}

export interface ColumnMeta {
  name: string;
  /** DuckDB type name, e.g. VARCHAR, BIGINT, DOUBLE, DATE. */
  type: string;
  nullable: boolean;
}

export interface QueryResult {
  columns: ColumnMeta[];
  /** Row-major values; JSON-serializable (BigInt coerced to number/string). */
  rows: unknown[][];
  rowCount: number;
  /** True when the row cap truncated the result. */
  truncated: boolean;
}

export interface ColumnProfile {
  dataset: string;
  column: string;
  type: string;
  count: number;
  nulls: number;
  distinct: number;
  min: unknown;
  max: unknown;
  /** Most frequent values with occurrence counts (descending). */
  topValues: { value: unknown; count: number }[];
}

/**
 * The Kontier integration seam (docs/PLAN.md). Demo impl: DuckDB-WASM.
 * A private Go analytics API adapter can implement this later.
 */
export interface DataSource {
  listDatasets(): Promise<DatasetMeta[]>;
  getSchema(dataset: string): Promise<ColumnMeta[]>;
  /** Read-only, row-capped. Rejects anything that is not a single SELECT. */
  runQuery(sql: string): Promise<QueryResult>;
  profileColumn(dataset: string, column: string): Promise<ColumnProfile>;
  /** Optional CSV/Parquet upload. */
  importFile?(file: File): Promise<DatasetMeta>;
  /**
   * Optional SQL views (PLAN-V2): name must be `view_*`-namespaced, body is
   * guarded SELECT-only. The view shows up in listDatasets (group "views").
   */
  createView?(name: string, sql: string): Promise<DatasetMeta>;
  dropView?(name: string): Promise<void>;
}
