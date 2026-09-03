import { defineConfig } from "@playwright/test";

// Override with E2E_PORT when another dev server already owns the default
// port / .next lock (shared checkouts, parallel agents).
const PORT = process.env.E2E_PORT ?? "3277";
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  // One worker on purpose. Every test drives a real DuckDB-WASM boot and a
  // 16k-row import against ONE dev server, and the multi-browser tests run
  // two full contexts each. Running files in parallel made those contexts
  // compete for the same compiler and time out on work that was progressing
  // fine — a slow machine reported as a broken feature.
  workers: 1,
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
