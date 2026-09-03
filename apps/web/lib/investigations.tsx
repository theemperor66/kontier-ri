"use client";

/**
 * Investigation records: when a work session completes, its brief, summary,
 * outcomes and the decisions the human made are written to local storage so
 * the conclusion survives a reload. Records are read-only history; they never
 * re-enter the live session state.
 */

import { useEffect, useRef, useState } from "react";
import { useDashboardStore } from "@/lib/dashboard-store";

const KEY = "kontier-ri:investigations";
const MAX_RECORDS = 50;

export interface InvestigationDecision {
  question: string;
  answer: string;
  note?: string;
}

export interface InvestigationRecord {
  id: string;
  objective: string;
  summary: string;
  outcomes: string[];
  decisions: InvestigationDecision[];
  approvedChanges: number;
  dashboardTitle: string;
  startedAt: number;
  completedAt: number;
}

function read(): InvestigationRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as InvestigationRecord[]) : [];
  } catch {
    return [];
  }
}

function write(records: InvestigationRecord[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(records.slice(-MAX_RECORDS)));
    window.dispatchEvent(new CustomEvent("kontier:investigations"));
  } catch {
    /* private mode / quota: history is a convenience, never a blocker */
  }
}

export function listInvestigations(): InvestigationRecord[] {
  return read().slice().reverse();
}

export function clearInvestigations(): void {
  try {
    window.localStorage.removeItem(KEY);
    window.dispatchEvent(new CustomEvent("kontier:investigations"));
  } catch {
    /* ignore */
  }
}

/** Live list of stored investigations (updates on write and across tabs). */
export function useInvestigations(): InvestigationRecord[] {
  const [records, setRecords] = useState<InvestigationRecord[]>([]);
  useEffect(() => {
    const sync = () => setRecords(listInvestigations());
    sync();
    window.addEventListener("kontier:investigations", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("kontier:investigations", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return records;
}

/**
 * Watches the live session and records it once, at completion. Mounted from
 * the shell; renders nothing.
 */
export function InvestigationRecorder() {
  const session = useDashboardStore((s) => s.presence.session);
  const savedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!session || session.phase !== "complete") return;
    if (savedRef.current === session.id) return;
    savedRef.current = session.id;

    const state = useDashboardStore.getState();
    const decisions = state.presence.decisions
      .filter((decision) => decision.status === "answered" && decision.answer)
      .map((decision) => {
        const option = decision.options.find(
          (candidate) => candidate.id === decision.answer?.optionId,
        );
        return {
          question: decision.question,
          answer: option?.label ?? decision.answer?.optionId ?? "",
          ...(decision.answer?.note ? { note: decision.answer.note } : {}),
        };
      });
    // Everything the human approved in this session: single-action proposals
    // plus the individual rows applied from staged change sets.
    const approvedChanges =
      state.presence.insights.filter((insight) => insight.state === "accepted")
        .length +
      state.presence.changeSets.reduce(
        (total, set) =>
          total +
          (set.status === "applied"
            ? set.actions.length
            : (set.appliedActionIndexes?.length ?? 0)),
        0,
      );

    const record: InvestigationRecord = {
      id: session.id,
      objective: session.objective,
      summary: session.summary ?? "",
      outcomes: [...session.outcomes],
      decisions,
      approvedChanges,
      dashboardTitle: state.doc.title,
      startedAt: session.createdAt,
      completedAt: session.completedAt ?? Date.now(),
    };
    const existing = read().filter((item) => item.id !== record.id);
    write([...existing, record]);
  }, [session]);

  return null;
}
