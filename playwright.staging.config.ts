import { defineConfig, devices } from '@playwright/test';

const rawURL = process.env['STAGING_URL'];
if (!rawURL) throw new Error('Задайте STAGING_URL опубликованного HTTPS staging.');
const url = new URL(rawURL);
if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
  throw new Error('STAGING_URL должен быть HTTPS адресом без credentials, query и hash.');
}
if (!url.pathname.endsWith('/')) url.pathname += '/';

export default defineConfig({
  testDir: './staging-tests',
  outputDir: 'test-results/staging',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: process.env['CI'] ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 30_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report/staging', open: 'never' }],
    ['json', { outputFile: 'test-results/staging/results.json' }],
  ],
  use: {
    baseURL: url.href,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
    { name: 'edge', use: { ...devices['Desktop Edge'], channel: 'msedge' } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
