import { defineConfig } from '@playwright/test';

/** Partner portal browser tests. Needs the API on :3000; re-seeds its database. */
export default defineConfig({
  testDir: './e2e',
  globalSetup: '../admin/e2e/global-setup.ts',
  workers: 1,
  use: {
    baseURL: 'http://localhost:5174',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: { command: 'pnpm exec vite --port 5174 --strictPort', url: 'http://localhost:5174', reuseExistingServer: true },
});
