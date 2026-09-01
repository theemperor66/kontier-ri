"use client";

/**
 * Every inspector edit flows through the EXISTING command layer with
 * origin "human": undoable, attributed in the activity feed, and
 * conflict-tracked (an agent write to the same property within 10 minutes
 * returns a conflict unless forced). No new store actions, no new schema.
 */

import { useEffect, useMemo, useRef } from "react";
import type { ActionResult } from "@/lib/dashboard-store";
import { useDashboardStore } from "@/lib/dashboard-store";

/** Shallow spec patch via updateTile (origin human). */
export function commitSpec(
  tileId: string,
  patch: Record<string, unknown>,
  label: string,
): ActionResult {
  return useDashboardStore
    .getState()
    .updateTile(tileId, { spec: patch }, { origin: "human", label });
}

export function commitTitle(
  tileId: string,
  title: string,
  label: string,
): ActionResult {
  return useDashboardStore
    .getState()
    .updateTile(tileId, { title }, { origin: "human", label });
}

/**
 * Debounced callback (300ms default) for typed inputs: the timer resets on
 * every call, pending work is dropped on unmount, and flush() commits a
 * pending call immediately (blur / Enter).
 */
export function useDebounced<A extends unknown[]>(
  fn: (...args: A) => void,
  ms = 300,
): { call: (...args: A) => void; flush: () => void } {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<A | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return useMemo(
    () => ({
      call: (...args: A) => {
        pending.current = args;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          timer.current = null;
          const a = pending.current;
          pending.current = null;
          if (a) fnRef.current(...a);
        }, ms);
      },
      flush: () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        const a = pending.current;
        pending.current = null;
        if (a) fnRef.current(...a);
      },
    }),
    [ms],
  );
}
