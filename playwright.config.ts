import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env['PLAYWRIGHT_PORT'] ?? '4187');
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('PLAYWRIGHT_PORT должен быть целым числом от 1024 до 65535.');
}
const baseURL = 'http://127.0.0.1:' + port;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
});
