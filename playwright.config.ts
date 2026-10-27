import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 180_000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command: "npm run build && npm run assets && npm run dev",
    url: "http://127.0.0.1:4173/examples/",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
