import assert from 'node:assert/strict';
import { createHash, randomUUID, generateKeyPairSync, sign } from 'node:crypto';
import { runInNewContext } from 'node:vm';

export function checkSchemaRuntime(code) {
  const properties = {
    APP_ENV: 'staging',
    SPREADSHEET_ID: 'test-sheet',
    DRIVE_FOLDER_ID: 'test-drive',
    GOOGLE_CLIENT_IDS: 'client.apps.googleusercontent.com',
  };
  const sheets = new Map([['Sheet1', [['preserve-existing-data']]]]);
  let writes = 0;
  let held = false;
  let propertyWrites = 0;
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const cache = new Map([
    [
      'google-jwks-v1',
      JSON.stringify({ keys: [{ ...jwk, kid: 'cutover-key', alg: 'RS256', use: 'sig' }] }),
    ],
  ]);
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
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.test' }) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => properties[key] ?? null,
        setProperty: (key, value) => {
          properties[key] = value;
          propertyWrites += 1;
        },
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (key) => cache.get(key) ?? null,
        put: (key, value) => cache.set(key, value),
      }),
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
      getUuid: randomUUID,
      base64DecodeWebSafe: (text) => [...Buffer.from(text, 'base64url')],
      newBlob: (bytes) => ({ getDataAsString: () => Buffer.from(bytes).toString('utf8') }),
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
  // The server targets ES2020; do not depend on the ES2022 Array.at runtime API.
  runInNewContext(`Array.prototype.at = undefined;\n${code}`, sandbox, { timeout: 5000 });
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
  properties.STAGING_INVITES = JSON.stringify([
    { email: 'owner@example.test', role: 'owner', expiresAt: '2027-01-01T00:00:00Z' },
    { email: 'viewer@example.test', role: 'viewer', expiresAt: '2027-01-01T00:00:00Z' },
  ]);
  properties.STAGING_AUTH_BINDINGS = JSON.stringify([
    { email: 'owner@example.test', sub: 'private-owner', joinedAt: '2026-09-02T10:00:00Z' },
    { email: 'viewer@example.test', sub: 'private-viewer', joinedAt: '2026-09-02T10:00:00Z' },
  ]);
  const propertiesBefore = JSON.stringify(properties);
  const writesBeforePlan = writes;
  const usersPlan = sandbox.planStagingUsers();
  assert.equal(usersPlan.ok, true);
  assert.equal(usersPlan.pendingRows, 7);
  assert.equal(writes, writesBeforePlan);
  const imported = sandbox.setupStagingUsers();
  assert.equal(imported.ok, true);
  assert.equal(imported.result, 'applied');
  assert.equal(imported.roles.owner, 1);
  assert.equal(imported.roles.viewer, 1);
  assert.equal(JSON.stringify(imported).includes('private'), false);
  assert.equal(sheets.get('Meta').find(([key]) => key === 'data_revision')[1], '1');
  const before = JSON.stringify([...sheets]);
  const beforeWrites = writes;
  assert.equal(sandbox.setupStagingSchema().result, 'already-applied');
  assert.equal(sandbox.setupStagingUsers().result, 'already-applied');
  assert.equal(JSON.stringify(properties), propertiesBefore);
  for (const action of [
    'planStagingSchema',
    'setupStagingSchema',
    'planStagingUsers',
    'setupStagingUsers',
  ]) {
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
  function request(subject, email, action = 'auth.me', requestId = randomUUID(), payload) {
    const now = Math.floor(Date.now() / 1000);
    const data = [
      { alg: 'RS256', typ: 'JWT', kid: 'cutover-key' },
      {
        iss: 'https://accounts.google.com',
        aud: properties.GOOGLE_CLIENT_IDS,
        sub: subject,
        email,
        email_verified: true,
        name: 'Повар',
        iat: now - 10,
        exp: now + 3600,
      },
    ]
      .map((value) => Buffer.from(JSON.stringify(value)).toString('base64url'))
      .join('.');
    const credential =
      data + '.' + sign('RSA-SHA256', Buffer.from(data), pair.privateKey).toString('base64url');
    return JSON.parse(
      sandbox.doPost({
        postData: {
          contents: JSON.stringify({
            apiVersion: 1,
            requestId,
            action,
            credential,
            payload:
              payload ?? (action === 'spike.concurrency.read' ? { runId: randomUUID() } : {}),
          }),
        },
      }),
    );
  }
  const legacySession = request('private-owner', 'owner@example.test');
  assert.equal(legacySession.ok, true);
  assert.equal(sandbox.activateStagingSheetsAuth().result, 'enabled');
  assert.equal(sandbox.activateStagingSheetsAuth().result, 'already-enabled');
  assert.equal(propertyWrites, 1);
  const ownerSession = request('private-owner', 'owner@example.test');
  assert.equal(ownerSession.ok, true);
  assert.equal(ownerSession.data.user.id, legacySession.data.user.id);
  assert.equal(ownerSession.data.user.role, 'owner');
  assert.equal(request('private-viewer', 'viewer@example.test').data.user.role, 'viewer');
  const ownerUsers = request('private-owner', 'owner@example.test', 'admin.users.list');
  assert.equal(ownerUsers.ok, true);
  assert.equal(ownerUsers.data.users.length, 2);
  assert.equal(ownerUsers.data.users[0].role, 'owner');
  assert.equal(JSON.stringify(ownerUsers).includes('private-'), false);
  const ownerHealth = request('private-owner', 'owner@example.test', 'admin.health');
  assert.equal(ownerHealth.ok, true);
  assert.equal(ownerHealth.data.tablesChecked, 6);
  assert.equal(ownerHealth.data.activeMembers, 2);
  for (const action of ['admin.users.list', 'admin.health']) {
    assert.equal(
      request('private-viewer', 'viewer@example.test', action).error.code,
      'ACCESS_DENIED',
    );
  }
  assert.equal(
    request('private-viewer', 'viewer@example.test', 'spike.concurrency.read').error.code,
    'ACCESS_DENIED',
  );
  assert.equal(
    request('different-sub', 'owner@example.test', 'auth.signIn').error.code,
    'ACCESS_DENIED',
  );
  const viewer = sheets.get('Users').find((row) => row[1] === 'private-viewer');
  const member = sheets.get('WorkspaceMembers').find((row) => row[1] === viewer[0]);
  member[2] = 'member';
  assert.equal(request('private-viewer', 'viewer@example.test').data.user.role, 'member');
  member[3] = 'disabled';
  assert.equal(request('private-viewer', 'viewer@example.test').error.code, 'ACCESS_DENIED');
  assert.equal(
    request('private-owner', 'owner@example.test', 'admin.health').data.activeMembers,
    1,
  );
  member[2] = 'viewer';
  member[3] = 'active';
  const originalUsers = sheets.get('Users');
  sheets.set('Users', undefined);
  assert.equal(request('private-owner', 'owner@example.test').error.code, 'AUTH_UNAVAILABLE');
  sheets.set('Users', originalUsers);
  const forbidden = JSON.parse(
    sandbox.doPost({
      postData: {
        contents: JSON.stringify({
          apiVersion: 1,
          requestId: randomUUID(),
          action: 'activateStagingSheetsAuth',
          payload: {},
        }),
      },
    }),
  );
  assert.equal(forbidden.error.code, 'INVALID_REQUEST');
  assert.equal(propertyWrites, 1);
  const { SHEETS_AUTH_CONFIG, ...preservedProperties } = properties;
  assert.equal(JSON.stringify(preservedProperties), propertiesBefore);
  assert.equal(JSON.parse(SHEETS_AUTH_CONFIG).backend, 'sheets');
  assert.equal(JSON.stringify([...sheets]), before);
  assert.equal(writes, beforeWrites);
  assert.equal(held, false);
  assert.equal(
    request('private-owner', 'owner@example.test', 'admin.operations.list').data.ready,
    false,
  );
  for (const action of [
    'admin.operations.list',
    'admin.operations.initialize',
    'admin.operations.check',
  ]) {
    assert.equal(
      request('private-viewer', 'viewer@example.test', action).error.code,
      'ACCESS_DENIED',
    );
  }
  const originalUsersForJournal = JSON.stringify(sheets.get('Users'));
  const coreMigration = JSON.stringify(sheets.get('SchemaMigrations')[1]);
  assert.equal(
    request('private-owner', 'owner@example.test', 'admin.operations.initialize').data
      .alreadyApplied,
    false,
  );
  const afterSetup = writes;
  assert.equal(
    request('private-owner', 'owner@example.test', 'admin.operations.initialize').data
      .alreadyApplied,
    true,
  );
  assert.equal(writes, afterSetup);
  assert.equal(request('private-viewer', 'viewer@example.test').data.user.role, 'viewer');
  assert.equal(request('private-owner', 'owner@example.test').data.user.role, 'owner');
  assert.equal(
    request('private-owner', 'owner@example.test', 'admin.health').data.tablesChecked,
    8,
  );
  const journalRequestId = randomUUID();
  assert.equal(
    request('private-owner', 'owner@example.test', 'admin.operations.check', journalRequestId).data
      .outcome,
    'committed',
  );
  const afterCheck = writes;
  assert.equal(
    request('private-owner', 'owner@example.test', 'admin.operations.check', journalRequestId).data
      .outcome,
    'replayed',
  );
  assert.equal(writes, afterCheck);
  const operation = sheets.get('Operations')[1];
  operation[7] = 'started';
  operation[8] = '';
  operation[11] = '';
  assert.equal(
    request('private-owner', 'owner@example.test', 'admin.operations.list').data.entries[0]
      .canRetry,
    true,
  );
  assert.equal(
    request('private-owner', 'owner@example.test', 'admin.operations.check', journalRequestId).data
      .outcome,
    'committed',
  );
  assert.equal(sheets.get('Operations').length, 2);
  assert.equal(sheets.get('AuditLog').length, 2);
  const journal = request('private-owner', 'owner@example.test', 'admin.operations.list');
  assert.equal(journal.data.total, 1);
  assert.equal(journal.data.entries[0].auditRecorded, true);
  assert.equal(JSON.stringify(journal).includes('private-'), false);
  assert.equal(JSON.stringify(sheets.get('Users')), originalUsersForJournal);
  assert.equal(JSON.stringify(sheets.get('SchemaMigrations')[1]), coreMigration);
  assert.equal(sheets.get('Meta').find(([key]) => key === 'data_revision')[1], '1');
  assert.equal(propertyWrites, 1);
  assert.equal(held, false);
  const listAccess = () => request('private-owner', 'owner@example.test', 'admin.access.list').data;
  const change = (action, payload, id = randomUUID()) =>
    request('private-owner', 'owner@example.test', action, id, payload);
  assert.equal(listAccess().revision, 1);
  const inviteIdempotency = randomUUID();
  const invitePayload = {
    email: 'synthetic.new@gmail.com',
    role: 'member',
    days: 7,
    expectedRevision: 1,
  };
  const createdInvite = change('admin.invites.create', invitePayload, inviteIdempotency);
  assert.equal(createdInvite.ok, true, JSON.stringify(createdInvite));
  assert.equal(
    change('admin.invites.create', invitePayload, inviteIdempotency).data.outcome,
    'replayed',
  );
  assert.equal(listAccess().revision, 2);
  assert.equal(
    request('fresh-google-sub', 'synthetic.new@gmail.com', 'auth.me').error.code,
    'ACCESS_DENIED',
  );
  assert.equal(
    request('wrong-google-sub', 'stranger@gmail.com', 'auth.signIn').error.code,
    'ACCESS_DENIED',
  );
  const joined = request('fresh-google-sub', 'synthetic.new@gmail.com', 'auth.signIn');
  assert.equal(joined.ok, true);
  assert.equal(joined.data.user.role, 'member');
  const afterJoinWrites = writes;
  assert.equal(request('fresh-google-sub', 'synthetic.new@gmail.com', 'auth.signIn').ok, true);
  assert.equal(writes, afterJoinWrites);
  assert.equal(listAccess().revision, 3);
  const newUser = listAccess().members.find((user) => user.email === 'synthetic.new@gmail.com');
  assert.ok(newUser);
  assert.equal(
    change('admin.members.update', {
      userId: newUser.id,
      role: 'viewer',
      status: 'active',
      expectedRevision: 2,
    }).error.code,
    'ACCESS_CONFLICT',
  );
  assert.equal(
    change('admin.members.update', {
      userId: newUser.id,
      role: 'viewer',
      status: 'active',
      expectedRevision: 3,
    }).ok,
    true,
  );
  assert.equal(request('fresh-google-sub', 'synthetic.new@gmail.com').data.user.role, 'viewer');
  assert.equal(
    change('admin.members.update', {
      userId: newUser.id,
      role: 'viewer',
      status: 'disabled',
      expectedRevision: 4,
    }).ok,
    true,
  );
  assert.equal(
    request('fresh-google-sub', 'synthetic.new@gmail.com', 'auth.signIn').error.code,
    'ACCESS_DENIED',
  );
  assert.equal(
    change('admin.members.update', {
      userId: newUser.id,
      role: 'viewer',
      status: 'active',
      expectedRevision: 5,
    }).ok,
    true,
  );
  assert.equal(request('fresh-google-sub', 'synthetic.new@gmail.com').ok, true);
  const unusedInvite = change('admin.invites.create', {
    email: 'revoked.synthetic@gmail.com',
    role: 'viewer',
    days: 1,
    expectedRevision: 6,
  });
  assert.equal(
    change('admin.invites.revoke', { inviteId: unusedInvite.data.entityId, expectedRevision: 7 })
      .ok,
    true,
  );
  assert.equal(
    request('revoked-new-sub', 'revoked.synthetic@gmail.com', 'auth.signIn').error.code,
    'ACCESS_DENIED',
  );
  assert.equal(listAccess().revision, 8);
  assert.equal(
    request('private-viewer', 'viewer@example.test', 'admin.access.list').error.code,
    'ACCESS_DENIED',
  );
  assert.equal(JSON.stringify(listAccess()).includes('fresh-google-sub'), false);
  assert.equal(sheets.get('Operations').length, 9);
  assert.equal(sheets.get('AuditLog').length, 9);
  assert.equal(
    request('private-owner', 'owner@example.test', 'admin.health').data.tablesChecked,
    8,
  );
  assert.equal(propertyWrites, 1);
  assert.equal(held, false);
  console.log(
    'Apps Script: schema/import, Sheets JWT auth, journal, invitations, acceptance, role updates, revocation, restore and HTTP isolation passed in compiled runtime.',
  );
}
