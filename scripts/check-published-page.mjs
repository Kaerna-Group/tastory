import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

function httpsURL(value, name) {
  assert.ok(value, `${name} is required.`);
  const url = new URL(value);
  assert.equal(url.protocol, 'https:', `${name} must use HTTPS.`);
  assert.equal(url.username, '', `${name} must not contain credentials.`);
  assert.equal(url.password, '', `${name} must not contain credentials.`);
  return url;
}

async function request(url, init = {}) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
    ...init,
  });
  assert.ok(response.ok, `${url.href} returned HTTP ${response.status}.`);
  return response;
}

const siteURL = httpsURL(process.env['STAGING_URL'], 'STAGING_URL');
const pageResponse = await request(siteURL);
const html = await pageResponse.text();
assert.match(html, /<div\s+id=["']root["']><\/div>/i, 'Published page has no app root.');
const entrySource = html.match(/<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["']/i)?.[1];
assert.ok(entrySource, 'Published page has no module entry asset.');
const entryURL = new URL(entrySource, pageResponse.url);
const entryResponse = await request(entryURL);
const entryType = entryResponse.headers.get('content-type') ?? '';
assert.match(entryType, /javascript|ecmascript/i, 'Published entry asset is not JavaScript.');

const apiURL = httpsURL(process.env['STAGING_API_URL'], 'STAGING_API_URL');
assert.match(
  apiURL.href,
  /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/,
  'STAGING_API_URL must point to an Apps Script /exec deployment.',
);
const requestId = randomUUID();
const healthResponse = await request(apiURL, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify({ apiVersion: 1, requestId, action: 'health', payload: {} }),
});
const health = await healthResponse.json();
assert.equal(health?.requestId, requestId, 'Backend health returned another requestId.');
assert.equal(health?.ok, true, 'Backend health did not succeed.');

console.log(
  `Published smoke passed: ${pageResponse.url}, ${entryURL.pathname}, backend ${health.data?.deploymentVersion ?? 'version unavailable'}.`,
);
