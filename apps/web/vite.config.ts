import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const isRemote = mode === 'staging' || mode === 'production';
  if (isRemote && (env['VITE_API_MODE'] !== 'apps-script' || env['VITE_APP_ENV'] !== mode)) {
    throw new Error(
      'Для ' +
        mode +
        ' задайте VITE_API_MODE=apps-script и VITE_APP_ENV=' +
        mode +
        '. См. docs/environment.md.',
    );
  }
  if (
    isRemote &&
    (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(env['VITE_API_URL'] ?? '') ||
      env['VITE_API_URL']?.includes('REPLACE'))
  ) {
    throw new Error('VITE_API_URL должен указывать на опубликованный Apps Script /exec.');
  }
  const base = env['VITE_BASE_PATH'] || '/';
  if (!base.startsWith('/') || !base.endsWith('/') || base.includes('..')) {
    throw new Error('VITE_BASE_PATH должен начинаться и заканчиваться /, например /tastory/.');
  }
  return {
    base,
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: { host: '127.0.0.1' },
    build: {
      manifest: true,
      sourcemap: false,
      chunkSizeWarningLimit: 200,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: 'react-vendor', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
              { name: 'router-vendor', test: /node_modules[\\/]react-router[\\/]/ },
              { name: 'query-vendor', test: /node_modules[\\/]@tanstack[\\/]/ },
            ],
          },
        },
      },
    },
  };
});
