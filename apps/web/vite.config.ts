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
  if (
    mode === 'production' &&
    (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(env['VITE_GOOGLE_CLIENT_ID'] ?? '') ||
      env['VITE_GOOGLE_CLIENT_ID']?.includes('REPLACE'))
  ) {
    throw new Error('Для production требуется корректный VITE_GOOGLE_CLIENT_ID.');
  }
  const base = env['VITE_BASE_PATH'] || '/';
  if (!base.startsWith('/') || !base.endsWith('/') || base.includes('..')) {
    throw new Error('VITE_BASE_PATH должен начинаться и заканчиваться /, например /tastory/.');
  }
  const siteUrl = new URL(env['VITE_SITE_URL'] || 'https://kaerna-group.github.io/tastory/');
  if (
    siteUrl.protocol !== 'https:' ||
    siteUrl.username ||
    siteUrl.password ||
    siteUrl.search ||
    siteUrl.hash
  ) {
    throw new Error('VITE_SITE_URL должен быть публичным HTTPS URL без credentials, query и hash.');
  }
  if (!siteUrl.pathname.endsWith('/')) siteUrl.pathname += '/';
  const socialImageUrl = new URL('brand/social-preview.png', siteUrl).href;
  return {
    base,
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'tastory-social-metadata',
        transformIndexHtml() {
          return [
            { tag: 'link', attrs: { rel: 'canonical', href: siteUrl.href }, injectTo: 'head' },
            { tag: 'meta', attrs: { property: 'og:url', content: siteUrl.href }, injectTo: 'head' },
            {
              tag: 'meta',
              attrs: { property: 'og:image', content: socialImageUrl },
              injectTo: 'head',
            },
            {
              tag: 'meta',
              attrs: { property: 'og:image:type', content: 'image/png' },
              injectTo: 'head',
            },
            {
              tag: 'meta',
              attrs: { property: 'og:image:width', content: '1280' },
              injectTo: 'head',
            },
            {
              tag: 'meta',
              attrs: { property: 'og:image:height', content: '640' },
              injectTo: 'head',
            },
            {
              tag: 'meta',
              attrs: {
                property: 'og:image:alt',
                content:
                  'Tastory. Every recipe has a story. Розовая кулинарная тетрадь с логотипом книги и ложки на кремовом фоне.',
              },
              injectTo: 'head',
            },
            {
              tag: 'meta',
              attrs: { name: 'twitter:image', content: socialImageUrl },
              injectTo: 'head',
            },
          ];
        },
      },
    ],
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
