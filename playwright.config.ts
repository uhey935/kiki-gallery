import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: process.env.KIKI_BROWSER_BASE_URL ?? "http://127.0.0.1:4322",
    trace: "retain-on-failure",
  },
});
