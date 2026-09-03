import path from "node:path";
import type { NextConfig } from "next";

/**
 * Deploy-mode toggles (defaults keep `next build` / `next start` / e2e
 * unchanged for local dev and Vercel):
 * - NEXT_OUTPUT=export        -> static export to apps/web/out (GitHub Pages)
 * - NEXT_BASE_PATH=/kontier-ri -> serve under a subpath (project Pages URL)
 * NEXT_PUBLIC_BASE_PATH is inlined for plain-string fetch URLs (see
 * lib/base-path.ts); Next only rewrites router/link URLs on its own.
 */
const basePath = process.env.NEXT_BASE_PATH || "";

const nextConfig: NextConfig = {
  transpilePackages: ["@kontier-ri/datasource", "@kontier-ri/studio"],
  // The dev overlay badge floats over the bottom-left tile band, where the
  // canvas shows real state; screenshots and manual QA read the product
  // instead of the toolbar.
  devIndicators: false,
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  ...(process.env.NEXT_OUTPUT === "export"
    ? { output: "export" as const, images: { unoptimized: true } }
    : {}),
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
