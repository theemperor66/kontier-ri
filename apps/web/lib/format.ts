/** Number/date formatting helpers for tiles and chrome. */

export type ValueFormat = "currency" | "number" | "percent";

export function formatValue(
  value: number | null | undefined,
  format: ValueFormat = "number",
  currency = "EUR",
): string {
  if (value == null || Number.isNaN(value)) return "—";
  switch (format) {
    case "currency":
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
      }).format(value);
    case "percent":
      return new Intl.NumberFormat("en-US", {
        style: "percent",
        maximumFractionDigits: 1,
      }).format(value);
    default:
      return new Intl.NumberFormat("en-US", {
        maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
      }).format(value);
  }
}

/** Compact axis/tooltip numbers: 84.3k, 1.2M. */
export function formatCompact(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

/** Relative delta vs a previous value, e.g. +4.2%. Returns null when unknown. */
export function formatDelta(
  value: number | null | undefined,
  prev: number | null | undefined,
): { text: string; direction: "up" | "down" | "flat" } | null {
  if (value == null || prev == null || prev === 0 || Number.isNaN(prev)) return null;
  const ratio = value / prev - 1;
  if (!Number.isFinite(ratio)) return null;
  const direction = ratio > 0.0005 ? "up" : ratio < -0.0005 ? "down" : "flat";
  const text = `${ratio > 0 ? "+" : ""}${(ratio * 100).toFixed(1)}%`;
  return { text, direction };
}

/** "just now", "12s ago", "3m ago", "2h ago". */
export function formatAgo(timestamp: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - timestamp) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
