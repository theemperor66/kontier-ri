/**
 * WHAT: POST /api/workspace/guest — create a guest workspace and return its
 * one-time token.
 *
 * WHY this route is unauthenticated: it is the front door. A visitor with no
 * account presses one button and gets a workspace they can invite people
 * into. Requiring a credential to obtain a credential would defeat it.
 *
 * Because it is unauthenticated it is also the only route that allocates
 * disk on an anonymous caller's word, so it is capped, rate-limited and
 * expiring (see lib/server/guests.ts). The token is returned exactly once.
 */

import { errorResponse, jsonResponse } from "@/lib/server/http";
import { createGuestWorkspace } from "@/lib/server/guests";

export const dynamic = process.env.NEXT_OUTPUT === "export" ? "error" : "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let label = "";
  try {
    const body = (await request.json()) as unknown;
    if (typeof body === "object" && body !== null && "label" in body) {
      const raw = (body as { label?: unknown }).label;
      if (typeof raw === "string") label = raw;
    }
  } catch {
    // A missing or unparsable body is fine: the label is optional.
  }

  const created = createGuestWorkspace(label);
  if (!created.ok) {
    if (created.reason === "disabled") {
      return errorResponse(
        503,
        "not_configured",
        "Guest workspaces are turned off on this deployment.",
      );
    }
    if (created.reason === "rate_limited") {
      return errorResponse(
        429,
        "rate_limited",
        "Too many workspaces were created recently. Try again shortly.",
      );
    }
    return errorResponse(
      507,
      "at_capacity",
      "This deployment is holding its maximum number of guest workspaces.",
    );
  }

  // The token is the credential AND the invite. It is returned once and never
  // retrievable again, so the client must persist the link it builds from it.
  return jsonResponse(
    {
      workspaceId: created.guest.workspaceId,
      token: created.guest.token,
      label: created.guest.label,
    },
    201,
  );
}
