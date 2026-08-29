/**
 * Re-materialize doc-persisted SQL views into the engine (on doc load /
 * import / share-URL open). Views live in doc.views (persistence) AND in
 * DuckDB (execution); after a reload the engine starts empty.
 */

import type { DataSource } from "@kontier-ri/datasource";
import type { ViewDef } from "./types";

export interface ViewSyncResult {
  created: string[];
  failed: { name: string; error: string }[];
}

/**
 * Create every doc view in the datasource (CREATE OR REPLACE semantics).
 * Never throws: per-view failures are reported so the UI can surface them.
 * No-op when the datasource does not support views.
 */
export async function syncViewsToDataSource(
  ds: DataSource,
  views: ViewDef[],
): Promise<ViewSyncResult> {
  const result: ViewSyncResult = { created: [], failed: [] };
  if (!ds.createView) return result;
  for (const view of views) {
    try {
      await ds.createView(view.name, view.sql);
      result.created.push(view.name);
    } catch (err) {
      result.failed.push({
        name: view.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return result;
}
