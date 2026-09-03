/**
 * WHAT: The small HTTP layer every workspace route shares — a JSON response
 * helper with caching switched off, one error envelope, zod body parsing, and
 * the auth-to-store wrapper.
 *
 * WHY: the status-code contract (200/201/400/401/404/503) is the part clients
 * depend on most, so it is implemented once here instead of being re-derived
 * in eight route files. The wrapper is also the single place that turns a
 * token into a workspace-scoped store handle, which is what makes workspace
 * isolation impossible to forget in a route.
 *
 * Responses never include a token, and unexpected errors are logged as
 * method + path + message only (never headers, never a request body).
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY ROUTE'S `dynamic` IS A TERNARY (the static-export note)
 * ---------------------------------------------------------------------------
 * Kontier RI ships twice from one source tree: a static export to GitHub
 * Pages (NEXT_OUTPUT=export, no server at all) and a normal Next.js server.
 * The workspace API only exists in the second one.
 *
 * Next 16 decides this in the AppRouteRouteModule constructor while it
 * collects page data, and it is strict about it:
 *   - `dynamic = "force-dynamic"` with `output: export`  -> build error E278
 *   - a GET handler with no static config                -> build error E301
 *   - a dynamic segment with no `generateStaticParams`   -> build error
 * There is no "leave this route out of the export" switch in a route file.
 *
 * So each route exports
 *   `process.env.NEXT_OUTPUT === "export" ? "error" : "force-dynamic"`
 * plus, where the path has a `[param]`, a `generateStaticParams()` that
 * returns `[]`. In the export build that means: nothing to pre-render, no
 * response body emitted, so the endpoint is absent from `out/` and answers
 * 404 on Pages — which is exactly what "the API is optional" should look
 * like. In a server build the value is `force-dynamic`, so nothing is ever
 * cached and every request re-runs. `dynamic` is read from the module at
 * runtime, which is why the ternary works; the value is resolved once per
 * build, from the same env var next.config.ts reads.
 */

import type { z } from "zod";
import { authenticate } from "@/lib/server/auth";
import type { WorkspacePrincipal } from "@/lib/server/auth";
import { openWorkspace } from "@/lib/server/workspace-store";
import type { WorkspaceStore } from "@/lib/server/workspace-store";
import { idSchema } from "@/lib/server/schemas";

export type ErrorCode =
  | "not_configured"
  | "unauthorized"
  | "invalid_request"
  | "not_found"
  // Guest workspace creation is the one unauthenticated, disk-allocating
  // route, so it needs to be able to refuse for reasons of its own.
  | "rate_limited"
  | "at_capacity"
  | "internal_error";

/** Every non-2xx body carries this envelope (plus, for a missing item, the
 * typed `null` field the contract promises — so a client can read the body
 * on 404 and still get `{ dashboard: null }`). */
export interface ErrorBody {
  error: { code: ErrorCode; message: string; issues?: Array<{ path: string; message: string }> };
}

const NO_STORE = "no-store, no-cache, must-revalidate, max-age=0";

/** JSON response with caching disabled at every layer. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": NO_STORE,
      pragma: "no-cache",
      // The workspace API is a private, token-scoped surface: no shared cache
      // and no CDN should ever hold a copy of a response.
      vary: "Authorization",
    },
  });
}

export function errorResponse(
  status: number,
  code: ErrorCode,
  message: string,
  extra?: Record<string, unknown>,
): Response {
  const body: ErrorBody & Record<string, unknown> = { error: { code, message }, ...extra };
  return jsonResponse(body, status);
}

/** 404 that still answers with the typed `null` field from the contract. */
export function notFoundResponse(
  field: string,
  message: string,
): Response {
  return errorResponse(404, "not_found", message, { [field]: null });
}

// ---------------------------------------------------------------------------
// Body + parameter parsing
// ---------------------------------------------------------------------------

type Parsed<T> = { ok: true; data: T } | { ok: false; response: Response };

function issuesOf(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.slice(0, 20).map((issue) => ({
    path: issue.path.map((part) => String(part)).join(".") || "(body)",
    message: issue.message,
  }));
}

/** Parse + validate a JSON body. Bad JSON and schema failures are both 400. */
export async function readJson<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<Parsed<z.infer<S>>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      ok: false,
      response: errorResponse(400, "invalid_request", "Request body must be valid JSON."),
    };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      response: errorResponse(400, "invalid_request", "Request body failed validation.", {
        error: {
          code: "invalid_request" satisfies ErrorCode,
          message: "Request body failed validation.",
          issues: issuesOf(result.error),
        },
      }),
    };
  }
  return { ok: true, data: result.data as z.infer<S> };
}

/** Validate a path segment as an id (400 when a client sends nonsense). */
export function readId(value: string | undefined, what: string): Parsed<string> {
  const result = idSchema.safeParse(value);
  if (!result.success) {
    return {
      ok: false,
      response: errorResponse(400, "invalid_request", `Invalid ${what} in the request path.`),
    };
  }
  return { ok: true, data: result.data };
}

/** `?since=N`; absent/blank means 0. Anything else is a 400. */
export function readSince(request: Request): Parsed<number> {
  const raw = new URL(request.url).searchParams.get("since");
  if (raw === null || raw.trim().length === 0) return { ok: true, data: 0 };
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return {
      ok: false,
      response: errorResponse(
        400,
        "invalid_request",
        "`since` must be a non-negative integer command cursor.",
      ),
    };
  }
  return { ok: true, data: parsed };
}

// ---------------------------------------------------------------------------
// Auth -> workspace-scoped store
// ---------------------------------------------------------------------------

/**
 * Authenticate, then run `handler` with a store handle bound to the caller's
 * workspace. 503 when the service is not configured, 401 when the token is
 * missing or unknown, 500 (generic message) for anything unexpected.
 */
export async function withWorkspace(
  request: Request,
  handler: (store: WorkspaceStore, principal: WorkspacePrincipal) => Promise<Response>,
): Promise<Response> {
  const auth = authenticate(request);
  if (!auth.ok) {
    return errorResponse(auth.status, auth.reason, auth.message);
  }
  try {
    return await handler(openWorkspace(auth.principal.workspaceId), auth.principal);
  } catch (error) {
    const { method } = request;
    const pathname = safePathname(request.url);
    const message = error instanceof Error ? error.message : "unknown error";
    // Deliberately narrow: no headers, no body, no token, no workspace data.
    console.error(`[workspace-api] ${method} ${pathname} failed: ${message}`);
    return errorResponse(
      500,
      "internal_error",
      "The workspace service failed to complete this request.",
    );
  }
}

function safePathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "(unparsable url)";
  }
}

/** Next 15+/16 hands route params in as a promise. */
export interface RouteContext<K extends string> {
  params: Promise<Record<K, string>>;
}
