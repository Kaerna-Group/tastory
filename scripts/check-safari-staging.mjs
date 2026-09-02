import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const siteURL = new URL(process.env.STAGING_URL ?? '');
assert.equal(siteURL.protocol, 'https:', 'Safari check requires an HTTPS staging URL.');
assert.ok(!siteURL.username && !siteURL.password && !siteURL.search && !siteURL.hash);
if (!siteURL.pathname.endsWith('/')) siteURL.pathname += '/';
const apiURL = process.env.STAGING_API_URL ?? '';
assert.match(apiURL, /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/);
assert.equal(process.platform, 'darwin', 'This check requires real Safari on macOS.');

const report = {
  startedAt: new Date().toISOString(),
  siteURL: siteURL.href,
  status: 'running',
  checks: [],
};
await mkdir('test-results/safari', { recursive: true });
const driver = spawn('/usr/bin/safaridriver', ['--port', '4444'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
let driverOutput = '';
driver.stdout.on('data', (data) => {
  driverOutput += data.toString();
});
driver.stderr.on('data', (data) => {
  driverOutput += data.toString();
});
let driverError;
driver.on('error', (error) => {
  driverError = error;
});
let sessionId;

async function command(method, path, body) {
  const response = await fetch('http://127.0.0.1:4444' + path, {
    method,
    signal: AbortSignal.timeout(40_000),
    ...(body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
  const result = await response.json();
  if (!response.ok || result.value?.error)
    throw new Error(result.value?.message ?? 'SafariDriver command failed.');
  return result.value;
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (driverError) throw driverError;
    try {
      await command('GET', '/status');
      ready = true;
      break;
    } catch {
      await delay(250);
    }
  }
  assert.ok(ready, 'SafariDriver did not start.');
  const session = await command('POST', '/session', {
    capabilities: { alwaysMatch: { browserName: 'safari' } },
  });
  sessionId = session.sessionId;
  assert.ok(sessionId, 'SafariDriver did not return a session.');
  report.browser = session.capabilities;
  await command('POST', `/session/${sessionId}/timeouts`, {
    script: 30_000,
    pageLoad: 30_000,
    implicit: 0,
  });
  const start = Date.now();
  await command('POST', `/session/${sessionId}/url`, { url: siteURL.href + '#/settings' });
  let state;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    state = await command('POST', `/session/${sessionId}/execute/sync`, {
      script:
        'return { status: document.querySelector("[role=status]")?.textContent ?? "", realApi: document.body.textContent.includes("Проверка связи с сервером Tastory.") };',
      args: [],
    });
    if (state.status === 'Соединение проверено' || state.status.includes('Связь недоступна')) break;
    await delay(500);
  }
  assert.equal(state?.status, 'Соединение проверено');
  assert.equal(state.realApi, true);
  report.checks.push({
    name: 'health through the published UI',
    status: 'passed',
    durationMs: Date.now() - start,
  });

  for (const action of ['health', 'echo']) {
    const requestId = randomUUID();
    const message = 'Tastory: борщ, crème brûlée — Safari ✓';
    const result = await command('POST', `/session/${sessionId}/execute/async`, {
      script: `
        const [url, request] = arguments;
        const done = arguments[arguments.length - 1];
        const startedAt = performance.now();
        fetch(url, {
          method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          credentials: 'omit', redirect: 'follow', signal: AbortSignal.timeout(15000),
          body: JSON.stringify(request),
        }).then(async response => done({
          status: response.status, redirected: response.redirected,
          finalOrigin: new URL(response.url).origin, durationMs: Math.round(performance.now() - startedAt),
          body: await response.json(),
        })).catch(error => done({ error: error.message }));
      `,
      args: [
        apiURL,
        { apiVersion: 1, requestId, action, payload: action === 'echo' ? { message } : {} },
      ],
    });
    assert.ok(!result.error, result.error);
    assert.equal(result.status, 200);
    assert.equal(result.redirected, true);
    assert.equal(result.finalOrigin, 'https://script.googleusercontent.com');
    assert.equal(result.body.requestId, requestId);
    assert.equal(
      result.body.ok,
      true,
      `${action} must succeed; enable ENABLE_SPIKE_ECHO in staging.`,
    );
    assert.equal(result.body.meta.apiVersion, 1);
    if (action === 'echo') assert.equal(result.body.data.message, message);
    else assert.equal(result.body.data.status, 'ok');
    report.checks.push({ name: action, status: 'passed', ...result });
  }
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = error.message;
  process.exitCode = 1;
} finally {
  if (sessionId) {
    try {
      await command('DELETE', `/session/${sessionId}`);
    } catch {
      console.warn('Safari session cleanup failed.');
    }
  }
  driver.kill();
  report.completedAt = new Date().toISOString();
  await writeFile('test-results/safari/results.json', JSON.stringify(report, null, 2) + '\n');
  await writeFile('test-results/safari/driver.log', driverOutput);
  console.log(JSON.stringify(report, null, 2));
}
