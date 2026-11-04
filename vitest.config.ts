import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.ts: the tests are pure logic and don't need
// any Vite plugins.
export default defineConfig({
  test: {
    // Run under an unusual host timezone so tests catch any accidental
    // dependence on the machine's local time.
    env: { TZ: 'Pacific/Chatham' },
    // Browser tests live in e2e/ and run under Playwright (`npm run e2e`).
    exclude: ['**/node_modules/**', 'e2e/**'],
  },
});
