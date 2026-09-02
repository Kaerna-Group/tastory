import { writeFile } from 'node:fs/promises';
const [scriptId] = process.argv.slice(2);
if (!scriptId || !/^[\w-]{20,}$/.test(scriptId) || scriptId.includes('REPLACE'))
  throw new Error('Передайте staging Script ID: npm run apps-script:configure -- SCRIPT_ID');
await writeFile(
  'apps/apps-script/.clasp.json',
  JSON.stringify({ scriptId, rootDir: 'dist' }, null, 2) + '\n',
  { flag: 'wx' },
);
console.log('Staging .clasp.json создан. Существующая конфигурация никогда не перезаписывается.');
