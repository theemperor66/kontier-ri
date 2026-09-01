/**
 * Byte-level network accounting for the DuckDB-WASM worker.
 *
 * DuckDB-WASM issues its HTTP range reads as (mostly synchronous)
 * XMLHttpRequests from inside its worker thread, so those fetches never
 * appear on the main thread's resource-timing timeline. Because we assemble
 * the worker bootstrap Blob ourselves (DuckDBDataSource.getDB), we can
 * prepend a defensive XHR wrapper that reports every response's byte count
 * over a BroadcastChannel. Consumers subscribe on the main thread and
 * aggregate fetched bytes per host — this is how a "MB fetched" indicator
 * can stay honest without guessing.
 *
 * Every step of the preamble is wrapped in try/catch: if anything about the
 * environment is off (no BroadcastChannel, frozen prototypes, ...), it must
 * degrade to a silent no-op rather than break the engine.
 */

export const NET_STATS_CHANNEL = "kontier-duckdb-net";

/** One message per completed XHR inside the DuckDB worker. */
export interface NetStatsMessage {
  url: string;
  status: number;
  /** Response body size in bytes (0 when it could not be determined). */
  bytes: number;
}

/**
 * JavaScript source injected into the DuckDB worker bootstrap Blob *before*
 * `importScripts(...)`. Wraps XMLHttpRequest open/send and broadcasts
 * `{url, status, bytes}` after each request completes (works for both the
 * sync XHRs DuckDB-WASM uses for range reads and any async ones).
 */
export function buildNetStatsPreamble(channel: string = NET_STATS_CHANNEL): string {
  const chan = JSON.stringify(channel);
  return `try {
  if (typeof BroadcastChannel === "function" && typeof XMLHttpRequest === "function") {
    var __kontierNetChannel = new BroadcastChannel(${chan});
    var __kontierNetReport = function (xhr) {
      try {
        if (xhr.__kontierNetDone || xhr.readyState !== 4) return;
        xhr.__kontierNetDone = true;
        var bytes = 0;
        var body = xhr.response;
        if (body && typeof body.byteLength === "number") bytes = body.byteLength;
        else if (typeof body === "string") bytes = body.length;
        // Content-Length fallback only for bodied GETs: a HEAD probe (e.g.
        // "Range: bytes=0-" capability checks) advertises the FULL size
        // while transferring zero bytes — counting it would inflate the
        // number by the dataset size per probe.
        if (!bytes && xhr.__kontierNetMethod === "GET") {
          var len = xhr.getResponseHeader("Content-Length");
          if (len) bytes = parseInt(len, 10) || 0;
        }
        __kontierNetChannel.postMessage({
          url: xhr.__kontierNetUrl || "",
          status: xhr.status,
          bytes: bytes,
        });
      } catch (e) { /* never break the engine over accounting */ }
    };
    var __kontierNetOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      try {
        this.__kontierNetUrl = String(url);
        this.__kontierNetMethod = String(method).toUpperCase();
      } catch (e) {}
      return __kontierNetOpen.apply(this, arguments);
    };
    var __kontierNetSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function () {
      var xhr = this;
      try {
        xhr.addEventListener("loadend", function () { __kontierNetReport(xhr); });
      } catch (e) {}
      var out = __kontierNetSend.apply(xhr, arguments);
      __kontierNetReport(xhr); // sync XHR: response is ready when send returns
      return out;
    };
  }
} catch (e) { /* no-op on any environment mismatch */ }
`;
}

/**
 * Subscribe to worker fetch reports on the main thread. Returns an
 * unsubscribe function. No-op (still returns a function) where
 * BroadcastChannel is unavailable.
 */
export function subscribeNetStats(
  onMessage: (msg: NetStatsMessage) => void,
  channel: string = NET_STATS_CHANNEL,
): () => void {
  if (typeof BroadcastChannel !== "function") return () => {};
  const bc = new BroadcastChannel(channel);
  bc.onmessage = (event: MessageEvent) => {
    const data = event.data as Partial<NetStatsMessage> | null;
    if (!data || typeof data.bytes !== "number" || typeof data.url !== "string") return;
    onMessage({ url: data.url, status: Number(data.status ?? 0), bytes: data.bytes });
  };
  return () => bc.close();
}
