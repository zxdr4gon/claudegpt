import { defineConfig } from '@playwright/test';

const PORT = 4181;

// End-to-end tests run against the production build (offline and updates
// need the real service worker), in the system's Edge: no browser download
// needed. Set PW_CHANNEL=chrome to use Chrome instead.
export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  // One worker: the server's build switch and "down" mode are shared state.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: process.env.PW_CHANNEL ?? 'msedge',
    timezoneId: 'Europe/London',
    locale: 'en-GB',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node e2e/server.mjs',
    url: `http://localhost:${PORT}/__e2e/ping`,
    env: { E2E_PORT: String(PORT) },
    reuseExistingServer: false,
  },
});
