"use client";

/**
 * Sign in with Kontier, through the Keycloak that already runs the platform.
 *
 * Authorization Code with PKCE against the existing public `kontier-web`
 * client. Nothing new had to be registered: that client's redirect URIs
 * already cover `https://*.kontier.eu/*` and its web origins already include
 * this host, so ri.kontier.eu is a first-class Kontier surface rather than a
 * side door with its own credentials.
 *
 * PKCE and a public client mean there is no secret in this bundle to leak.
 * The verifier lives in sessionStorage for the length of one redirect and is
 * used exactly once; `state` and `nonce` are checked on return, so a code
 * replayed from somewhere else does not become a session here.
 */

const ISSUER = "https://auth.kontier.eu/realms/kontier";
const CLIENT_ID = "kontier-web";
// Only scopes this realm actually grants. `organization` is in the realm
// IMPORT file but does not exist on the live server — Keycloak's organization
// feature is not enabled — and asking for it fails the whole request with
// invalid_scope. The server still reads an organization claim when one
// appears, so enabling the feature later needs no change here.
const SCOPE = "openid profile email";
const VERIFIER_KEY = "kontier-ri:oidc:verifier";
const STATE_KEY = "kontier-ri:oidc:state";
const NONCE_KEY = "kontier-ri:oidc:nonce";

export const KEYCLOAK_ISSUER = ISSUER;
export const KEYCLOAK_CLIENT_ID = CLIENT_ID;

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomString(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64Url(new Uint8Array(digest));
}

export function callbackUrl(): string {
  return `${window.location.origin}/auth/callback`;
}

/** Send the browser to Keycloak. Never returns. */
export async function beginKontierSignIn(): Promise<void> {
  const verifier = randomString();
  const state = randomString(16);
  const nonce = randomString(16);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.setItem(NONCE_KEY, nonce);

  const url = new URL(`${ISSUER}/protocol/openid-connect/auth`);
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", callbackUrl());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", await challengeFor(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  window.location.assign(url.toString());
}

export interface KontierSignInResult {
  workspaceId: string;
  token: string;
  label: string;
}

/**
 * Finish the flow on the callback page: check `state`, trade the code for
 * tokens, then hand the ID token to our server, which verifies it against the
 * realm's public keys and decides which workspace it opens.
 *
 * The access token is deliberately NOT kept. This app does not call the
 * billing API on the user's behalf; it only needs to know, provably, who
 * they are and which organization they belong to.
 */
export async function completeKontierSignIn(
  params: URLSearchParams,
): Promise<KontierSignInResult> {
  const error = params.get("error");
  if (error) {
    throw new Error(params.get("error_description") ?? `Kontier refused the sign-in (${error}).`);
  }
  const code = params.get("code");
  const returnedState = params.get("state");
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  const expectedState = sessionStorage.getItem(STATE_KEY);
  const nonce = sessionStorage.getItem(NONCE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(NONCE_KEY);

  if (!code || !verifier) {
    throw new Error("This sign-in link is incomplete. Start again from the sign-in screen.");
  }
  if (!expectedState || returnedState !== expectedState) {
    throw new Error("This sign-in did not start in this browser. Start again from the sign-in screen.");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    code,
    redirect_uri: callbackUrl(),
    code_verifier: verifier,
  });
  const response = await fetch(`${ISSUER}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Kontier could not complete the sign-in (${response.status}). ${detail.slice(0, 160)}`);
  }
  const tokens = (await response.json()) as { id_token?: string };
  if (!tokens.id_token) {
    throw new Error("Kontier returned no identity token.");
  }

  const exchange = await fetch("/api/workspace/tenant/keycloak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: tokens.id_token, nonce }),
  });
  const text = await exchange.text();
  if (!exchange.ok) {
    let message = `The workspace service refused the sign-in (${exchange.status}).`;
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } };
      if (parsed.error?.message) message = parsed.error.message;
    } catch {
      /* keep the generic message */
    }
    throw new Error(message);
  }
  return JSON.parse(text) as KontierSignInResult;
}
