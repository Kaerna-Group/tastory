import { defineConfig, devices } from '@playwright/test';

// Provider/API fixtures only. Real Google sign-in is a separate, token-free manual report.
export default defineConfig({
  testDir: './auth-e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/auth' }]],
  outputDir: 'test-results/auth',
  use: {
    baseURL: 'http://127.0.0.1:4188',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command:
      'npm run build:staging && npm run preview -- --host 127.0.0.1 --port 4188 --strictPort',
    url: 'http://127.0.0.1:4188',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_APP_ENV: 'staging',
      VITE_API_MODE: 'apps-script',
      VITE_API_URL: 'https://script.google.com/macros/s/AUTH_TEST_FIXTURE/exec',
      VITE_GOOGLE_CLIENT_ID: 'test.apps.googleusercontent.com',
      VITE_BASE_PATH: '/',
    },
  },
});
