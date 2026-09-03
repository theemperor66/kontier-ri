/**
 * WHAT: POST / GET /api/workspace/dashboards/:id/commands — append to the
 * per-dashboard command log and read everything after a cursor.
 *
 * WHY: this is the one thing a shared server can do that a browser cannot:
 * give every participant (human or agent) the SAME order of events. The
 * server, not the client clock, assigns `seq`; `at` is kept for display only.
 * A reader polls with `?since=<cursor>` and applies entries in `seq` order.
 *
 * The log is keyed by dashboard id and does not require the dashboard to
 * exist yet: a client may report a command in the same tick it first saves
 * the dashboard, and losing that ordering would defeat the purpose.
 */

import { jsonResponse, readId, readJson, readSince, withWorkspace } from "@/lib/server/http";
import type { RouteContext } from "@/lib/server/http";
import { postCommandsSchema } from "@/lib/server/schemas";

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
  const since = readSince(request);
  if (!since.ok) return since.response;
  return withWorkspace(request, async (store) =>
    jsonResponse(await store.readCommands(id.data, since.data)),
  );
}

export async function POST(
  request: Request,
  context: RouteContext<"id">,
): Promise<Response> {
  const id = readId((await context.params).id, "dashboard id");
  if (!id.ok) return id.response;
  const body = await readJson(request, postCommandsSchema);
  if (!body.ok) return body.response;
  return withWorkspace(request, async (store) => {
    const cursor = await store.appendCommands(id.data, body.data.entries);
    return jsonResponse({ cursor }, 201);
  });
}
