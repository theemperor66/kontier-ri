/**
 * Duck-typed reader for the opaque dashboard document.
 *
 * The picker needs tile and page counts, but this package deliberately does not
 * depend on `@kontier-ri/studio` (see `types.ts`). So instead of importing the
 * schema we read the two shapes the doc has ever had — `{ pages: [{ tiles }] }`
 * (current) and `{ tiles }` (pre-pages) — and return zeros for anything else.
 * Never throws: a corrupt doc must still be listable so the human can delete it.
 */

import type { DashboardSummary } from "./types";

/** Tile and page counts derived from a doc of unknown shape. */
export interface DocCounts {
  tileCount: number;
  pageCount: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Count tiles/pages in an opaque doc; returns `{0, 0}` for anything unreadable. */
export function countDoc(doc: unknown): DocCounts {
  const record = asRecord(doc);
  if (!record) return { tileCount: 0, pageCount: 0 };

  const pages = record["pages"];
  if (Array.isArray(pages)) {
    let tileCount = 0;
    for (const page of pages) {
      const pageRecord = asRecord(page);
      const tiles = pageRecord?.["tiles"];
      if (Array.isArray(tiles)) tileCount += tiles.length;
    }
    return { tileCount, pageCount: pages.length };
  }

  const tiles = record["tiles"];
  if (Array.isArray(tiles)) return { tileCount: tiles.length, pageCount: 1 };
  return { tileCount: 0, pageCount: 0 };
}

/** Build the picker row for a saved dashboard, deriving counts from its doc. */
export function summarizeDashboard(
  record: { id: string; name: string; updatedAt: number; doc: unknown },
): DashboardSummary {
  const { tileCount, pageCount } = countDoc(record.doc);
  return { id: record.id, name: record.name, updatedAt: record.updatedAt, tileCount, pageCount };
}
