import { spawnSync } from 'node:child_process';
import { preview } from 'vite';
import type { FullConfig } from '@playwright/test';

// Playwright loads global setup modules through their default export.
// eslint-disable-next-line no-restricted-syntax
export default async function setup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (typeof baseURL !== 'string') throw new Error('Auth test baseURL is missing.');
  const url = new URL(baseURL);
  const port = Number(url.port);
  const environment = {
    ...process.env,
    VITE_APP_ENV: 'production',
    VITE_API_MODE: 'apps-script',
    VITE_API_URL: 'https://script.google.com/macros/s/AUTH_TEST_FIXTURE/exec',
    VITE_GOOGLE_CLIENT_ID: 'test.apps.googleusercontent.com',
    VITE_BASE_PATH: '/',
  };
  const build = spawnSync('npm run build:production', {
    cwd: process.cwd(),
    env: environment,
    stdio: 'inherit',
    shell: true,
  });
  if (build.error) throw build.error;
  if (build.status !== 0) throw new Error('Production auth fixture build failed.');
  const server = await preview({
    root: 'apps/web',
    mode: 'mock',
    preview: { host: url.hostname, port, strictPort: true },
  });
  return async () => {
    await server.close();
  };
}
