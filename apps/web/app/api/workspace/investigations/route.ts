/**
 * WHAT: GET / POST /api/workspace/investigations — the workspace's completed
 * investigation records (newest first) and the write that stores one.
 *
 * WHY: an investigation record is the conclusion of a work session. It is
 * read-only history, so the write is an idempotent upsert by record id: the
 * client recorder is at-least-once and must be able to re-send safely.
 */

import { jsonResponse, readJson, withWorkspace } from "@/lib/server/http";
import { investigationSchema } from "@/lib/server/schemas";

// Export-safe segment config. On a real server this route must never be
// cached: `force-dynamic`. In a static export (NEXT_OUTPUT=export) the route
// must simply not exist — and Next refuses to *build* a `force-dynamic` route
// handler with `output: export` (error E278, thrown while collecting page
// data), so the export build gets `"error"` instead: nothing is prerendered,
// no file is emitted, and the path 404s on GitHub Pages. See the note at the
// top of lib/server/http.ts.
export const dynamic = process.env.NEXT_OUTPUT === "export" ? "error" : "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withWorkspace(request, async (store) =>
    jsonResponse({ investigations: await store.listInvestigations() }),
  );
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request, investigationSchema);
  if (!body.ok) return body.response;
  return withWorkspace(request, async (store) => {
    await store.saveInvestigation(body.data);
    return jsonResponse({ ok: true }, 201);
  });
}
