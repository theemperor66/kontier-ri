/**
 * WHAT: vitest config for the server-side workspace API tests.
 *
 * WHY it lives in test/server: the web app had no unit-test runner before
 * this API (only Playwright e2e), and the API is the only part of the app
 * that can be tested without a browser. Keeping the config next to the tests
 * it configures means nothing at the app root changes for the other surfaces.
 * Run it with `pnpm --filter web test`.
 */

import * as path from "node:path";
import { defineConfig } from "vitest/config";

const appRoot = path.resolve(import.meta.dirname, "../..");

export default defineConfig({
  // `root` is the app, not this folder, so the "@/..." alias used by the
  // route handlers resolves exactly like it does in `next build`.
  root: appRoot,
  resolve: {
    alias: { "@": appRoot },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Route handlers and the store read process.env, and the store keeps an
    // in-process lock table: one process, no parallel file interleaving.
    // Vitest 4 removed test.poolOptions; the equivalents are top-level.
    pool: "threads",
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,
  },
});
