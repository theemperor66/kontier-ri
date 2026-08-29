"use client";

/**
 * P0 persistence: rehydrate the active dashboard from localStorage on boot,
 * then debounce-save the doc on every store mutation. Uploaded datasets live
 * in in-memory DuckDB and cannot survive a reload — the datasource seam
 * (lib/datasource.tsx) rewrites missing-table errors into a clear
 * "re-upload" message, so restored tiles never spin forever.
 */

import { useEffect, useRef } from "react";
import { syncViewsToDataSource } from "@kontier-ri/studio";
import { useDashboardStore } from "@/lib/dashboard-store";
import { dataSource, useDataSource } from "@/lib/datasource";
import {
  bootPersistence,
  currentDashboardId,
  openDocAsDashboard,
  saveDashboardDoc,
} from "@/lib/dashboards";
import { clearShareHash, readShareURL } from "@/lib/share-url";

const SAVE_DEBOUNCE_MS = 400;

export function DashboardPersistence() {
  const booted = useRef(false);
  const { status } = useDataSource();
  const viewsSynced = useRef(false);

  // Boot-time view re-materialization: doc.views persist in localStorage but
  // DuckDB starts empty — create them once the engine is ready.
  useEffect(() => {
    if (status !== "ready" || viewsSynced.current) return;
    viewsSynced.current = true;
    void syncViewsToDataSource(
      dataSource,
      useDashboardStore.getState().doc.views ?? [],
    );
  }, [status]);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    bootPersistence();
    // A share-link doc (#doc=…) wins over the locally saved dashboard: it is
    // imported as its own dashboard entry, then stripped from the URL.
    const shared = readShareURL();
    if (shared) {
      openDocAsDashboard(shared);
      clearShareHash();
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastDoc = useDashboardStore.getState().doc;
    const unsubscribe = useDashboardStore.subscribe((state) => {
      if (state.doc === lastDoc) return;
      lastDoc = state.doc;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const id = currentDashboardId();
        if (id) saveDashboardDoc(id, useDashboardStore.getState().doc);
      }, SAVE_DEBOUNCE_MS);
    });
    const flush = () => {
      if (timer) clearTimeout(timer);
      const id = currentDashboardId();
      if (id) saveDashboardDoc(id, useDashboardStore.getState().doc);
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      unsubscribe();
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, []);

  return null;
}
