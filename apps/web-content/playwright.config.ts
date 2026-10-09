import { defineConfig } from '@playwright/test';

/**
 * Browser tests for the public site, the badge and the Mini App. Needs the API on :3000
 * (with the demo seed). The site itself is started here unless one is already running on :3001.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  workers: 1,
  use: {
    baseURL: 'http://localhost:3001',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: [
    { command: 'pnpm exec next start -p 3001', url: 'http://localhost:3001/robots.txt', reuseExistingServer: true, timeout: 120_000 },
    { command: 'node e2e/third-party-server.mjs', url: 'http://localhost:8088', reuseExistingServer: true },
    // The API must run with TELEGRAM_API_BASE=http://localhost:8099 for the Telegram assertions.
    { command: 'node e2e/fake-telegram.mjs', url: 'http://localhost:8099/__messages', reuseExistingServer: true },
  ],
});
