import { defineConfig } from '@playwright/test'

/**
 * E2E tests drive the REAL built extension (dist/) in a real Chromium
 * instance, including on-device model inference against live pages
 * (Wikipedia, Google Images) -- see tests/e2e/README.md for prerequisites.
 * Not part of `npm test` (that's the fast unit suite); run explicitly via
 * `npm run test:e2e`.
 */
export default defineConfig({
  testDir: './tests/e2e',
  // Each test gets a fresh extension context (see fixtures.ts), so every
  // test pays a cold ~45MB model load -- generous headroom for that, plus
  // real inference and real network fetches to the reference pages.
  timeout: 150_000,
  fullyParallel: false, // one shared machine's worth of model inference; run sequentially
  workers: 1,
  retries: 0,
  reporter: 'list',
})
