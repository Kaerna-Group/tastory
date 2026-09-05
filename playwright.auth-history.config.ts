import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env['PLAYWRIGHT_AUTH_PORT'] ?? '45188');
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Некорректный PLAYWRIGHT_AUTH_PORT.');

export default defineConfig({
  testDir: './auth-e2e',
  globalSetup: './auth-e2e/global-setup.ts',
  grep: /restores a historical snapshot as a new version and keeps the replaced version/,
  repeatEach: 10,
  retries: 0,
  fullyParallel: true,
  workers: 4,
  forbidOnly: Boolean(process.env['CI']),
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report/auth-history-stability' }],
  ],
  outputDir: 'test-results/auth-history-stability',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
});
