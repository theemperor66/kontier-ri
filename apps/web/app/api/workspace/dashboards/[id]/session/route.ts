/**
 * WHAT: GET / PUT /api/workspace/dashboards/:id/session — the shared
 * collaboration state for one dashboard.
 *
 * WHY it is not part of the document: a pending agent proposal is not part of
 * the report. It must not be undoable with the report, and it must not land
 * inside a version snapshot. But a second person cannot review a proposal
 * they cannot see, so it still has to travel — separately.
 *
 * This is what makes cross-user approval possible: an agent proposes a change
 * set in one browser and a DIFFERENT human reviews it in another.
 *
 * The body is opaque. Its shape belongs to the studio package and changes
 * often; a server that pinned it would reject next week's proposals.
 */

import { jsonResponse, readId, readJson, withWorkspace } from "@/lib/server/http";
import type { RouteContext } from "@/lib/server/http";
import { putSessionSchema } from "@/lib/server/schemas";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: RouteContext<"id">,
): Promise<Response> {
  const id = readId((await context.params).id, "dashboard id");
  if (!id.ok) return id.response;
  return withWorkspace(request, async (store) => {
    const session = await store.readSession(id.data);
    // 404 carries the typed null, so a client can read the body either way.
    return jsonResponse({ session }, session ? 200 : 404);
  });
}

export async function PUT(
  request: Request,
  context: RouteContext<"id">,
): Promise<Response> {
  const id = readId((await context.params).id, "dashboard id");
  if (!id.ok) return id.response;
  const body = await readJson(request, putSessionSchema);
  if (!body.ok) return body.response;
  return withWorkspace(request, async (store) =>
    jsonResponse({ session: await store.writeSession(id.data, body.data.state) }),
  );
}
