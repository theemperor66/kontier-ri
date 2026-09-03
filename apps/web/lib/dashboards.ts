"use client";

/**
 * Multi-dashboard persistence over localStorage.
 *
 * Layout:
 *   kontier-ri.dashboards.index.v1  -> { version, currentId, entries: [{id, name, updatedAt}] }
 *   kontier-ri.dashboard.<id>       -> DashboardDoc JSON
 *
 * Migration: any pre-manager single-doc key (legacy builds) is adopted as
 * "My dashboard" the first time the manager layer boots. Unknown/partial doc
 * shapes are normalized by `normalizeDoc` so old docs keep loading.
 */

import { syncViewsToDataSource } from "@kontier-ri/studio";
import type { DashboardDoc, DashboardDocInput } from "@/lib/dashboard-store";
import {
  createInitialDoc,
  migrateDoc,
  useDashboardStore,
} from "@/lib/dashboard-store";
import { dataSource } from "@/lib/datasource";

/**
 * Load a doc into the store AND re-materialize its SQL views in DuckDB
 * (views persist in doc.views; the engine starts empty after a reload).
 */
export function loadDocIntoStore(doc: DashboardDoc): void {
  useDashboardStore.getState().resetDashboard(doc);
  void syncViewsToDataSource(dataSource, doc.views ?? []);
}

// ---------------------------------------------------------------------------
// Debounced autosave (single module-level timer so switch/delete can flush
// pending edits BEFORE the current dashboard changes — no lost keystrokes)
// ---------------------------------------------------------------------------

export const SAVE_DEBOUNCE_MS = 400;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounce-save the store doc under the current dashboard id. */
export function schedulePersist(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, SAVE_DEBOUNCE_MS);
}

function persistNow(): void {
  saveTimer = null;
  const id = currentDashboardId();
  if (id) saveDashboardDoc(id, useDashboardStore.getState().doc);
}

/** Persist immediately (dashboard switch / delete / page unload). */
export function flushPersist(): void {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  persistNow();
}

export const INDEX_KEY = "kontier-ri.dashboards.index.v1";
export const DOC_KEY_PREFIX = "kontier-ri.dashboard.";
/** Single-doc keys used by pre-manager builds (adopted as "My dashboard"). */
const LEGACY_DOC_KEYS = ["kontier-ri.doc", "kontier-ri:doc", "kontier_ri_doc"];

export interface DashboardEntry {
  id: string;
  name: string;
  /** epoch ms */
  updatedAt: number;
  tileCount: number;
}

interface DashboardIndex {
  version: 1;
  currentId: string | null;
  entries: DashboardEntry[];
}

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null; // storage blocked (private mode / permissions)
  }
}

