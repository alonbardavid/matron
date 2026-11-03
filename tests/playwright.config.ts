import { defineConfig, devices } from "@playwright/test";

// Backend on 8301 (vite dev + Cloudflare plugin, state in apps/backend/.wrangler-test),
// frontend on 5173 proxying /api to it. global-setup.ts migrates and seeds the test DB.
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm exec vite dev",
      cwd: "../apps/backend",
      url: "http://localhost:8301/api/arch/health",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { WORKER_PERSIST_TO: ".wrangler-test" },
    },
    {
      command: "pnpm --filter @app/frontend dev",
      cwd: "..",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
