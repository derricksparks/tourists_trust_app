import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests drive the real dashboard against the real API.
 * Needs the API running on :3000 (pnpm dev:api). The global setup re-seeds the API's database.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://localhost:5173',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: { command: 'pnpm exec vite --port 5173 --strictPort', url: 'http://localhost:5173', reuseExistingServer: true },
});
