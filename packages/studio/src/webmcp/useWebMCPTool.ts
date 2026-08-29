"use client";

import { useEffect, useMemo, useRef } from "react";
import * as z from "zod";

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
        options: { signal: AbortSignal },
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
export function useWebMCPTool<S extends z.ZodType>(
  config: WebMCPToolConfig<S>,
): void {
  const { name, description, inputSchema, annotations, enabled = true, onError } =
    config;

  const executeRef = useRef(config.execute);
  executeRef.current = config.execute;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // zod v4 -> JSON Schema. Serialized string doubles as a stable dep key.
  const jsonSchema = useMemo(() => z.toJSONSchema(inputSchema), [inputSchema]);
  const schemaKey = useMemo(() => JSON.stringify(jsonSchema), [jsonSchema]);
  const zodRef = useRef(inputSchema);
  zodRef.current = inputSchema;
  const annotationsKey = JSON.stringify(annotations ?? {});

  useEffect(() => {
    if (!enabled) return;
    const mc = getModelContext();
    if (!mc) return; // no WebMCP runtime: silent no-op (page shows a badge)

    const controller = new AbortController();

    mc.registerTool(
      {
        name,
        description,
        inputSchema: JSON.parse(schemaKey) as object,
        annotations: JSON.parse(annotationsKey) as {
          readOnlyHint?: boolean;
          untrustedContentHint?: boolean;
        },
        execute: async (rawInput, _options) => {
          const parsed = zodRef.current.safeParse(rawInput);
          if (!parsed.success) {
            return { error: `Invalid input: ${parsed.error.message}` };
          }
          try {
            return await executeRef.current(
              parsed.data as z.output<S>,
              _options.signal,
            );
          } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) };
          }
        },
      },
      { signal: controller.signal },
    ).catch((err: unknown) => {
      if (controller.signal.aborted) return; // unmount race: expected
      onErrorRef.current?.(err); // dup name, bad schema, SecurityError...
      console.warn(`[webmcp] registerTool(${name}) failed`, err);
    });

    return () => controller.abort(); // unregister on unmount
  }, [name, description, schemaKey, annotationsKey, enabled]);
}
