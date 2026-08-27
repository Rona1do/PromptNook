import { defineConfig } from "playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  timeout: 30_000,
  expect: {
    timeout: 7_000,
  },
  reporter: [["line"]],
  use: {
    baseURL:
      process.env.PROMPTNOOK_E2E_BASE_URL ?? "http://127.0.0.1:1422",
    channel: "msedge",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
