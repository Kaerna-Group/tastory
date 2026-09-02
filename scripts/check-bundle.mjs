import { readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
const root = path.resolve('apps/web/dist');
const manifest = JSON.parse(await readFile(path.join(root, '.vite/manifest.json'), 'utf8'));
const entries = Object.entries(manifest).filter(([, value]) => value.isEntry);
if (!entries.length) throw new Error('Bundle manifest has no entry.');
const initial = new Set();
function visit(key) {
  const chunk = manifest[key];
  if (!chunk) throw new Error('Unknown manifest import: ' + key);
  if (initial.has(chunk.file)) return;
  initial.add(chunk.file);
  for (const dependency of chunk.imports ?? []) visit(dependency);
}
for (const [key] of entries) visit(key);
let initialGzip = 0;
for (const file of initial) initialGzip += gzipSync(await readFile(path.join(root, file))).length;
if (initialGzip > 250 * 1024) throw new Error('Initial JS exceeds 250 KiB gzip.');
for (const chunk of Object.values(manifest)) {
  if (!chunk.file.endsWith('.js')) continue;
  const size = (await stat(path.join(root, chunk.file))).size;
  if (size > 200 * 1024) throw new Error(chunk.file + ' exceeds 200 KiB raw.');
}
console.log(
  'Initial route JS: ' +
    (initialGzip / 1024).toFixed(1) +
    ' KiB gzip / 250 KiB. All chunks within 200 KiB raw.',
);
