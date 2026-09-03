import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
import { build } from 'esbuild';

const root = new URL('../', import.meta.url);
const { values } = parseArgs({
  options: { samples: { type: 'string', default: '20' } },
  allowPositionals: false,
});
let apiURL = process.env.STAGING_API_URL;
if (!apiURL) {
  try {
    const env = parseEnv(await readFile(new URL('apps/web/.env.staging.local', root), 'utf8'));
    apiURL = env.VITE_API_URL;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
const source = new URL('scripts/staging-metrics.ts', root);
const output = new URL('.cache/staging/staging-metrics.mjs', root);
await mkdir(new URL('.cache/staging/', root), { recursive: true });
await build({
  entryPoints: [fileURLToPath(source)],
  outfile: fileURLToPath(output),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  logLevel: 'silent',
});
const { runBenchmark, validateBenchmarkURL } = await import(output.href);
validateBenchmarkURL(apiURL ?? '');
const destination = new URL(
  `.local/benchmarks/${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  root,
);
await mkdir(new URL('.local/benchmarks/', root), { recursive: true });
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const sourceInfo = {
  revision: git(['rev-parse', 'HEAD']),
  worktreeDirty: git(['status', '--porcelain']).length > 0,
  bundleSha256: createHash('sha256')
    .update(await readFile(output))
    .digest('hex'),
};
console.log('Staging: health и echo, по одному запросу, без записи данных.');
const report = await runBenchmark(apiURL, Number(values.samples), {
  onSample(sample) {
    console.log(
      `${sample.warmup ? 'Прогрев' : 'Замер'} ${sample.case}: ${sample.elapsedMs} мс, ${sample.error ?? 'OK'}`,
    );
  },
});
await writeFile(destination, JSON.stringify({ ...report, source: sourceInfo }, null, 2) + '\n');
console.table(report.summary);
console.log(`Отчёт: ${fileURLToPath(destination)}`);
if (!report.passed) process.exitCode = 1;
