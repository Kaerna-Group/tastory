import { expect, it, vi } from 'vitest';
const randomUUID = () => crypto.randomUUID();
import { createApiClient } from './client';
it('binds backup receipts to both the transport request and the selected backup', async () => {
  const requestId = randomUUID(),
    backupId = randomUUID();
  const data = {
    kind: 'backup',
    backup: {
      id: backupId,
      createdAt: '2026-09-03T12:00:00.000Z',
      tables: 14,
      files: 2,
      hash: 'a'.repeat(64),
    },
  };
  const response = { ok: true, requestId, meta: { apiVersion: 1, schemaVersion: 0 }, data };
  const transport = vi.fn().mockResolvedValue(response),
    client = createApiClient(transport);
  const command = { action: 'admin.backups.verify' as const, payload: { backupId } };
  expect(await client.backups(command, 'token', requestId)).toEqual(data);
  transport.mockResolvedValue({ ...response, requestId: randomUUID() });
  await expect(client.backups(command, 'token', requestId)).rejects.toMatchObject({
    code: 'INVALID_RESPONSE',
  });
  transport.mockResolvedValue(response);
  await expect(
    client.backups({ action: 'admin.backups.create', payload: {} }, 'token', requestId),
  ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  transport.mockResolvedValue({
    ok: false,
    requestId,
    error: { code: 'BACKUP_INVALID', message: 'Повреждена копия' },
  });
  await expect(client.backups(command, 'token', requestId)).rejects.toMatchObject({
    code: 'BACKUP_INVALID',
  });
});
it('rejects unexpected external links in a restore response', async () => {
  const id = randomUUID(),
    requestId = randomUUID();
  const client = createApiClient(
    vi.fn().mockResolvedValue({
      ok: true,
      requestId,
      meta: { apiVersion: 1, schemaVersion: 0 },
      data: {
        kind: 'restored',
        backup: {
          id,
          createdAt: '2026-09-03T12:00:00.000Z',
          tables: 14,
          files: 0,
          hash: 'a'.repeat(64),
        },
        spreadsheetUrl: 'https://evil.test/file',
        folderUrl: 'https://drive.google.com/drive/folders/a',
        configurationUrl: 'https://drive.google.com/file/d/b',
      },
    }),
  );
  await expect(
    client.backups(
      { action: 'admin.backups.restore', payload: { backupId: id } },
      'token',
      requestId,
    ),
  ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});
