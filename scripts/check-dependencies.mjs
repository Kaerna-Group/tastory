import { readFile } from 'node:fs/promises';

const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
const deprecated = Object.entries(lock.packages).filter(([, pkg]) => pkg.deprecated);
if (deprecated.length) {
  throw new Error(
    'Deprecated dependencies in package-lock.json:\n' +
      deprecated.map(([name, pkg]) => `${name}@${pkg.version}: ${pkg.deprecated}`).join('\n'),
  );
}
console.log('Dependencies: no deprecated packages in the lockfile.');
