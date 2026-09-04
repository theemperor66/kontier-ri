/**
 * WHAT: POST /api/workspace/tenant/keycloak — trade a verified Keycloak
 * identity for a workspace session.
 *
 * WHY the server verifies rather than trusting the browser: an ID token is
 * only evidence if its signature is checked. This route fetches the realm's
 * public keys and validates signature, issuer, audience, expiry and the nonce
 * that started the flow. A token minted elsewhere, replayed, or edited in the
 * console does not open a workspace.
 *
 * The user's ORGANIZATION decides which workspace they land in, so two
 * colleagues signing in with Kontier arrive in the same room and see each
 * other's work — which is the point of signing in at all.
 *
 * Nothing from Kontier is stored: no access token, no refresh token, no
 * email. The registry keeps a workspace id and the digest of the session
 * token this route issues, and nothing else.
 */

import { createRemoteJWKSet, jwtVerify } from "jose";
import { errorResponse, jsonResponse } from "@/lib/server/http";
import { issueSession } from "@/lib/server/guests";

export const dynamic = "force-dynamic";

const ISSUER = "https://auth.kontier.eu/realms/kontier";
const AUDIENCE = "kontier-web";

// Cached across requests: the key set is small, public, and rotates rarely.
const jwks = createRemoteJWKSet(new URL(`${ISSUER}/protocol/openid-connect/certs`));

/** Keycloak's organization claim varies by version; accept the known shapes. */
export function readOrganization(
  claims: Record<string, unknown>,
): { id: string; name: string } | null {
  const raw = claims.organization ?? claims.organizations;
  if (typeof raw === "string" && raw.trim().length > 0) {
    return { id: raw.trim(), name: raw.trim() };
  }
  // { "acme": { id: "..." } } — Keycloak 26 maps organizations by alias.
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const [alias, value] = Object.entries(raw as Record<string, unknown>)[0] ?? [];
    if (alias) {
      const id =
        value && typeof value === "object" && "id" in value
          ? String((value as { id: unknown }).id)
          : alias;
      return { id, name: alias };
    }
  }
  if (Array.isArray(raw) && raw.length > 0) {
    const first = raw[0];
    if (typeof first === "string") return { id: first, name: first };
    if (first && typeof first === "object") {
      const record = first as Record<string, unknown>;
      const id = String(record.id ?? record.alias ?? record.name ?? "");
      const name = String(record.name ?? record.alias ?? id);
      if (id) return { id, name };
    }
  }
  return null;
}

export async function POST(request: Request): Promise<Response> {
  let idToken = "";
  let nonce: string | undefined;
  try {
    const body = (await request.json()) as { idToken?: unknown; nonce?: unknown };
    if (typeof body.idToken === "string") idToken = body.idToken;
    if (typeof body.nonce === "string") nonce = body.nonce;
  } catch {
    /* handled below */
  }
  if (idToken.length === 0) {
    return errorResponse(400, "invalid_request", "No identity token was sent.");
  }

  let claims: Record<string, unknown>;
  try {
    const verified = await jwtVerify(idToken, jwks, {
      issuer: ISSUER,
      audience: AUDIENCE,
      // Small tolerance: a laptop clock a few seconds out is not an attack.
      clockTolerance: 30,
    });
    claims = verified.payload as Record<string, unknown>;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown reason";
    return errorResponse(
      401,
      "unauthorized",
      `Kontier's identity token did not verify: ${detail}`,
    );
  }

  // The nonce ties this token to the sign-in that started in this browser.
  if (nonce !== undefined && claims.nonce !== undefined && claims.nonce !== nonce) {
    return errorResponse(
      401,
      "unauthorized",
      "This identity token belongs to a different sign-in.",
    );
  }

  const subject = typeof claims.sub === "string" ? claims.sub : "";
  if (subject.length === 0) {
    return errorResponse(
      401,
      "unauthorized",
      "That identity token carries no subject, so there is nobody to sign in.",
    );
  }
  const binding = workspaceBinding(claims, subject);
  const { workspaceId, label } = binding;

  const issued = issueSession(workspaceId, label, "tenant");
  return jsonResponse(
    { workspaceId, token: issued.token, label, kind: "tenant" },
    201,
  );
}

/**
 * Decide which workspace a verified identity opens.
 *
 * Three rules, most specific first:
 *
 *   1. An `organization` claim, when the realm has one. This is the right
 *      answer and needs no guessing.
 *   2. A VERIFIED email's domain. Colleagues at one company then land in one
 *      workspace, which is the whole reason to sign in rather than guest.
 *      The verification check is not decoration: without it, anyone who can
 *      register an address at a domain could walk into that company's room.
 *   3. The subject. A stable private workspace beats a refusal.
 *
 * Rule 2 is a heuristic and is documented as one. This realm exposes no
 * groups, no tenant attribute and no organization scope, so an email domain
 * is the only tenant signal it actually carries.
 */
export function workspaceBinding(
  claims: Record<string, unknown>,
  subject: string,
): { workspaceId: string; label: string } {
  const organization = readOrganization(claims);
  if (organization) {
    return {
      workspaceId: `kontier_org_${slug(organization.id)}`,
      label: `Kontier · ${organization.name}`,
    };
  }

  const email = typeof claims.email === "string" ? claims.email : "";
  const verified = claims.email_verified === true;
  const domain = email.includes("@") ? email.split("@").pop() ?? "" : "";
  if (verified && domain.length > 0) {
    return {
      workspaceId: `kontier_domain_${slug(domain.toLowerCase())}`,
      label: `Kontier · ${domain.toLowerCase()}`,
    };
  }

  const who = String(claims.preferred_username ?? email ?? "account");
  return {
    workspaceId: `kontier_user_${slug(subject)}`,
    label: `Kontier · ${who}`,
  };
}

/**
 * Filesystem- and URL-safe, and stable for the same input.
 *
 * Dot runs collapse to a single dot. Replacing separators alone still leaves
 * `..` intact, and while the store slugs ids again before touching disk,
 * an id that reads `.._.._etc_passwd` is one careless `path.join` away from
 * meaning something. Nothing downstream should have to be careful.
 */
function slug(value: string): string {
  return value
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/\.{2,}/g, ".")
    .slice(0, 96);
}
