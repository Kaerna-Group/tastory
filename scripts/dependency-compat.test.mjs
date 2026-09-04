import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileFrom } from 'node-fetch';
import { script_v1 } from 'googleapis/build/src/apis/script/v1.js';

const require = createRequire(import.meta.url);

describe('clasp dependency compatibility on Node 24', () => {
  it('uses native DOMException for file reads and changed-file errors in node-fetch', async () => {
    expect(require('node-domexception')).toBe(globalThis.DOMException);
    const directory = await mkdtemp(join(tmpdir(), 'tastory-dependencies-'));
    try {
      const path = join(directory, 'script.json');
      await writeFile(path, '{}');
      const file = await fileFrom(path, 'application/json');
      expect(await file.text()).toBe('{}');

      await writeFile(path, '{"changed":true}');
      await expect(file.text()).rejects.toBeInstanceOf(globalThis.DOMException);
      await expect(file.text()).rejects.toMatchObject({ name: 'NotReadableError' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('preserves Apps Script JSON requests through the updated Google HTTP client', async () => {
    const content = { files: [{ name: 'Code', type: 'SERVER_JS', source: 'function run() {}' }] };
    const requests = [];
    const api = new script_v1.Script({});
    const response = await api.projects.updateContent(
      { scriptId: 'dependency-smoke', requestBody: content },
      {
        fetchImplementation: async (url, options) => {
          requests.push({ url: String(url), method: options.method, body: options.body });
          return new Response(JSON.stringify({ scriptId: 'dependency-smoke', ...content }), {
            headers: { 'content-type': 'application/json' },
          });
        },
      },
    );
    expect(requests).toEqual([
      {
        url: 'https://script.googleapis.com/v1/projects/dependency-smoke/content',
        method: 'PUT',
        body: JSON.stringify(content),
      },
    ]);
    expect(response.data).toEqual({ scriptId: 'dependency-smoke', ...content });
  });
});
