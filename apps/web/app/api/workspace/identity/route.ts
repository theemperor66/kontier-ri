/**
 * WHAT: GET /api/workspace/identity — which workspace this token opens.
 *
 * WHY it exists: HttpWorkspaceStore calls it as its connection check, and it
 * was the one endpoint in the client contract the server never implemented.
 * The result was silent and total: identity() 404'd, the client treated the
 * whole workspace as unreachable, and neither document sync nor presence ever
 * started. Everything looked built and nothing was connected.
 *
 * It returns the principal the token resolved to, which is also the cheapest
 * honest way for a client to ask "is this credential still good?".
 */

import { jsonResponse, withWorkspace } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withWorkspace(request, async (store, principal) =>
    jsonResponse({
      workspaceId: principal.workspaceId,
      label: principal.label,
      // Always "remote" from the server's side: reaching this route at all
      // means the caller is not browser-only.
      kind: "remote",
      // Not part of WorkspaceIdentity, but the UI is allowed to say whether
      // you are a guest or a provisioned tenant, and only the server knows.
      principalKind: principal.kind,
      dashboards: (await store.listDashboards()).length,
    }),
  );
}
