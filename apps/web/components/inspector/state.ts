"use client";

/**
 * Inspector-local UI state (never persisted, never part of the dashboard
 * doc). `open` is the human's intent to keep the inspector docked; the panel
 * itself renders only while a tile is selected (it follows the selection).
 */

import { create } from "zustand";

interface InspectorState {
  open: boolean;
  setOpen(open: boolean): void;
  toggle(): void;
}

export const useInspectorState = create<InspectorState>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}));
