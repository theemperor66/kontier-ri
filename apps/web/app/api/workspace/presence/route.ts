/**
 * WHAT: POST /api/workspace/presence — a heartbeat that says "this actor is
 * here, on this dashboard", and answers with every live peer.
 *
 * WHY: presence is soft state, so it is a single write-and-read call instead
 * of a subscription: no socket to keep open, nothing to clean up, and an
 * entry disappears on its own 30 seconds after the last ping (see
 * PRESENCE_TTL_MS). The answer includes the caller, so a client can render
 * the whole roster and decide itself whether to hide "me".
 */

import { jsonResponse, readJson, withWorkspace } from "@/lib/server/http";
import { presenceSchema } from "@/lib/server/schemas";

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

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request, presenceSchema);
  if (!body.ok) return body.response;
  return withWorkspace(request, async (store) => {
    const peers = await store.touchPresence({
      actor: body.data.actor,
      label: body.data.label,
      dashboardId: body.data.dashboardId,
    });
    return jsonResponse({ peers });
  });
}
