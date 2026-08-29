# `useWebMCPTool` — draft React hook for Kontier RI

Draft based on the spike findings (`docs/webmcp-api-notes.md`). Do not scaffold
here; this lands in `packages/studio/src/webmcp/` later.

Design decisions:

- **Entry point**: `document.modelContext ?? navigator.modelContext` (legacy fallback; Cloudflare's adapter and older Chrome previews use `navigator.*`).
- **Unregister = `AbortController`**: `registerTool(tool, { signal })`; abort on unmount. The pending `registerTool` promise **rejects on abort** — swallow `AbortError` only.
- **Strict Mode safe**: mount → register, cleanup → abort (unregisters), remount → fresh register with same name is legal (spec removes the tool-map entry on abort). Duplicate-name `InvalidStateError` is surfaced via `onError` — it means two live components claim one tool name, which is a real bug.
- **Latest-closure execute**: `execute` goes through a ref so we never re-register just because a render produced a new function identity. Re-registration happens only when `name`/`description`/serialized schema change.
- **zod v4 single source of truth**: pass a `z.object(...)`; the hook derives `inputSchema` via `z.toJSONSchema(schema)` and ALSO re-validates incoming args with `schema.parse` inside execute (agents can send anything).
- **Result shape**: return plain JSON-serializable objects; the browser `JSON.stringify`s them for the agent. Errors → return `{ error: message }` rather than throwing, so the model gets actionable text (a rejected promise reaches the agent as an opaque failure).
- **SSR safe**: everything inside `useEffect`; no `document` access at render time.

```ts
// packages/studio/src/webmcp/useWebMCPTool.ts
"use client";

import { useEffect, useMemo, useRef } from "react";
import * as z from "zod";

/** Minimal typing for the subset we use; webmcp-types npm pkg is the full version. */
interface ModelContextLike {
  registerTool(
    tool: {
      name: string;
      title?: string;
      description: string;
      inputSchema?: object;
      execute: (input: unknown, options: { signal: AbortSignal }) => Promise<unknown>;
      annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
    },
    options?: { signal?: AbortSignal },
  ): Promise<void>;
}

declare global {
  interface Document { modelContext?: ModelContextLike }
  interface Navigator { modelContext?: ModelContextLike }
}

export function getModelContext(): ModelContextLike | null {
  if (typeof document === "undefined") return null;
  return document.modelContext ?? navigator.modelContext ?? null;
}

export interface WebMCPToolConfig<S extends z.ZodType> {
  name: string;                 // <=128 chars, [A-Za-z0-9_.-]
  description: string;          // non-empty
  inputSchema: S;               // zod v4 schema (z.object({...}))
  execute: (input: z.output<S>, signal: AbortSignal) => Promise<unknown> | unknown;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
  enabled?: boolean;            // dynamic tools: flip to (un)register
  onError?: (err: unknown) => void;
}

export function useWebMCPTool<S extends z.ZodType>(config: WebMCPToolConfig<S>) {
  const { name, description, inputSchema, annotations, enabled = true, onError } = config;

  // Latest-closure refs: changing execute/onError never re-registers.
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
    if (!mc) return; // no WebMCP runtime: silent no-op (page shows a badge elsewhere)

    const controller = new AbortController();

    mc.registerTool(
      {
        name,
        description,
        inputSchema: JSON.parse(schemaKey),
        annotations: JSON.parse(annotationsKey),
        execute: async (rawInput, { signal }) => {
          const parsed = zodRef.current.safeParse(rawInput);
          if (!parsed.success) {
            return { error: `Invalid input: ${parsed.error.message}` };
          }
          try {
            return await executeRef.current(parsed.data, signal);
          } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) };
          }
        },
      },
      { signal: controller.signal },
    ).catch((err: unknown) => {
      if (controller.signal.aborted) return;          // unmount race: expected
      onErrorRef.current?.(err);                       // dup name, bad schema, SecurityError...
      console.warn(`[webmcp] registerTool(${name}) failed`, err);
    });

    return () => controller.abort();                   // unregister on unmount
  }, [name, description, schemaKey, annotationsKey, enabled]);
}
```

Usage sketch (dynamic tool tied to selection — the spec-leverage demo):

```tsx
function SelectedTileTools({ tile }: { tile: Tile }) {
  useWebMCPTool({
    name: "restyle_selected_tile",
    description: `Restyle the currently selected ${tile.type} tile ("${tile.title}"). ` +
      "Changes chart type or color of the tile the user has selected.",
    inputSchema: z.object({
      chartType: z.enum(["line", "bar", "area", "pie"]).optional(),
      color: z.string().optional(),
    }),
    execute: async (input) => {
      dispatch({ by: "agent", type: "restyleTile", tileId: tile.id, ...input });
      return { ok: true, tileId: tile.id };
    },
  });
  return null; // mount inside the selection subtree; unmount on deselect
}
```

Open items to verify in the real app (see risks R1/R3 in the notes):

1. ChatGPT desktop: does it pick up tools registered *after* page load / re-registered on selection change? If not, fall back to static `edit_tile(tileId, ...)` tools.
2. Chrome <153: aborting mid-execution cancels the in-flight call — avoid unmounting the registering component from inside its own tool's `execute`.
3. `enabled` flag vs. mount/unmount: both patterns work; prefer mount/unmount for selection-scoped tools (cleaner attribution).
