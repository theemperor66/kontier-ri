"use client";

/**
 * Shell-local UI state (never persisted, never part of the dashboard doc):
 * command palette / dashboard manager / templates dialogs + presentation mode.
 */

import { create } from "zustand";

export type WorkspaceView =
  | "home"
  | "canvas"
  | "approvals"
  | "datasets"
  | "model"
  | "governance"
  | "audit";

interface UiState {
  /** Which workspace surface the navigation rail is showing. */
  view: WorkspaceView;
  setView(view: WorkspaceView): void;
  /** Navigation rail collapse (design: top-bar panel button). */
  railCollapsed: boolean;
  toggleRail(): void;
  paletteOpen: boolean;
  managerOpen: boolean;
  templatesOpen: boolean;
  /** Human authoring dialog for a new tile (design: "Add visual"). */
  addVisualOpen: boolean;
  setAddVisualOpen(open: boolean): void;
  /** Field pane between the navigation rail and the canvas (⌘B). */
  dataRailOpen: boolean;
  setDataRailOpen(open: boolean): void;
  toggleDataRail(): void;
  /** Version history dialog. */
  versionsOpen: boolean;
  setVersionsOpen(open: boolean): void;
  /**
   * Agent diagnostics dialog. The ChatGPT in-app browser has no devtools, so
   * the page has to be able to report its own WebMCP registration state.
   */
  diagnosticsOpen: boolean;
  setDiagnosticsOpen(open: boolean): void;
  /**
   * Sign-in / invite screen. Deliberately NOT a wall: the product renders
   * first and this opens on request. A visitor who has to choose a workspace
   * before seeing anything mostly chooses to leave.
   */
  signInOpen: boolean;
  setSignInOpen(open: boolean): void;
  /** Persistent human-agent work rail; mobile renders it as a sheet. */
  agentPanelOpen: boolean;
  /** Which tab the agent panel shows (suggestions or the command log). */
  agentPanelTab: "suggestions" | "activity";
  setAgentPanelTab(tab: "suggestions" | "activity"): void;
  /** Presentation mode: chrome hidden, tiles full-bleed (F key). */
  presentation: boolean;
  setPaletteOpen(open: boolean): void;
  setManagerOpen(open: boolean): void;
  setTemplatesOpen(open: boolean): void;
  setAgentPanelOpen(open: boolean): void;
  toggleAgentPanel(): void;
  setPresentation(on: boolean): void;
  togglePresentation(): void;
}

export const useUiState = create<UiState>()((set) => ({
  view: "canvas",
  setView: (view) => set({ view }),
  railCollapsed: false,
  toggleRail: () => set((s) => ({ railCollapsed: !s.railCollapsed })),
  paletteOpen: false,
  managerOpen: false,
  templatesOpen: false,
  addVisualOpen: false,
  setAddVisualOpen: (open) => set({ addVisualOpen: open }),
  dataRailOpen: false,
  setDataRailOpen: (open) => set({ dataRailOpen: open }),
  toggleDataRail: () => set((s) => ({ dataRailOpen: !s.dataRailOpen })),
  versionsOpen: false,
  setVersionsOpen: (open) => set({ versionsOpen: open }),
  diagnosticsOpen: false,
  setDiagnosticsOpen: (open) => set({ diagnosticsOpen: open }),
  signInOpen: false,
  setSignInOpen: (open) => set({ signInOpen: open }),
  agentPanelOpen: false,
  agentPanelTab: "suggestions",
  setAgentPanelTab: (tab) => set({ agentPanelTab: tab }),
  presentation: false,
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  setManagerOpen: (open) => set({ managerOpen: open }),
  setTemplatesOpen: (open) => set({ templatesOpen: open }),
  setAgentPanelOpen: (open) => set({ agentPanelOpen: open }),
  toggleAgentPanel: () =>
    set((s) => ({ agentPanelOpen: !s.agentPanelOpen })),
  setPresentation: (on) => set({ presentation: on }),
  togglePresentation: () => set((s) => ({ presentation: !s.presentation })),
}));
