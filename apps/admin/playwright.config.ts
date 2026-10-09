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
  webServer: [
    { command: 'pnpm exec vite --port 5173 --strictPort', url: 'http://localhost:5173', reuseExistingServer: true },
    // The partner portal, for the set-password link test.
    { command: 'pnpm --filter @ttp/portal exec vite --port 5174 --strictPort', url: 'http://localhost:5174', reuseExistingServer: true },
    // Stand-in for Telegram; the API must run with TELEGRAM_API_BASE=http://localhost:8099.
    { command: 'node ../web-content/e2e/fake-telegram.mjs', url: 'http://localhost:8099/__messages', reuseExistingServer: true },
  ],
});
