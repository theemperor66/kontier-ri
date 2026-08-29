import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  use: {
    baseURL: "http://localhost:3277",
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: "pnpm dev --port 3277",
    url: "http://localhost:3277",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
