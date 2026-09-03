/**
 * Tool call ledger: every WebMCP invocation this page served.
 *
 * WebMCP is invisible by design — an agent calls a tool and the result goes
 * back into a model's context, leaving no trace on the page. That is fine for
 * the agent and terrible for the human sitting in front of it, who cannot tell
 * a working integration from a broken one, or a read from a write.
 *
 * So the page keeps its own ledger. It is a plain observable ring buffer with
 * no React or store dependency, because it is written from inside `execute`,
 * which runs outside React's world.
 *
 * It records what the call did, not what it returned: arguments are truncated
 * to a preview and results are reduced to a one-line summary. The ledger is
 * evidence of activity, never a second copy of the data.
 */

/** How many calls are kept. Older entries are dropped, oldest first. */
export const MAX_CALL_LOG_ENTRIES = 200;

/** Longest argument preview kept per call, in characters. */
const ARGS_PREVIEW_LIMIT = 160;

export interface ToolCallRecord {
  /** Monotonic per-page sequence, starting at 1. Never reused. */
  seq: number;
  name: string;
  /** Truncated JSON of the validated input, or "—" when there was none. */
  argsPreview: string;
  /** Epoch ms when execute was entered. */
  startedAt: number;
  durationMs: number;
  /** False when execute threw, or returned an `{error}` result. */
  ok: boolean;
  /** Present only when the call failed. */
  error?: string;
  /** From the tool's own annotations; undefined when it declared none. */
  readOnly?: boolean;
  /**
   * True when the host rejected the arguments and the tool body never ran.
   * Distinct from a failure inside the tool: nothing was attempted.
   */
  rejected?: boolean;
}

type Listener = (entries: readonly ToolCallRecord[]) => void;

let entries: ToolCallRecord[] = [];
let seq = 0;
const listeners = new Set<Listener>();

function emit(): void {
  const snapshot = entries;
  for (const listener of listeners) listener(snapshot);
}

/** Truncate an argument object to a short, single-line preview. */
export function previewArgs(input: unknown): string {
  if (input === undefined || input === null) return "—";
  let text: string;
  try {
    text = JSON.stringify(input) ?? String(input);
  } catch {
    return "(unserializable)";
  }
  if (text === "{}") return "—";
  return text.length > ARGS_PREVIEW_LIMIT
    ? `${text.slice(0, ARGS_PREVIEW_LIMIT - 1)}…`
    : text;
}

/**
 * Record one completed call. Returns the stored record.
 *
 * A result shaped `{error: string}` counts as a failure even though execute
 * returned normally: that is the contract `makeToolExecute` uses to hand a
 * readable error to the model instead of throwing at the host.
 */
export function recordToolCall(input: {
  name: string;
  args: unknown;
  startedAt: number;
  durationMs: number;
  result?: unknown;
  thrown?: unknown;
  readOnly?: boolean;
  rejected?: boolean;
}): ToolCallRecord {
  const resultError =
    input.thrown !== undefined
      ? input.thrown instanceof Error
        ? input.thrown.message
        : String(input.thrown)
      : isErrorResult(input.result)
        ? input.result.error
        : undefined;

  seq += 1;
  const record: ToolCallRecord = {
    seq,
    name: input.name,
    argsPreview: previewArgs(input.args),
    startedAt: input.startedAt,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    ok: resultError === undefined,
    ...(resultError !== undefined ? { error: resultError } : {}),
    ...(input.readOnly !== undefined ? { readOnly: input.readOnly } : {}),
    ...(input.rejected ? { rejected: true } : {}),
  };

  const next = [...entries, record];
  entries = next.length > MAX_CALL_LOG_ENTRIES
    ? next.slice(next.length - MAX_CALL_LOG_ENTRIES)
    : next;
  emit();
  return record;
}

function isErrorResult(value: unknown): value is { error: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
  );
}

/** Newest last, matching the order the calls happened. */
export function getToolCalls(): readonly ToolCallRecord[] {
  return entries;
}

export function subscribeToolCalls(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam only. The product never clears its own audit trail. */
export function resetToolCallsForTest(): void {
  entries = [];
  seq = 0;
  emit();
}
