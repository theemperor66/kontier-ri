/** Number/date formatting helpers for tiles and chrome. */

export type ValueFormat = "currency" | "number" | "percent" | "compact";

/** Currency the string form of a format ("currency") renders in. */
export const DEFAULT_CURRENCY = "EUR";

/** Options-object form used by v2 tile specs (spec.format.value). */
export interface FormatOptions {
  style?: ValueFormat;
  /** ISO 4217 code, e.g. "EUR". Only used with style "currency". */
  currency?: string;
  maximumFractionDigits?: number;
}

function normalize(
  format: ValueFormat | FormatOptions | undefined,
  currency: string,
): Required<Pick<FormatOptions, "style" | "currency">> &
  Pick<FormatOptions, "maximumFractionDigits"> {
  if (typeof format === "string") return { style: format, currency };
  return {
    style: format?.style ?? "number",
    currency: format?.currency ?? currency,
    maximumFractionDigits: format?.maximumFractionDigits,
  };
}

/**
 * Format a numeric value for display.
 * Accepts the legacy positional style string (`formatValue(v, "currency")`)
 * AND the v2 options object (`formatValue(v, {style: "currency", currency: "USD"})`).
 */
export function formatValue(
  value: number | null | undefined,
  format: ValueFormat | FormatOptions = "number",
  currency = DEFAULT_CURRENCY,
): string {
  if (value == null || Number.isNaN(value)) return "—";
  const opts = normalize(format, currency);
  const maxFrac = (fallback: number) =>
    opts.maximumFractionDigits ?? fallback;
  switch (opts.style) {
    case "currency":
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: opts.currency,
        maximumFractionDigits: maxFrac(Math.abs(value) >= 1000 ? 0 : 2),
      }).format(value);
    case "percent":
      return new Intl.NumberFormat("en-US", {
        style: "percent",
        maximumFractionDigits: maxFrac(1),
      }).format(value);
    case "compact":
      return new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: maxFrac(1),
      }).format(value);
    default:
      return new Intl.NumberFormat("en-US", {
        maximumFractionDigits: maxFrac(Math.abs(value) >= 1000 ? 0 : 2),
      }).format(value);
  }
}

/**
 * Axis-tick variant: always compact notation, but keeps currency symbol /
 * percent sign so axes read "€84k" / "12%" instead of raw numbers.
 */
export function formatAxisTick(
  value: number,
  format?: ValueFormat | FormatOptions,
): string {
  if (value == null || Number.isNaN(value)) return "";
  const opts = normalize(format ?? "number", "EUR");
  switch (opts.style) {
    case "currency":
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: opts.currency,
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value);
    case "percent":
      return new Intl.NumberFormat("en-US", {
        style: "percent",
        maximumFractionDigits: 1,
      }).format(value);
    default:
      return formatCompact(value);
  }
}

/** Compact axis/tooltip numbers: 84.3k, 1.2M. */
export function formatCompact(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

// ---------------------------------------------------------------------------
// Friendly labels (A2): SQL aliases -> human words, everywhere labels render.
// ---------------------------------------------------------------------------

/** Tokens that should render uppercase inside humanized identifiers. */
const LABEL_ACRONYMS = new Set([
  "eur",
  "usd",
  "gbp",
  "chf",
  "mrr",
  "arr",
  "arpu",
  "ltv",
  "id",
  "api",
  "vat",
  "iban",
  "url",
]);

const CURRENCY_CODES = new Set(["eur", "usd", "gbp", "chf"]);

function labelToken(token: string, first: boolean): string {
  const t = token.toLowerCase();
  if (LABEL_ACRONYMS.has(t)) return t.toUpperCase();
  if (first) return t.charAt(0).toUpperCase() + t.slice(1);
  return t;
}

/**
 * Humanize a snake_case identifier: `failure_code` -> "Failure code",
 * `amount_eur` -> "Amount (EUR)", `mrr_eur` -> "MRR (EUR)".
 */
export function humanizeIdent(name: string): string {
  const tokens = name
    .replace(/[_\s]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (tokens.length === 0) return name;
  // Trailing currency code reads best in parens: "Revenue (EUR)".
  const last = tokens[tokens.length - 1]!.toLowerCase();
  const currencyTail = tokens.length > 1 && CURRENCY_CODES.has(last);
  const words = (currencyTail ? tokens.slice(0, -1) : tokens).map((t, i) =>
    labelToken(t, i === 0),
  );
  const base = words.join(" ");
  return currencyTail ? `${base} (${last.toUpperCase()})` : base;
}

const AGG_ALIAS_RE =
  /^(sum|avg|min|max|median|count_distinct|count)_(.+)$/;

/**
 * Friendly series/legend label for a measure alias or column name:
 * `sum_amount_eur` -> "Amount (EUR)", `avg_amount_eur` -> "Avg amount (EUR)",
 * `count` -> "Count", `count_distinct_customer_id` -> "Unique customer ID".
 */
export function prettifySeriesLabel(key: string): string {
  if (key === "count") return "Count";
  const m = key.match(AGG_ALIAS_RE);
  if (!m) return humanizeIdent(key);
  const agg = m[1]!;
  const base = humanizeIdent(m[2]!);
  // Keep leading acronyms intact ("MRR (EUR)" must not become "mRR (EUR)").
  const lower = /^[A-Z]{2,}/.test(base)
    ? base
    : base.charAt(0).toLowerCase() + base.slice(1);
  switch (agg) {
    case "sum":
      return base;
    case "avg":
      return `Avg ${lower}`;
    case "min":
      return `Min ${lower}`;
    case "max":
      return `Max ${lower}`;
    case "median":
      return `Median ${lower}`;
    case "count_distinct":
      return `Unique ${lower}`;
    default:
      return base;
  }
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

// ---------------------------------------------------------------------------
// Conditional formatting (spec.format.rules)
// ---------------------------------------------------------------------------

/** Threshold rule: first matching rule (in order) wins. */
export interface FormatRule {
  op: "gt" | "gte" | "lt" | "lte" | "eq";
  value: number;
  /** Any CSS color, e.g. "var(--chart-2)" or "#ef4444". */
  color: string;
}

function ruleMatches(rule: FormatRule, value: number): boolean {
  switch (rule.op) {
    case "gt":
      return value > rule.value;
    case "gte":
      return value >= rule.value;
    case "lt":
      return value < rule.value;
    case "lte":
      return value <= rule.value;
    case "eq":
      return value === rule.value;
  }
}

/** Color for the first matching rule, or null when none match. */
export function resolveRuleColor(
  value: number | null | undefined,
  rules: FormatRule[] | undefined,
): string | null {
  if (value == null || Number.isNaN(value) || !rules || rules.length === 0) {
    return null;
  }
  for (const rule of rules) {
    if (ruleMatches(rule, value)) return rule.color;
  }
  return null;
}
