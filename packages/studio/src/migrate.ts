/**
 * Document migration: any historical doc shape -> the current v2 shape.
 *
 * v1 docs ({title, theme, filters, tiles}) — old share-URLs and localStorage
 * payloads — load as a single "Overview" page. Idempotent: migrating a v2 doc
 * only re-establishes invariants (valid activePageId, tiles mirror).
 */

import type {
  DashboardDoc,
  DashboardDocInput,
  Page,
  Tile,
} from "./types";
import { DOC_VERSION } from "./types";

/** Stable id for the page created when migrating a v1 doc. */
export const V1_PAGE_ID = "page_overview";

/**
 * Establish the doc.tiles mirror invariant: `tiles` IS the active page's
 * tiles array (same reference).
 */
export function withActivePageMirror(doc: DashboardDoc): DashboardDoc {
  const active =
    doc.pages.find((p) => p.id === doc.activePageId) ?? doc.pages[0]!;
  return { ...doc, activePageId: active.id, tiles: active.tiles };
}

function normalizeTile(tile: Tile): Tile {
  return { ...tile, annotations: tile.annotations ?? [] };
}

function normalizePage(page: Page): Page {
  return { ...page, tiles: (page.tiles ?? []).map(normalizeTile) };
}

/**
 * Migrate any known doc shape to the current version. Never throws on the
 * shapes we ever shipped; unknown extra keys are dropped.
 */
export function migrateDoc(input: DashboardDocInput): DashboardDoc {
  const pages: Page[] =
    input.pages && input.pages.length > 0
      ? input.pages.map(normalizePage)
      : [
          {
            id: V1_PAGE_ID,
            name: "Overview",
            tiles: (input.tiles ?? []).map(normalizeTile),
          },
        ];
  const activePageId = pages.some((p) => p.id === input.activePageId)
    ? input.activePageId!
    : pages[0]!.id;
  return withActivePageMirror({
    version: DOC_VERSION,
    title: input.title,
    theme: { ...input.theme },
    filters: {
      filters: (input.filters?.filters ?? []).map((f) => ({ ...f })),
      dateRange: input.filters?.dateRange ? { ...input.filters.dateRange } : null,
    },
    pages,
    activePageId,
    tiles: [],
    crossFilter: input.crossFilter ? { ...input.crossFilter } : null,
    calculatedFields: (input.calculatedFields ?? []).map((f) => ({ ...f })),
    views: (input.views ?? []).map((v) => ({ ...v })),
  });
}
