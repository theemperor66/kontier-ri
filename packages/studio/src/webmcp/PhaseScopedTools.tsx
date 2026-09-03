"use client";

import { useMemo } from "react";
import { useDashboardStore } from "../store";
import { RegisteredTool, type WebMCPToolsProps } from "./WebMCPTools";
import {
  buildDecisionTools,
  buildProposalTools,
  type ToolContext,
  type ToolDefinition,
} from "./tools";

/**
 * Phase-scoped tool bundles: the agent's toolbelt changes with the state of
 * the review queue instead of exposing one flat catalog.
 *
 * <ProposalScopedTools/> mounts revise_change_set + withdraw_change_set only
 * while a change set is awaiting the human's verdict; <DecisionScopedTools/>
 * mounts withdraw_decision only while a question is unanswered. Both render
 * nothing (and therefore unregister their tools) as soon as the queue empties.
 * Render once next to <WebMCPTools/>.
 */
export function ProposalScopedTools(props: WebMCPToolsProps) {
  // A string signature keeps the zustand selector referentially stable and
  // re-mounts the tools (fresh descriptions) when the pending set changes.
  const signature = useDashboardStore((s) =>
    s.presence.changeSets
      .filter((changeSet) => changeSet.status === "proposed")
      .map((changeSet) => `${changeSet.id}:${changeSet.updatedAt}`)
      .join(","),
  );
  if (signature.length === 0) return null;
  return <ScopedTools key={signature} build={buildProposalTools} {...props} />;
}

export function DecisionScopedTools(props: WebMCPToolsProps) {
  const signature = useDashboardStore((s) =>
    s.presence.decisions
      .filter((decision) => decision.status === "pending")
      .map((decision) => `${decision.id}:${decision.updatedAt}`)
      .join(","),
  );
  if (signature.length === 0) return null;
  return <ScopedTools key={signature} build={buildDecisionTools} {...props} />;
}

function ScopedTools({
  build,
  dataSource,
  store,
  onError,
  onStatusChange,
}: WebMCPToolsProps & {
  build: (ctx: ToolContext) => ToolDefinition[];
}) {
  const defs = useMemo(
    () => build({ dataSource, ...(store ? { store } : {}) }),
    [build, dataSource, store],
  );
  return (
    <>
      {defs.map((def) => (
        <RegisteredTool
          key={def.name}
          def={def}
          {...(onError ? { onError } : {})}
          {...(onStatusChange ? { onStatusChange } : {})}
        />
      ))}
    </>
  );
}
