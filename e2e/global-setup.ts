import { spawnSync } from 'node:child_process';
import { preview } from 'vite';
import type { FullConfig } from '@playwright/test';

// Starting Vite through Playwright's command shell leaves its npm child alive on Windows.
// Own the preview server directly so teardown has one deterministic process to close.
// eslint-disable-next-line no-restricted-syntax
export default async function setup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (typeof baseURL !== 'string') throw new Error('E2E baseURL is missing.');
  const url = new URL(baseURL);
  const environment = {
    ...process.env,
    VITE_API_MODE: 'mock',
    VITE_APP_ENV: 'local',
    VITE_BASE_PATH: '/',
  };
  const build = spawnSync('npm run build:web', {
    cwd: process.cwd(),
    env: environment,
    stdio: 'inherit',
    shell: true,
  });
  if (build.error) throw build.error;
  if (build.status !== 0) throw new Error('Mock E2E build failed.');
  const server = await preview({
    root: 'apps/web',
    mode: 'mock',
    preview: { host: url.hostname, port: Number(url.port), strictPort: true },
  });
  return async () => {
    await server.close();
  };
}
