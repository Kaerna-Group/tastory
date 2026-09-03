import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';

export function checkSchemaRuntime(code) {
  const properties = {
    APP_ENV: 'staging',
    SPREADSHEET_ID: 'test-sheet',
    DRIVE_FOLDER_ID: 'test-drive',
  };
  const sheets = new Map([['Sheet1', [['preserve-existing-data']]]]);
  let writes = 0;
  let held = false;
  function sheet(name) {
    const rows = sheets.get(name);
    if (!rows) return null;
    return {
      getLastRow: () => rows.length,
      getLastColumn: () => Math.max(0, ...rows.map((row) => row.length)),
      getRange: (row, column, height, width) => {
        assert.equal(column, 1);
        const range = {
          getValues: () =>
            Array.from({ length: height }, (_, i) =>
              Array.from({ length: width }, (_, j) => rows[row - 1 + i]?.[j] ?? ''),
            ),
          getFormulas: () => Array.from({ length: height }, () => Array(width).fill('')),
          setNumberFormat: (format) => {
            assert.equal(format, '@');
            return range;
          },
          setValues: (values) => {
            assert.equal(held, true);
            assert.equal(height, values.length);
            for (const [i, value] of values.entries()) {
              assert.equal(value.length, width);
              rows[row - 1 + i] = [...value];
            }
            writes += 1;
            return range;
          },
        };
        return range;
      },
    };
  }
  const sandbox = {
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (key) => properties[key] ?? null }),
    },
    SpreadsheetApp: {
      openById: (id) => {
        assert.equal(id, 'test-sheet');
        return {
          getSheetByName: sheet,
          insertSheet: (name) => {
            assert.equal(held, true);
            assert.equal(sheets.has(name), false);
            sheets.set(name, []);
            writes += 1;
            return sheet(name);
          },
        };
      },
      flush: () => assert.equal(held, true),
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA-256' },
      Charset: { UTF_8: 'UTF-8' },
      computeDigest: (algorithm, value, charset) => {
        assert.equal(algorithm, 'SHA-256');
        assert.equal(charset, 'UTF-8');
        return Array.from(createHash('sha256').update(value).digest(), (byte) =>
          byte > 127 ? byte - 256 : byte,
        );
      },
      getUuid: () => 'c3dcd2e8-e2f8-428b-9e26-3e715f678fac',
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => {
          assert.equal(held, false);
          held = true;
          return true;
        },
        releaseLock: () => {
          held = false;
        },
      }),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => ({ setMimeType: () => text }),
    },
    console: { info: () => {} },
  };
  runInNewContext(code, sandbox, { timeout: 5000 });
  const planned = sandbox.planStagingSchema();
  assert.equal(planned.ok, true);
  assert.equal(planned.actions.length, 6);
  assert.equal(writes, 0);
  const applied = sandbox.setupStagingSchema();
  assert.equal(applied.ok, true);
  assert.equal(applied.result, 'applied');
  assert.equal(sheets.size, 7); // Six core sheets plus the original sheet.
  assert.equal(sheets.get('SchemaMigrations')[1][2].length, 64);
  assert.equal(sheets.get('Meta').find(([key]) => key === 'schema_version')[1], '1');
  const before = JSON.stringify([...sheets]);
  const beforeWrites = writes;
  assert.equal(sandbox.setupStagingSchema().result, 'already-applied');
  for (const action of ['planStagingSchema', 'setupStagingSchema']) {
    const response = JSON.parse(
      sandbox.doPost({
        postData: {
          contents: JSON.stringify({
            apiVersion: 1,
            requestId: 'c3dcd2e8-e2f8-428b-9e26-3e715f678fac',
            action,
            payload: {},
          }),
        },
      }),
    );
    assert.equal(response.error.code, 'INVALID_REQUEST');
  }
  assert.equal(JSON.stringify([...sheets]), before);
  assert.equal(writes, beforeWrites);
  assert.equal(held, false);
  console.log(
    'Apps Script: schema plan/apply/repeat and HTTP isolation passed in compiled runtime.',
  );
}
