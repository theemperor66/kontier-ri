/**
 * WHAT: GET / DELETE /api/workspace/dashboards/:id/versions/:vid — read one
 * snapshot (document included, that is what "restore" needs) or drop it.
 *
 * WHY: restoring is an ordinary dashboard load in this product, so the server
 * only has to hand back the stored document; the client does the rest.
 */

import { jsonResponse, notFoundResponse, readId, withWorkspace } from "@/lib/server/http";
import type { RouteContext } from "@/lib/server/http";

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
export function generateStaticParams(): Array<{ id: string; vid: string }> {
  return [];
}

export async function GET(
  request: Request,
  context: RouteContext<"id" | "vid">,
): Promise<Response> {
  const params = await context.params;
  const id = readId(params.id, "dashboard id");
  if (!id.ok) return id.response;
  const vid = readId(params.vid, "version id");
  if (!vid.ok) return vid.response;
  return withWorkspace(request, async (store) => {
    const version = await store.readVersion(id.data, vid.data);
    if (!version) {
      return notFoundResponse("version", `No version "${vid.data}" for dashboard "${id.data}".`);
    }
    return jsonResponse({ version });
  });
}

export async function DELETE(
  request: Request,
  context: RouteContext<"id" | "vid">,
): Promise<Response> {
  const params = await context.params;
  const id = readId(params.id, "dashboard id");
  if (!id.ok) return id.response;
  const vid = readId(params.vid, "version id");
  if (!vid.ok) return vid.response;
  return withWorkspace(request, async (store) => {
    const deleted = await store.deleteVersion(id.data, vid.data);
    if (!deleted) {
      return notFoundResponse("version", `No version "${vid.data}" for dashboard "${id.data}".`);
    }
    return jsonResponse({ ok: true });
  });
}
