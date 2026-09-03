/**
 * WHAT: GET / PUT / DELETE /api/workspace/dashboards/:id — read, upsert and
 * remove one dashboard (document included).
 *
 * WHY: the client store owns the document and pushes the whole thing on
 * change; the server is durable storage plus the shared-order guarantee, so a
 * full-document PUT is the honest primitive (no partial merge, no conflict
 * resolution the client cannot see).
 *
 * A missing dashboard answers 404 *with* the `{ dashboard: null }` body from
 * the contract, so a client can read the body on 404 and still get null.
 */

import {
  jsonResponse,
  notFoundResponse,
  readId,
  readJson,
  withWorkspace,
} from "@/lib/server/http";
import type { RouteContext } from "@/lib/server/http";
import { putDashboardSchema } from "@/lib/server/schemas";

// Export-safe segment config. On a real server this route must never be
// cached: `force-dynamic`. In a static export (NEXT_OUTPUT=export) the route
// must simply not exist — and Next refuses to *build* a `force-dynamic` route
// handler with `output: export` (error E278, thrown while collecting page
// data), so the export build gets `"error"` instead: nothing is prerendered,
// no file is emitted, and the path 404s on GitHub Pages. See the note at the
// top of lib/server/http.ts.
export const dynamic = process.env.NEXT_OUTPUT === "export" ? "error" : "force-dynamic";

/**
 * `output: export` refuses a dynamic segment without `generateStaticParams`.
 * There is nothing to pre-render here, so the export contains zero instances
 * of this route; on a server, `dynamic = "force-dynamic"` ignores this.
 */
export function generateStaticParams(): Array<{ id: string }> {
  return [];
}

export async function GET(
  request: Request,
  context: RouteContext<"id">,
): Promise<Response> {
  const id = readId((await context.params).id, "dashboard id");
  if (!id.ok) return id.response;
  return withWorkspace(request, async (store) => {
    const dashboard = await store.readDashboard(id.data);
    if (!dashboard) {
      return notFoundResponse("dashboard", `No dashboard "${id.data}" in this workspace.`);
    }
    return jsonResponse({ dashboard });
  });
}

export async function PUT(
  request: Request,
  context: RouteContext<"id">,
): Promise<Response> {
  const id = readId((await context.params).id, "dashboard id");
  if (!id.ok) return id.response;
  const body = await readJson(request, putDashboardSchema);
  if (!body.ok) return body.response;
  return withWorkspace(request, async (store) => {
    const { dashboard, created } = await store.writeDashboard(id.data, {
      name: body.data.name,
      doc: body.data.doc,
    });
    return jsonResponse({ dashboard }, created ? 201 : 200);
  });
}

export async function DELETE(
  request: Request,
  context: RouteContext<"id">,
): Promise<Response> {
  const id = readId((await context.params).id, "dashboard id");
  if (!id.ok) return id.response;
  return withWorkspace(request, async (store) => {
    const deleted = await store.deleteDashboard(id.data);
    if (!deleted) {
      return notFoundResponse("dashboard", `No dashboard "${id.data}" in this workspace.`);
    }
    return jsonResponse({ ok: true });
  });
}
