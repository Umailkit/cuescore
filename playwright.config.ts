import { defineConfig, devices } from '@playwright/test';

/**
 * PHASE 1 E2E baseline.
 * Builds the app, serves it with `vite preview`, then runs a smoke test
 * that asserts the shell (CueScore) renders and PWA assets are present.
 */
export default defineConfig({
  testDir: './tests/e2e',
  // `capture.spec.ts` is a manual visual-capture utility, not an assertion
  // suite — it only runs when CAPTURE=1 is set.
  testIgnore: process.env.CAPTURE ? [] : ['**/capture.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
