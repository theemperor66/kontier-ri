/**
 * Base-path awareness for plain-string asset URLs (fetch targets, workers).
 * Next.js rewrites router/link URLs for `basePath` automatically, but raw
 * fetch strings must be prefixed by hand. NEXT_PUBLIC_BASE_PATH is inlined at
 * build time from next.config.ts ("" for root deploys like Vercel,
 * "/kontier-ri" for GitHub Pages).
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Prefix an absolute-path URL ("/demo/x.csv") with the deploy base path. */
export function withBasePath(path: string): string {
  return `${BASE_PATH}${path}`;
}
