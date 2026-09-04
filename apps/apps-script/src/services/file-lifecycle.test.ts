import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { backupFixture } from '../test-support/backup-fixture';
import { sha256, timestamp } from '../test-support/journal-fixture';
import { manageFiles } from './file-lifecycle';
import { mutateRecipe } from './recipe-mutations';
import { recipes } from '../platform/recipes';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function fixture() {
  const f = backupFixture();
  const options = {
    folderId: f.source.getId(),
    store: f.store,
    properties: f.propertiesStore,
    sha256,
    now: f.context.now,
    assertAuthorized: vi.fn(),
  };
  return { ...f, options };
}

it('finds missing references, unknown files and unused Tastory assets without touching them', () => {
  const f = fixture();
  const created = mutateRecipe(
    f.context,
    { action: 'recipes.create', payload: { value: f.value, visibility: 'private' } },
    randomUUID(),
  );
  const photoRequestId = randomUUID();
  mutateRecipe(
    f.context,
    {
      action: 'recipes.photos.add',
      payload: {
        recipeId: created.entityId,
        expectedRevision: 1,
        photo: {
          uploadId: photoRequestId,
          imageBase64: 'aW1hZ2U=',
          thumbnailBase64: 'dGh1bWI=',
          width: 1,
          height: 1,
          imageBytes: 5,
          thumbnailBytes: 5,
        },
        target: { kind: 'cover', position: 0 },
      },
    },
    photoRequestId,
  );
  f.addFile(`tastory-recipe-${randomUUID()}-${randomUUID()}-image.jpg`, 'unused', 'image/jpeg');
  f.addFile('notes.txt', 'unknown', 'text/plain');
  const report = manageFiles(f.options, { action: 'admin.files.audit', payload: {} });
  expect(report.summary).toMatchObject({ missing: 2, orphaned: 1, unknown: 1, trashed: 0 });
  expect(
    report.items.some((item) => item.status === 'missing' && item.recipeId === created.entityId),
  ).toBe(true);
});

it('moves only verified unused assets to the private basket, restores them and empties the basket', () => {
  const f = fixture();
  const orphan = f.addFile(
    `tastory-recipe-${randomUUID()}-${randomUUID()}-thumbnail.jpg`,
    'unused',
    'image/jpeg',
  );
  f.addFile('keep.txt', 'unknown', 'text/plain');
  let report = manageFiles(f.options, { action: 'admin.files.trashUnused', payload: {} });
  expect(report.summary).toMatchObject({ orphaned: 0, unknown: 1, trashed: 1 });
  report = manageFiles(f.options, {
    action: 'admin.files.restore',
    payload: { fileId: orphan.getId() },
  });
  expect(report.summary).toMatchObject({ orphaned: 1, trashed: 0 });
  report = manageFiles(f.options, {
    action: 'admin.files.trash',
    payload: { fileId: orphan.getId() },
  });
  expect(report.summary.trashed).toBe(1);
  expect(
    manageFiles(f.options, {
      action: 'admin.files.trash',
      payload: { fileId: orphan.getId() },
    }).summary.trashed,
  ).toBe(1);
  report = manageFiles(f.options, { action: 'admin.files.cleanup', payload: {} });
  expect(report.summary.trashed).toBe(0);
  expect(orphan.isTrashed()).toBe(true);
  expect(() =>
    manageFiles(f.options, {
      action: 'admin.files.trash',
      payload: { fileId: f.addFile('manual.txt', 'data').getId() },
    }),
  ).toThrow('FILE_CONFLICT');
});

it('exposes file reports only to the current workspace owner', () => {
  vi.useFakeTimers();
  vi.setSystemTime(timestamp);
  const f = fixture();
  expect(() =>
    recipes({ action: 'admin.files.audit', payload: {} }, randomUUID(), f.context.session),
  ).toThrow('ACCESS_DENIED');
  f.context.session.user.id = 'owner-sub';
  expect(
    recipes({ action: 'admin.files.audit', payload: {} }, randomUUID(), f.context.session),
  ).toMatchObject({ kind: 'files', summary: { missing: 0, orphaned: 0 } });
});
