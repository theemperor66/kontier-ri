"use client";

/**
 * Version history: named snapshots of the report document, kept in this
 * browser. A snapshot is taken automatically before a staged change set is
 * applied, so agent work always has a restore point, and manually whenever
 * the human wants one. Restoring is itself an ordinary dashboard load.
 */

import { useEffect, useState } from "react";
import type { DashboardDoc } from "@/lib/dashboard-store";
import { currentDashboardId } from "@/lib/dashboards";

const PREFIX = "kontier-ri:versions:";
const MAX_VERSIONS = 20;

export interface DocVersion {
  id: string;
  label: string;
  savedAt: number;
  tileCount: number;
  /** Snapshot of the document at save time. */
  doc: DashboardDoc;
}

function key(): string {
  return `${PREFIX}${currentDashboardId() ?? "default"}`;
}

function read(): DocVersion[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key());
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DocVersion[]) : [];
  } catch {
    return [];
  }
}

function write(versions: DocVersion[]): void {
  try {
    window.localStorage.setItem(
      key(),
      JSON.stringify(versions.slice(-MAX_VERSIONS)),
    );
    window.dispatchEvent(new CustomEvent("kontier:versions"));
  } catch {
    /* quota or private mode: history is a convenience, never a blocker */
  }
}

/** Newest first. */
export function listVersions(): DocVersion[] {
  return read().slice().reverse();
}

export function saveVersion(doc: DashboardDoc, label: string): DocVersion {
  const version: DocVersion = {
    id: `ver_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    label,
    savedAt: Date.now(),
    tileCount: doc.pages.reduce((total, page) => total + page.tiles.length, 0),
    doc: structuredClone(doc),
  };
  write([...read(), version]);
  return version;
}

export function deleteVersion(id: string): void {
  write(read().filter((version) => version.id !== id));
}

/** Live version list for the UI (updates on write and across tabs). */
export function useVersions(): DocVersion[] {
  const [versions, setVersions] = useState<DocVersion[]>([]);
  useEffect(() => {
    const sync = () => setVersions(listVersions());
    sync();
    window.addEventListener("kontier:versions", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("kontier:versions", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return versions;
}