export function genDashboardId(): string {
  return `dash_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Best-effort doc-shape migration: accepts any historical doc JSON and
 * returns a valid current-shape DashboardDoc (never throws on bad fields).
 * Delegates to @kontier-ri/studio migrateDoc after filling v1 defaults.
 */
export function normalizeDoc(raw: unknown): DashboardDoc {
  if (raw == null || typeof raw !== "object") return createInitialDoc();
  const d = raw as Partial<DashboardDocInput> & Record<string, unknown>;
  try {
    return migrateDoc({
      ...(d as DashboardDocInput),
      title:
        typeof d.title === "string" && d.title.trim()
          ? d.title
          : "Untitled dashboard",
      theme: {
        ...(d.theme?.palette ? { palette: d.theme.palette } : {}),
        mode: d.theme?.mode === "dark" ? "dark" : "light",
      },
      filters: {
        filters: Array.isArray(d.filters?.filters) ? d.filters.filters : [],
        dateRange: d.filters?.dateRange ?? null,
      },
    });
  } catch {
    return createInitialDoc();
  }
}

function readIndex(): DashboardIndex {
  const s = storage();
  const empty: DashboardIndex = { version: 1, currentId: null, entries: [] };
  if (!s) return empty;
  try {
    const raw = s.getItem(INDEX_KEY);
    if (!raw) return migrateLegacy(s) ?? empty;
    const parsed = JSON.parse(raw) as DashboardIndex;
    if (!Array.isArray(parsed.entries)) return empty;
    return { version: 1, currentId: parsed.currentId ?? null, entries: parsed.entries };
  } catch {
    return empty;
  }
}

/** Adopt a pre-manager single-doc key as "My dashboard" (one-time). */
function migrateLegacy(s: Storage): DashboardIndex | null {
  for (const key of LEGACY_DOC_KEYS) {
    const raw = s.getItem(key);
    if (!raw) continue;
    try {
      const doc = normalizeDoc(JSON.parse(raw));
      doc.title = doc.title === "Untitled dashboard" ? "My dashboard" : doc.title;
      const id = genDashboardId();
      const index: DashboardIndex = {
        version: 1,
        currentId: id,
        entries: [
          {
            id,
            name: doc.title,
            updatedAt: Date.now(),
            tileCount: doc.tiles.length,
          },
        ],
      };
      s.setItem(DOC_KEY_PREFIX + id, JSON.stringify(doc));
      s.setItem(INDEX_KEY, JSON.stringify(index));
      s.removeItem(key);
      return index;
    } catch {
      // Corrupt legacy doc: leave it in place, start fresh.
      return null;
    }
  }
  return null;
}

function writeIndex(index: DashboardIndex): void {
  storage()?.setItem(INDEX_KEY, JSON.stringify(index));
}

export function listDashboards(): DashboardEntry[] {
  return readIndex().entries.slice().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function currentDashboardId(): string | null {
  return readIndex().currentId;
}

export function readDashboardDoc(id: string): DashboardDoc | null {
  const s = storage();
  if (!s) return null;
  const raw = s.getItem(DOC_KEY_PREFIX + id);
  if (!raw) return null;
  try {
    return normalizeDoc(JSON.parse(raw));
  } catch {
    return null;
  }
}

function upsertEntry(index: DashboardIndex, entry: DashboardEntry): void {
  const i = index.entries.findIndex((e) => e.id === entry.id);
  if (i >= 0) index.entries[i] = entry;
  else index.entries.push(entry);
}

/** Persist a doc under `id` and update the index entry (name = doc.title). */
export function saveDashboardDoc(id: string, doc: DashboardDoc): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(DOC_KEY_PREFIX + id, JSON.stringify(doc));
  } catch {
    return; // quota exceeded — skip silently, doc stays in memory
  }
  const index = readIndex();
  upsertEntry(index, {
    id,
    name: doc.title,
    updatedAt: Date.now(),
    tileCount: doc.tiles.length,
  });
  if (!index.currentId) index.currentId = id;
  writeIndex(index);
}

export function setCurrentDashboard(id: string): void {
  const index = readIndex();
  index.currentId = id;
  writeIndex(index);
}

/** Create a new dashboard from `doc` (or blank), select it, load it. */
export function createDashboard(doc?: DashboardDoc): string {
  flushPersist();
  const id = genDashboardId();
  const next = doc ?? createInitialDoc();
  saveDashboardDoc(id, next);
  setCurrentDashboard(id);
  loadDocIntoStore(next);
  return id;
}

export function duplicateDashboard(id: string): string | null {
  const doc = readDashboardDoc(id);
  if (!doc) return null;
  const copy: DashboardDoc = { ...doc, title: `${doc.title} (copy)` };
  const newId = genDashboardId();
  saveDashboardDoc(newId, copy);
  return newId;
}

export function renameDashboard(id: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  const doc = readDashboardDoc(id);
  if (!doc) return;
  saveDashboardDoc(id, { ...doc, title: trimmed });
  if (currentDashboardId() === id) {
    useDashboardStore
      .getState()
      .setTitle(trimmed, { origin: "human", label: `Renamed dashboard to "${trimmed}"` });
  }
}

/** Delete a dashboard. If it was current, switch to the newest remaining. */
export function deleteDashboard(id: string): void {
  const s = storage();
  if (!s) return;
  flushPersist();
  s.removeItem(DOC_KEY_PREFIX + id);
  const index = readIndex();
  index.entries = index.entries.filter((e) => e.id !== id);
  if (index.currentId === id) {
    const next = index.entries
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    index.currentId = next?.id ?? null;
    writeIndex(index);
    const nextDoc = next ? readDashboardDoc(next.id) : null;
    loadDocIntoStore(nextDoc ?? createInitialDoc());
    return;
  }
  writeIndex(index);
}

/** Switch the active dashboard (persists selection, replaces store doc). */
export function switchDashboard(id: string): boolean {
  flushPersist();
  const doc = readDashboardDoc(id);
  if (!doc) return false;
  setCurrentDashboard(id);
  loadDocIntoStore(doc);
  return true;
}

/**
 * Open a full doc (template / share link): replaces the current dashboard
 * when it is still empty, otherwise creates a new dashboard entry.
 */
export function openDocAsDashboard(doc: DashboardDoc): void {
  flushPersist();
  const state = useDashboardStore.getState();
  const currentId = currentDashboardId();
  if (currentId && state.doc.tiles.length === 0) {
    setCurrentDashboard(currentId);
    loadDocIntoStore(doc);
    saveDashboardDoc(currentId, doc);
    return;
  }
  createDashboard(doc);
}

// ---------------------------------------------------------------------------
// JSON import / export
// ---------------------------------------------------------------------------

export function exportDashboardJSON(id?: string): void {
  const doc = id
    ? readDashboardDoc(id)
    : useDashboardStore.getState().doc;
  if (!doc) return;
  const blob = new Blob([JSON.stringify(doc, null, 2)], {
    type: "application/json",
  });
  downloadBlob(blob, `${slugify(doc.title)}.json`);
}

/** Import a doc JSON file as a NEW dashboard and switch to it. */
export async function importDashboardJSON(file: File): Promise<DashboardDoc> {
  const text = await file.text();
  const doc = normalizeDoc(JSON.parse(text));
  if (doc.title === "Untitled dashboard") {
    doc.title = file.name.replace(/\.json$/i, "") || doc.title;
  }
  createDashboard(doc);
  return doc;
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "dashboard"
  );
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------------------------------------------------------------------------
// Boot + autosave (used by <DashboardPersistence/> in the shell)
// ---------------------------------------------------------------------------

/**
 * Load the current dashboard into the store (once, on mount). Returns the
 * active dashboard id — creating the initial entry lazily if storage is
 * empty so first-time visitors still see the teaching empty state.
 */
export function bootPersistence(): string {
  const index = readIndex();
  let id = index.currentId;
  const storeDoc = useDashboardStore.getState().doc;
  if (id) {
    const doc = readDashboardDoc(id);
    if (doc && (doc.tiles.length > 0 || storeDoc.tiles.length === 0)) {
      // Views sync separately once the datasource is ready (see
      // <DashboardPersistence/>): DuckDB is still booting at this point.
      useDashboardStore.getState().resetDashboard(doc);
      return id;
    }
  }
  if (!id) {
    id = genDashboardId();
    const doc = { ...storeDoc, title: storeDoc.title };
    saveDashboardDoc(id, doc);
    setCurrentDashboard(id);
  }
  return id;
}
