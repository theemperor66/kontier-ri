"use client";

import { useEffect, useMemo, useRef } from "react";
import * as z from "zod";
import { recordToolCall } from "./call-log";

/**
 * Minimal typing for the WebMCP subset we use (see docs/webmcp-api-notes.md);
 * the `webmcp-types` npm package is the full official version.
 */
export interface ModelContextLike {
  registerTool(
    tool: {
      name: string;
      title?: string;
      description: string;
      inputSchema?: object;
      execute: (
        input: unknown,
        options?: { signal?: AbortSignal },
      ) => Promise<unknown>;
      annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
    },
    options?: { signal?: AbortSignal },
  ): Promise<void>;
}

declare global {
  interface Document {
    modelContext?: ModelContextLike;
  }
  interface Navigator {
    modelContext?: ModelContextLike;
  }
}

/** `document.modelContext` with `navigator.modelContext` legacy fallback. */
export function getModelContext(): ModelContextLike | null {
  if (typeof document === "undefined") return null;
  return document.modelContext ?? navigator.modelContext ?? null;
}

export type ToolRegistrationStatus =
  | "unavailable"
  | "registering"
  | "ready"
  | "failed"
  | "unregistered";

export interface WebMCPToolConfig<S extends z.ZodType> {
  /** <=128 chars, [a-z0-9_], verb_noun, stable across releases. */
  name: string;
  description: string;
  /** zod v4 schema; also re-validates incoming args inside execute. */
  inputSchema: S;
  execute: (input: z.output<S>, signal: AbortSignal) => Promise<unknown> | unknown;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
  /** Dynamic tools: flip to (un)register without unmounting. */
  enabled?: boolean;
  onError?: (err: unknown) => void;
  /** Reports the real registration lifecycle for honest connection UI. */
  onStatusChange?: (status: ToolRegistrationStatus, error?: unknown) => void;
}

/**
 * Register a WebMCP tool for the lifetime of the component.
 *
 * - Unregister via AbortController on unmount (Strict Mode safe; the pending
 *   registerTool promise rejects on abort — that rejection is swallowed).
 * - `execute` goes through a ref: a new function identity never re-registers.
 *   Re-registration happens only when name/description/schema/enabled change.
 * - Errors inside execute are returned as `{error}` so the model gets
 *   actionable text instead of an opaque failed call.
 */
/**
 * Build the `execute` callback handed to `modelContext.registerTool`.
 * Exported for tests. Contract hardening:
 * - validates raw input against the (latest) zod schema, returns `{error}` on
 *   invalid input instead of throwing;
 * - tolerates hosts that invoke `execute(input)` WITHOUT an options object
 *   (observed with manual `executeTool` invocation in Chrome 152); falls back
 *   to the registration-lifetime signal so aborts still propagate;
 * - converts thrown errors into `{error}` results the model can read.
 */
export function makeToolExecute(
  getSchema: () => z.ZodType,
  run: (input: unknown, signal: AbortSignal) => Promise<unknown> | unknown,
  fallbackSignal: AbortSignal,
  /**
   * Ledger hook. Called once per call the host attempted — including calls
   * rejected on schema validation.
   *
   * Rejected calls are logged deliberately. An agent sending the wrong shape
   * is one of the named WebMCP failure modes, and it is invisible everywhere
   * else: the tool never ran, so no document change and no activity entry
   * exist to hint at it. `rejected` marks that the tool body never executed.
   */
  onCall?: (entry: {
    args: unknown;
    startedAt: number;
    durationMs: number;
    result?: unknown;
    thrown?: unknown;
    rejected?: boolean;
  }) => void,
): (rawInput: unknown, options?: { signal?: AbortSignal }) => Promise<unknown> {
  return async (rawInput, options) => {
    const attemptedAt = Date.now();
    const parsed = getSchema().safeParse(rawInput);
    if (!parsed.success) {
      const error = `Invalid input: ${parsed.error.message}`;
      onCall?.({
        args: rawInput,
        startedAt: attemptedAt,
        durationMs: 0,
        thrown: error,
        rejected: true,
      });
      return { error };
    }
    const startedAt = Date.now();
    try {
      const result = await run(parsed.data, options?.signal ?? fallbackSignal);
      onCall?.({
        args: parsed.data,
        startedAt,
        durationMs: Date.now() - startedAt,
        result,
      });
      return result;
    } catch (err) {
      onCall?.({
        args: parsed.data,
        startedAt,
        durationMs: Date.now() - startedAt,
        thrown: err,
      });
      return { error: err instanceof Error ? err.message : String(err) };
    }
  };
}

export function useWebMCPTool<S extends z.ZodType>(
  config: WebMCPToolConfig<S>,
): void {
  const {
    name,
    description,
    inputSchema,
    annotations,
    enabled = true,
    onError,
    onStatusChange,
  } = config;

  const executeRef = useRef(config.execute);
  executeRef.current = config.execute;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  // zod v4 -> JSON Schema. Serialized string doubles as a stable dep key.
  const jsonSchema = useMemo(() => z.toJSONSchema(inputSchema), [inputSchema]);
  const schemaKey = useMemo(() => JSON.stringify(jsonSchema), [jsonSchema]);
  const zodRef = useRef(inputSchema);
  zodRef.current = inputSchema;
  const annotationsKey = JSON.stringify(annotations ?? {});

  useEffect(() => {
    if (!enabled) {
      onStatusChangeRef.current?.("unregistered");
      return;
    }

    const controller = new AbortController();
    let retryId: ReturnType<typeof setInterval> | undefined;
    let started = false;

    const register = (): boolean => {
      if (started || controller.signal.aborted) return started;
      const mc = getModelContext();
      if (!mc) {
        onStatusChangeRef.current?.("unavailable");
        return false;
      }
      started = true;
      onStatusChangeRef.current?.("registering");
      mc.registerTool(
        {
          name,
          description,
          inputSchema: JSON.parse(schemaKey) as object,
          annotations: JSON.parse(annotationsKey) as {
            readOnlyHint?: boolean;
            untrustedContentHint?: boolean;
          },
          execute: makeToolExecute(
            () => zodRef.current,
            (input, signal) => executeRef.current(input as z.output<S>, signal),
            controller.signal,
            (entry) => {
              // Read the hint from the same serialized copy the registration
              // used, so the ledger can never disagree with what was declared.
              const declared = JSON.parse(annotationsKey) as {
                readOnlyHint?: boolean;
              };
              recordToolCall({
                name,
                ...entry,
                ...(declared.readOnlyHint !== undefined
                  ? { readOnly: declared.readOnlyHint }
                  : {}),
              });
            },
          ),
        },
        { signal: controller.signal },
      )
        .then(() => {
          if (!controller.signal.aborted) {
            onStatusChangeRef.current?.("ready");
          }
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return; // unmount race: expected
          onStatusChangeRef.current?.("failed", err);
          onErrorRef.current?.(err); // dup name, bad schema, SecurityError...
          console.warn(`[webmcp] registerTool(${name}) failed`, err);
        });
      return true;
    };

    // Some browser hosts inject modelContext just after hydration. Retry the
    // feature check without re-registering; the first real attempt wins.
    if (!register()) {
      retryId = setInterval(() => {
        if (register() && retryId !== undefined) clearInterval(retryId);
      }, 1000);
    }

    return () => {
      if (retryId !== undefined) clearInterval(retryId);
      controller.abort();
      onStatusChangeRef.current?.("unregistered");
    };
  }, [name, description, schemaKey, annotationsKey, enabled]);
}
