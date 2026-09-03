/**
 * WHAT: GET / POST /api/workspace/dashboards/:id/versions — list the snapshot
 * history of one dashboard (newest first) and take a new snapshot.
 *
 * WHY: version history is the product's restore point before agent work is
 * applied. On a shared server it has to live next to the dashboard, or a
 * second person loses the history the first person relied on.
 *
 * A snapshot belongs to a dashboard, so posting to an unknown id is a 404
 * rather than a silently orphaned version.
 */

import { jsonResponse, notFoundResponse, readId, readJson, withWorkspace } from "@/lib/server/http";
import type { RouteContext } from "@/lib/server/http";
import { postVersionSchema } from "@/lib/server/schemas";

// Export-safe segment config. On a real server this route must never be
// cached: `force-dynamic`. In a static export (NEXT_OUTPUT=export) the route
// must simply not exist — and Next refuses to *build* a `force-dynamic` route
// handler with `output: export` (error E278, thrown while collecting page
// data), so the export build gets `"error"` instead: nothing is prerendered,
// no file is emitted, and the path 404s on GitHub Pages. See the note at the
// top of lib/server/http.ts.
// Must be a static literal: Next cannot read a computed `dynamic`
// field, and a ternary here failed the whole build. The static
// export simply omits app/api (see scripts/export-build.mjs).
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: RouteContext<"id">,
): Promise<Response> {
  const id = readId((await context.params).id, "dashboard id");
  if (!id.ok) return id.response;
  return withWorkspace(request, async (store) => {
    const versions = await store.listVersions(id.data);
    if (versions === null) {
      return notFoundResponse("versions", `No dashboard "${id.data}" in this workspace.`);
    }
    return jsonResponse({ versions });
  });
}

export async function POST(
  request: Request,
  context: RouteContext<"id">,
): Promise<Response> {
  const id = readId((await context.params).id, "dashboard id");
  if (!id.ok) return id.response;
  const body = await readJson(request, postVersionSchema);
  if (!body.ok) return body.response;
  return withWorkspace(request, async (store) => {
    const version = await store.createVersion(id.data, {
      label: body.data.label,
      doc: body.data.doc,
    });
    if (version === null) {
      return notFoundResponse("version", `No dashboard "${id.data}" in this workspace.`);
    }
    return jsonResponse({ version }, 201);
  });
}
