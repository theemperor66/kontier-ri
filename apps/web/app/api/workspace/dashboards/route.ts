/**
 * WHAT: GET /api/workspace/dashboards — the dashboard index of the caller's
 * workspace, newest first.
 *
 * WHY: the client store needs one cheap call to render the dashboard switcher,
 * so this returns summaries (no documents).
 */

import { jsonResponse, withWorkspace } from "@/lib/server/http";

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

export async function GET(request: Request): Promise<Response> {
  return withWorkspace(request, async (store) =>
    jsonResponse({ dashboards: await store.listDashboards() }),
  );
}
