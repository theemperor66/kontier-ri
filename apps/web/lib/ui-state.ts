"use client";

/**
 * Shell-local UI state (never persisted, never part of the dashboard doc):
 * command palette / dashboard manager / templates dialogs + presentation mode.
 */

import { create } from "zustand";

interface UiState {
  paletteOpen: boolean;
  managerOpen: boolean;
  templatesOpen: boolean;
  /** Presentation mode: chrome hidden, tiles full-bleed (F key). */
  presentation: boolean;
  setPaletteOpen(open: boolean): void;
  setManagerOpen(open: boolean): void;
  setTemplatesOpen(open: boolean): void;
  setPresentation(on: boolean): void;
  togglePresentation(): void;
}

export const useUiState = create<UiState>()((set) => ({
  paletteOpen: false,
  managerOpen: false,
  templatesOpen: false,
  presentation: false,
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  setManagerOpen: (open) => set({ managerOpen: open }),
  setTemplatesOpen: (open) => set({ templatesOpen: open }),
  setPresentation: (on) => set({ presentation: on }),
  togglePresentation: () => set((s) => ({ presentation: !s.presentation })),
}));
