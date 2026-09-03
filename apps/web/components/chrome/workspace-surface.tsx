"use client";

/**
 * Workspace surface switch: the navigation rail's non-canvas destinations.
 * Every view reads live product state (datasets, semantic registries, command
 * log, agent proposals) — nothing here is a mock screen.
 */

import type { WorkspaceView } from "@/lib/ui-state";
import {
  ApprovalsView,
  AuditLogView,
  DatasetsView,
  GovernanceView,
  HomeView,
  SemanticModelView,
} from "@/components/workspace";

export function WorkspaceSurface({ view }: { view: WorkspaceView }) {
  switch (view) {
    case "home":
      return <HomeView />;
    case "approvals":
      return <ApprovalsView />;
    case "datasets":
      return <DatasetsView />;
    case "model":
      return <SemanticModelView />;
    case "governance":
      return <GovernanceView />;
    case "audit":
      return <AuditLogView />;
    default:
      return null;
  }
}
