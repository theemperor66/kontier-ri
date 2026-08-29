"use client";

/**
 * Share-URL: the whole doc, lz-string-compressed, in the URL fragment
 * (`#doc=<payload>`). Fragment never hits any server — sharing stays
 * local-first. Opening such a link imports the doc as a dashboard
 * (missing-dataset tiles explain themselves via the datasource seam).
 */

import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from "lz-string";
import type { DashboardDoc } from "@/lib/dashboard-store";
import { normalizeDoc } from "@/lib/dashboards";

const HASH_RE = /(?:^#|[#&])doc=([^&]+)/;

export function buildShareURL(doc: DashboardDoc): string {
  const payload = compressToEncodedURIComponent(JSON.stringify(doc));
  const url = new URL(window.location.href);
  url.hash = `doc=${payload}`;
  return url.toString();
}

/** Parse a shared doc out of the current URL fragment (null when absent). */
export function readShareURL(): DashboardDoc | null {
  if (typeof window === "undefined") return null;
  const m = HASH_RE.exec(window.location.hash);
  const payload = m?.[1];
  if (!payload) return null;
  try {
    const json = decompressFromEncodedURIComponent(payload);
    if (!json) return null;
    return normalizeDoc(JSON.parse(json));
  } catch {
    return null;
  }
}

/** Remove the share payload from the address bar after importing. */
export function clearShareHash(): void {
  if (!HASH_RE.test(window.location.hash)) return;
  history.replaceState(null, "", window.location.pathname + window.location.search);
}
