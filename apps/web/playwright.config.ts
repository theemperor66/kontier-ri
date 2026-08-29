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
