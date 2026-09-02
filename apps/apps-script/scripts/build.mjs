import { build } from 'esbuild';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/entrypoints/web.ts'],
  bundle: true,
  platform: 'neutral',
  format: 'iife',
  globalName: 'Tastory',
  target: 'es2020',
  outfile: 'dist/Code.js',
  footer: {
    js: 'function doGet(e) { return Tastory.doGet(e); }\nfunction doPost(e) { return Tastory.doPost(e); }',
  },
  legalComments: 'eof',
});
await copyFile('appsscript.json', 'dist/appsscript.json');
const code = await readFile('dist/Code.js', 'utf8');
for (const forbidden of [
  /\brequire\s*\(/,
  /\bprocess\./,
  /\bBuffer\b/,
  /\bnode:/,
  /AIza[\w-]{30,}/,
  /-----BEGIN .*PRIVATE KEY-----/,
]) {
  if (forbidden.test(code))
    throw new Error(`Apps Script bundle contains forbidden content: ${forbidden}`);
}
// Проверяем именно собранные глобальные функции в среде без Node/browser API.
const sandbox = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
  Utilities: { getUuid: () => 'c3dcd2e8-e2f8-428b-9e26-3e715f678fac' },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput: (text) => ({ setMimeType: () => text }),
  },
};
runInNewContext(code, sandbox, { timeout: 5000 });
const health = JSON.parse(sandbox.doGet());
if (!health.ok || health.meta.apiVersion !== 1 || health.data.storage !== 'not-configured') {
  throw new Error('Apps Script bundle health smoke failed.');
}
const invalid = JSON.parse(sandbox.doPost({ postData: { contents: '{invalid' } }));
if (invalid.ok || invalid.error.code !== 'INVALID_REQUEST')
  throw new Error('Apps Script bundle POST smoke failed.');
console.log('Apps Script: dist/Code.js, global entrypoints and isolated runtime smoke passed.');
