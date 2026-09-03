/**
 * WHAT: POST /api/workspace/tenant — hand out the shared demo tenant session.
 *
 * WHY a route gives away a token: the token cannot live in the client bundle,
 * because a bundle is world-readable and this repository is public. So the
 * server holds it and hands it out on request. That makes it a DELIBERATELY
 * PUBLIC credential, in the same category as a Stripe publishable key, and it
 * must therefore be scoped to a workspace that holds nothing private:
 * synthetic demo data only.
 *
 * The point is that everyone who presses the button lands in the SAME
 * workspace. Two people who have never met, with no accounts, are then
 * working one live report together — which is the thing the product claims.
 *
 * Configure with KONTIER_DEMO_TENANT="<token>:<workspaceId>:<label>", and use
 * a token that also appears in KONTIER_WORKSPACE_TOKENS so it authenticates.
 * Unset means the button is unavailable, reported honestly as 503.
 */

import { errorResponse, jsonResponse } from "@/lib/server/http";

// Must be a static literal: Next cannot read a computed `dynamic`
// field, and a ternary here failed the whole build. The static
// export simply omits app/api (see scripts/export-build.mjs).
export const dynamic = "force-dynamic";

interface DemoTenant {
  token: string;
  workspaceId: string;
  label: string;
}

/** Parse `token:workspaceId:label`; the label may itself contain ":". */
export function parseDemoTenant(raw: string | undefined): DemoTenant | null {
  if (!raw || raw.trim().length === 0) return null;
  const parts = raw.split(":");
  const token = parts[0]?.trim() ?? "";
  const workspaceId = parts[1]?.trim() ?? "";
  const label = parts.slice(2).join(":").trim();
  if (token.length === 0 || workspaceId.length === 0) return null;
  return {
    token,
    workspaceId,
    label: label.length > 0 ? label : "Kontier demo tenant",
  };
}

export async function POST(): Promise<Response> {
  const tenant = parseDemoTenant(process.env.KONTIER_DEMO_TENANT);
  if (tenant === null) {
    return errorResponse(
      503,
      "not_configured",
      "No shared demo tenant is configured on this deployment. " +
        "Start a guest workspace instead.",
    );
  }
  return jsonResponse({
    workspaceId: tenant.workspaceId,
    token: tenant.token,
    label: tenant.label,
    kind: "tenant",
  });
}
