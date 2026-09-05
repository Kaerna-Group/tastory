import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env['PLAYWRIGHT_AUTH_PORT'] ?? '45188');
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Некорректный PLAYWRIGHT_AUTH_PORT.');
const baseURL = 'http://127.0.0.1:' + port;
const signInTests = /sign-in\.spec\.ts/;
const firefoxProject = {
  name: 'desktop-firefox',
  testMatch: signInTests,
  use: { ...devices['Desktop Firefox'] },
};

// Provider/API fixtures in a production build. Real Google sign-in is a separate,
// token-free acceptance report because credentials must never enter traces or fixtures.
export default defineConfig({
  testDir: './auth-e2e',
  globalSetup: './auth-e2e/global-setup.ts',
  // These three screens are staging diagnostics and are intentionally absent from production.
  testIgnore: /(access-check|concurrency|photo)\.spec\.ts/,
  fullyParallel: true,
  workers: 4,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/auth' }]],
  outputDir: 'test-results/auth',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Provider and API responses are intercepted by Playwright in these fixture tests.
    // Keep the PWA worker out of this isolated network layer; it has its own offline smoke test.
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    // Playwright 1.62 Firefox cannot create a page on Windows with Node 24.14.
    // CI runs this compatibility project on Linux; real Firefox is also in the release checklist.
    ...(process.platform === 'win32' && !process.env['CI'] ? [] : [firefoxProject]),
    {
      name: 'desktop-webkit',
      testMatch: signInTests,
      use: { ...devices['Desktop Safari'] },
    },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
    {
      name: 'print-webkit',
      testMatch: /recipes\.spec\.ts/,
      grep: /N6 print/,
      use: { ...devices['Desktop Safari'] },
    },
    ...(process.platform === 'win32' && !process.env['CI']
      ? []
      : [
          {
            name: 'print-firefox',
            testMatch: /recipes\.spec\.ts/,
            grep: /N6 print/,
            use: { ...devices['Desktop Firefox'] },
          },
        ]),
  ],
});
