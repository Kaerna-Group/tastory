import { fileURLToPath, URL } from 'node:url';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const publicCacheFiles = [
  'site.webmanifest',
  'brand/mark.svg',
  'favicon.ico',
  'favicon-32.png',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
] as const;

function serviceWorkerSource(version: string, files: string[]): string {
  return `const VERSION = ${JSON.stringify(version)};
const CACHE_NAME = 'tastory-app-' + VERSION;
const PRECACHE = ${JSON.stringify(files)}.map((path) => new URL(path, self.registration.scope).href);
const FALLBACK = new URL('index.html', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith('tastory-app-') && name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
          return response;
        })
        .catch(() => caches.match(request, { ignoreVary: true }).then((cached) => cached || caches.match(FALLBACK, { ignoreVary: true }))),
    );
    return;
  }
  event.respondWith(
    caches.match(request, { ignoreVary: true }).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
      return response;
    })),
  );
});
`;
}

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
      {
        name: 'tastory-pwa-service-worker',
        apply: 'build',
        generateBundle(_options, bundle) {
          const generated = Object.keys(bundle)
            .filter((file) => !file.startsWith('.vite/'))
            .sort();
          const files = [...new Set(['./', 'index.html', ...publicCacheFiles, ...generated])];
          const digest = createHash('sha256').update(files.join('\n'));
          for (const file of generated) {
            const output = bundle[file];
            if (!output) continue;
            digest.update(output.type === 'chunk' ? output.code : output.source);
          }
          for (const file of publicCacheFiles)
            digest.update(
              readFileSync(fileURLToPath(new URL(`./public/${file}`, import.meta.url))),
            );
          const version = digest.digest('hex').slice(0, 16);
          this.emitFile({
            type: 'asset',
            fileName: 'sw.js',
            source: serviceWorkerSource(version, files),
          });
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
