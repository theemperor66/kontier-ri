#!/usr/bin/env node
/**
 * Copy the duckdb-wasm browser bundles (mvp + eh wasm & workers) from
 * node_modules into public/duckdb/ so the app serves them same-origin instead
 * of hitting jsDelivr at runtime. Runs as predev/prebuild; the output is
 * gitignored (no committed binaries).
 */
import { createRequire } from "node:module";
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// @duckdb/duckdb-wasm is a dependency of @kontier-ri/datasource, so resolve
// it from that package (pnpm keeps strict, non-hoisted node_modules).
const requireFromDatasource = createRequire(
  path.join(here, "../../../packages/datasource/package.json"),
);
const dist = path.dirname(
  requireFromDatasource.resolve("@duckdb/duckdb-wasm/dist/duckdb-browser.mjs"),
);

const outDir = path.join(here, "../public/duckdb");
mkdirSync(outDir, { recursive: true });

const FILES = [
  "duckdb-mvp.wasm",
  "duckdb-browser-mvp.worker.js",
  "duckdb-eh.wasm",
  "duckdb-browser-eh.worker.js",
];

for (const file of FILES) {
  copyFileSync(path.join(dist, file), path.join(outDir, file));
}
console.log(`[copy-duckdb] copied ${FILES.length} bundle files to public/duckdb/`);
