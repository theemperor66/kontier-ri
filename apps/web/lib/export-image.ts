"use client";

/**
 * PNG export via html-to-image: single tile (by tile id) or the whole
 * dashboard canvas. Uses the resolved --background so exports are not
 * transparent, and 2x pixel ratio for crisp charts.
 */

import { toPng } from "html-to-image";
import { slugify } from "@/lib/dashboards";

function resolvedBackground(): string {
  const bg = getComputedStyle(document.documentElement)
    .getPropertyValue("--background")
    .trim();
  return bg || "#0a0a0a";
}

async function exportNodePNG(node: HTMLElement, filename: string): Promise<void> {
  const dataUrl = await toPng(node, {
    pixelRatio: 2,
    backgroundColor: resolvedBackground(),
    // Skip icon-font glyphs etc. that html-to-image cannot inline offline.
    filter: (el) => !(el instanceof HTMLElement && el.dataset?.exportExclude === "true"),
  });
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Export one tile (DOM node located via its data-testid). */
export async function exportTilePNG(tileId: string, title: string): Promise<void> {
  const node = document.querySelector<HTMLElement>(
    `[data-testid="tile-${tileId}"]`,
  );
  if (!node) throw new Error("Tile not found on the canvas.");
  await exportNodePNG(node, `${slugify(title)}.png`);
}

/** Export the whole dashboard canvas (grid area, without chrome). */
export async function exportDashboardPNG(title: string): Promise<void> {
  const node =
    document.querySelector<HTMLElement>("[data-canvas-root]") ??
    document.querySelector<HTMLElement>("main");
  if (!node) throw new Error("Dashboard canvas not found.");
  await exportNodePNG(node, `${slugify(title)}.png`);
}
