import { build } from 'esbuild';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { checkAuthRuntime } from './check-auth-runtime.mjs';
import ts from 'typescript';

await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/entrypoints/index.ts'],
  bundle: true,
  platform: 'neutral',
  format: 'iife',
  globalName: 'Tastory',
  target: 'es2020',
  outfile: 'dist/Code.js',
  footer: {
    js: 'function doGet(e) { return Tastory.doGet(e); }\nfunction doPost(e) { return Tastory.doPost(e); }\nfunction setupStaging() { return Tastory.setupStaging(); }\nfunction setupStagingAuth() { return Tastory.setupStagingAuth(); }',
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
const syntax = ts.createSourceFile('Code.js', code, ts.ScriptTarget.ES2020, true, ts.ScriptKind.JS);
function checkSyntax(node) {
  if (ts.isBigIntLiteral(node))
    throw new Error('Apps Script upload parser requires BigInt(...) instead of bigint literals.');
  ts.forEachChild(node, checkSyntax);
}
checkSyntax(syntax);
// Проверяем именно собранные глобальные функции в среде без Node/browser API.
const scriptProperties = {};
let createdResources = 0;
let releasedLocks = 0;
const spreadsheet = { getId: () => 'test-sheet', getUrl: () => 'https://example.test/sheet' };
const folder = { getId: () => 'test-folder', getUrl: () => 'https://example.test/folder' };
const sandbox = {
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (key) => scriptProperties[key] ?? null,
      getProperties: () => ({ ...scriptProperties }),
      setProperty: (key, value) => {
        scriptProperties[key] = value;
      },
    }),
  },
  SpreadsheetApp: {
    create: () => {
      createdResources += 1;
      return spreadsheet;
    },
    openById: () => spreadsheet,
  },
  DriveApp: {
    createFolder: () => {
      createdResources += 1;
      return folder;
    },
    getFolderById: () => folder,
  },
  LockService: {
    getScriptLock: () => ({
      tryLock: () => true,
      releaseLock: () => {
        releasedLocks += 1;
      },
    }),
  },
  console: { info: () => {} },
  Utilities: { getUuid: () => 'c3dcd2e8-e2f8-428b-9e26-3e715f678fac' },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput: (text) => ({ setMimeType: () => text }),
  },
};
runInNewContext(code, sandbox, { timeout: 5000 });
if (typeof sandbox.setupStaging !== 'function')
  throw new Error('Staging setup entrypoint is missing.');
const health = JSON.parse(sandbox.doGet());
if (!health.ok || health.meta.apiVersion !== 1 || health.data.storage !== 'not-configured') {
  throw new Error('Apps Script bundle health smoke failed.');
}
const invalid = JSON.parse(sandbox.doPost({ postData: { contents: '{invalid' } }));
if (invalid.ok || invalid.error.code !== 'INVALID_REQUEST')
  throw new Error('Apps Script bundle POST smoke failed.');
const firstSetup = sandbox.setupStaging();
const repeatedSetup = sandbox.setupStaging();
if (
  !firstSetup.created.spreadsheet ||
  !firstSetup.created.assetFolder ||
  repeatedSetup.created.spreadsheet ||
  repeatedSetup.created.assetFolder ||
  createdResources !== 2 ||
  releasedLocks !== 2 ||
  scriptProperties.SPREADSHEET_ID !== 'test-sheet' ||
  scriptProperties.DRIVE_FOLDER_ID !== 'test-folder'
)
  throw new Error('Apps Script bundle staging setup smoke failed.');
console.log('Apps Script: dist/Code.js, global entrypoints and isolated runtime smoke passed.');
checkAuthRuntime(code);
