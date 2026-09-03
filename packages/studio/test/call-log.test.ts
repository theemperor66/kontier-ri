import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_CALL_LOG_ENTRIES,
  getToolCalls,
  previewArgs,
  recordToolCall,
  resetToolCallsForTest,
  subscribeToolCalls,
} from "../src/webmcp/call-log";
import { makeToolExecute } from "../src/webmcp/useWebMCPTool";
import * as z from "zod";

beforeEach(() => resetToolCallsForTest());

describe("tool call ledger", () => {
  it("records a successful call with a duration and the declared read hint", () => {
    const record = recordToolCall({
      name: "run_sql",
      args: { sql: "select 1" },
      startedAt: 1_000,
      durationMs: 12.6,
      result: { rows: [] },
      readOnly: true,
    });
    expect(record.seq).toBe(1);
    expect(record.ok).toBe(true);
    expect(record.readOnly).toBe(true);
    // Rounded, never negative: a ledger row is read by a human.
    expect(record.durationMs).toBe(13);
    expect(record.argsPreview).toBe('{"sql":"select 1"}');
    expect(record.error).toBeUndefined();
  });

  it("treats an {error} result as a failure, not a success", () => {
    // makeToolExecute deliberately RETURNS errors so the model gets readable
    // text. The ledger must not read that as a healthy call.
    const record = recordToolCall({
      name: "add_tile",
      args: {},
      startedAt: 0,
      durationMs: 1,
      result: { error: "unknown dataset" },
    });
    expect(record.ok).toBe(false);
    expect(record.error).toBe("unknown dataset");
    expect(record.argsPreview).toBe("—");
  });

  it("records a thrown error", () => {
    const record = recordToolCall({
      name: "run_sql",
      args: { sql: "drop table t" },
      startedAt: 0,
      durationMs: 1,
      thrown: new Error("read-only"),
    });
    expect(record.ok).toBe(false);
    expect(record.error).toBe("read-only");
  });

  it("keeps a monotonic sequence and drops the oldest beyond the cap", () => {
    for (let i = 0; i < MAX_CALL_LOG_ENTRIES + 5; i += 1) {
      recordToolCall({ name: "t", args: i, startedAt: 0, durationMs: 0 });
    }
    const entries = getToolCalls();
    expect(entries).toHaveLength(MAX_CALL_LOG_ENTRIES);
    // Oldest dropped, sequence never reused or reset.
    expect(entries[0]!.seq).toBe(6);
    expect(entries[entries.length - 1]!.seq).toBe(MAX_CALL_LOG_ENTRIES + 5);
  });

  it("notifies subscribers and stops after unsubscribe", () => {
    const seen: number[] = [];
    const stop = subscribeToolCalls((entries) => seen.push(entries.length));
    recordToolCall({ name: "a", args: {}, startedAt: 0, durationMs: 0 });
    stop();
    recordToolCall({ name: "b", args: {}, startedAt: 0, durationMs: 0 });
    expect(seen).toEqual([1]);
    expect(getToolCalls()).toHaveLength(2);
  });

  it("truncates long arguments and survives unserializable input", () => {
    expect(previewArgs({ sql: "x".repeat(500) }).length).toBeLessThanOrEqual(160);
    expect(previewArgs({ sql: "x".repeat(500) }).endsWith("…")).toBe(true);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(previewArgs(cyclic)).toBe("(unserializable)");
    expect(previewArgs(undefined)).toBe("—");
  });
});

describe("makeToolExecute feeds the ledger", () => {
  const schema = z.object({ value: z.number() });

  it("logs a completed call once, with validated input", async () => {
    const onCall = vi.fn();
    const exec = makeToolExecute(
      () => schema,
      (input) => ({ echoed: input }),
      new AbortController().signal,
      onCall,
    );
    await exec({ value: 7 });
    expect(onCall).toHaveBeenCalledTimes(1);
    const entry = onCall.mock.calls[0]![0] as { args: unknown; result: unknown };
    expect(entry.args).toEqual({ value: 7 });
    expect(entry.result).toEqual({ echoed: { value: 7 } });
  });

  it("logs a schema-rejected call and marks that nothing ran", async () => {
    // An agent sending the wrong shape is a named WebMCP failure mode, and it
    // leaves no other trace: no document change, no activity entry. The
    // ledger is the only place it can surface, so it must be logged — but
    // marked, because the tool body never executed.
    const onCall = vi.fn();
    const ran = vi.fn(() => "unreachable");
    const exec = makeToolExecute(
      () => schema,
      ran,
      new AbortController().signal,
      onCall,
    );
    const result = await exec({ value: "not a number" });
    expect(result).toMatchObject({ error: expect.stringContaining("Invalid input") });
    expect(ran).not.toHaveBeenCalled();
    expect(onCall).toHaveBeenCalledTimes(1);
    const entry = onCall.mock.calls[0]![0] as {
      rejected?: boolean;
      args: unknown;
      startedAt: number;
      durationMs: number;
      thrown?: unknown;
    };
    expect(entry.rejected).toBe(true);
    // The RAW arguments are kept: the point is to see what the agent sent.
    expect(entry.args).toEqual({ value: "not a number" });

    const record = recordToolCall({ name: "t", ...entry });
    expect(record.ok).toBe(false);
    expect(record.rejected).toBe(true);
    expect(record.error).toContain("Invalid input");
  });

  it("logs a thrown execute as a failed call", async () => {
    const onCall = vi.fn();
    const exec = makeToolExecute(
      () => schema,
      () => {
        throw new Error("engine offline");
      },
      new AbortController().signal,
      onCall,
    );
    await exec({ value: 1 });
    const entry = onCall.mock.calls[0]![0] as { thrown: unknown };
    expect((entry.thrown as Error).message).toBe("engine offline");
  });
});
