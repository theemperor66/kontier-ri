"use client";

import { useMemo } from "react";
import type { DataSource } from "@kontier-ri/datasource";
import { useDashboardStore } from "../store";
import { RegisteredTool, type WebMCPToolsProps } from "./WebMCPTools";
import { buildSelectedTileTools } from "./tools";

/**
 * Mounts the 3 selection-scoped tools (edit_selected_tile,
 * restyle_selected_tile, explain_selected_tile) ONLY while a tile is
 * selected — the tools unregister on deselect via component unmount
 * (spec-leverage demo). Render once next to <WebMCPTools/>.
 */
export function SelectedTileTools({
  dataSource,
  store,
  onError,
  onStatusChange,
}: WebMCPToolsProps) {
  const selected = useDashboardStore((s) =>
    s.doc.tiles.find((t) => t.id === s.selectedTileId),
  );
  if (!selected) return null;
  return (
    <SelectedTileToolsInner
      key={selected.id}
      dataSource={dataSource}
      {...(store ? { store } : {})}
      {...(onError ? { onError } : {})}
      {...(onStatusChange ? { onStatusChange } : {})}
      tileType={selected.type}
      tileTitle={selected.title}
    />
  );
}

function SelectedTileToolsInner({
  dataSource,
  store,
  onError,
  onStatusChange,
  tileType,
  tileTitle,
}: WebMCPToolsProps & { tileType: string; tileTitle: string }) {
  const defs = useMemo(
    () =>
      buildSelectedTileTools(
        { dataSource, ...(store ? { store } : {}) },
        { type: tileType as never, title: tileTitle },
      ),
    [dataSource, store, tileType, tileTitle],
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
