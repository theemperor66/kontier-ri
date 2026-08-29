"use client";

export interface StudioCanvasProps {
  /** Placeholder prop; the real canvas takes the dashboard document. */
  title?: string;
}

/**
 * Placeholder for the collaborative dashboard canvas.
 * The real implementation (tiles, WebMCP tools, undo/attribution) lands next.
 */
export function StudioCanvas({ title = "Studio canvas" }: StudioCanvasProps) {
  return (
    <div
      data-testid="studio-canvas"
      style={{
        border: "1px dashed var(--border, #444)",
        borderRadius: 8,
        padding: 24,
        textAlign: "center",
        opacity: 0.7,
      }}
    >
      <p style={{ margin: 0 }}>{title}</p>
      <p style={{ margin: 0, fontSize: 12 }}>
        StudioCanvas placeholder — tiles, WebMCP tools, and undo land here.
      </p>
    </div>
  );
}
