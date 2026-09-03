"use client";

import { useMemo } from "react";
import type { DataSource } from "@kontier-ri/datasource";
import {
  useWebMCPTool,
  type ToolRegistrationStatus,
} from "./useWebMCPTool";
import {
  buildStaticTools,
  scopeToolsToPhase,
  type StudioStoreApi,
  type ToolDefinition,
} from "./tools";
import type { WorkSessionPhase } from "../types";

/** One hook call per tool; keyed mount keeps the rules of hooks happy. */
export function RegisteredTool({
  def,
  onError,
  onStatusChange,
}: {
  def: ToolDefinition;
  onError?: (toolName: string, err: unknown) => void;
  onStatusChange?: (
    toolName: string,
    status: ToolRegistrationStatus,
    error?: unknown,
  ) => void;
}) {
  useWebMCPTool({
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    execute: def.execute,
    ...(def.annotations ? { annotations: def.annotations } : {}),
    ...(onError ? { onError: (err: unknown) => onError(def.name, err) } : {}),
    ...(onStatusChange
      ? {
          onStatusChange: (status: ToolRegistrationStatus, error?: unknown) =>
            onStatusChange(def.name, status, error),
        }
      : {}),
  });
  return null;
}

export interface WebMCPToolsProps {
  dataSource: DataSource;
  /** Override the dashboard store (tests); defaults to useDashboardStore. */
  store?: StudioStoreApi;
  onError?: (toolName: string, err: unknown) => void;
  onStatusChange?: (
    toolName: string,
    status: ToolRegistrationStatus,
    error?: unknown,
  ) => void;
}

/**
 * Mounts every static WebMCP tool (docs/TOOLS.md). Render once from the
 * top-level page (ChatGPT constraint: register only from the top frame).
 *
 * `phase` is the opt-in focused toolbelt: pass the live work-session phase and
 * only the tools that phase needs stay registered; pass nothing (the default)
 * and the full static surface registers.
 */
export function WebMCPTools({
  dataSource,
  store,
  onError,
  onStatusChange,
  phase,
}: WebMCPToolsProps & { phase?: WorkSessionPhase | null }) {
  const defs = useMemo(
    () =>
      scopeToolsToPhase(
        buildStaticTools({ dataSource, ...(store ? { store } : {}) }),
        phase,
      ),
    [dataSource, store, phase],
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
