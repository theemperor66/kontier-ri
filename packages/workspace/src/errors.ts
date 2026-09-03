/**
 * One error type for every workspace failure, so callers can render a toast
 * without sniffing at `instanceof TypeError` or reading fetch internals.
 *
 * The remote store never swallows a failure: a 500, a 401, a network drop and a
 * malformed JSON body all arrive here with a status the UI can branch on.
 */

/** A workspace operation failed. `status` is the HTTP status, or 0 offline. */
export class WorkspaceError extends Error {
  /** HTTP status, or `0` when the request never produced a response. */
  readonly status: number;
  /** Request URL, so a log line identifies the failing endpoint. */
  readonly url: string;
  /** Machine-readable code from the server body (`{ "code": ... }`), when present. */
  readonly code: string | undefined;

  constructor(message: string, options: { status: number; url: string; code?: string; cause?: unknown }) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "WorkspaceError";
    this.status = options.status;
    this.url = options.url;
    this.code = options.code;
  }
}

/** True when the failure is worth retrying (offline, timeout, 5xx, 429). */
export function isRetryableWorkspaceError(error: unknown): boolean {
  if (!(error instanceof WorkspaceError)) return false;
  return error.status === 0 || error.status === 429 || error.status >= 500;
}
