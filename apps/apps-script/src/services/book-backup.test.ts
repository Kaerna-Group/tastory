import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { backupFixture, present } from '../test-support/backup-fixture';
import { createBackupPort, readBackupTables } from '../platform/backup-drive';
import {
  createBookBackup,
  verifyBookBackup,
  restoreBookBackup,
  backupKeys,
  validateBackupPlan,
} from './book-backup';
import { mutateRecipe } from './recipe-mutations';
import { archiveRecipeHistory } from './recipe-history';
import { canonicalRecipeJson } from './recipe-storage';
import { sha256 } from '../test-support/journal-fixture';
import { recoverBookBackup } from '../entrypoints/backup-recovery';
import { backups } from '../platform/backups';
import {
  DEFAULT_RECIPE_THEME,
  RECIPE_DESIGN_VERSION,
  RECIPE_LAYOUT_ALGORITHM_VERSION,
  RECIPE_LAYOUT_VERSION,
  recipeDesignSchema,
} from '@tastory/contracts';
import { publishTemplateMutation } from './template-storage';
import { other, timestamp } from '../test-support/journal-fixture';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function scenario() {
  const f = backupFixture();
  const saved = mutateRecipe(
    f.context,
    { action: 'recipes.create', payload: { value: f.value, visibility: 'private' } },
    randomUUID(),
  );
  const designRequestId = randomUUID();
  const design = recipeDesignSchema.parse({
    id: saved.entityId,
    recipeId: saved.entityId,
    revision: 1,
    recipeTemplateRevision: null,
    sourceTemplateId: null,
    sourceTemplateRevision: null,
    value: {
      version: RECIPE_DESIGN_VERSION,
      layout: 'hearth',
      layoutVersion: RECIPE_LAYOUT_VERSION,
      layoutAlgorithmVersion: RECIPE_LAYOUT_ALGORITHM_VERSION,
      theme: DEFAULT_RECIPE_THEME,
      elements: [],
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  publishTemplateMutation(
    f.store,
    {
      requestId: designRequestId,
      workspaceId: f.context.workspaceId,
      userId: other,
      action: 'recipes.design.save',
      entityId: saved.entityId,
      payloadHash: 'd'.repeat(64),
      startedAt: timestamp,
    },
    [{ table: 'RecipeDesigns', value: design }],
    () => new Date(timestamp),
  );
  mutateRecipe(
    f.context,
    { action: 'recipes.archive', payload: { recipeId: saved.entityId, expectedRevision: 1 } },
    randomUUID(),
  );
  archiveRecipeHistory(f.store, sha256, () => {});
  const image = f.addFile('photo.jpg', 'image', 'image/jpeg'),
    thumbnail = f.addFile('thumb.jpg', 'thumbnail', 'image/jpeg');
  const photoKey = `STAGING_PHOTO_${sha256('owner-sub')}`;
  f.properties[photoKey] = canonicalRecipeJson({
    ownerSub: 'owner-sub',
    folderId: f.source.id,
    imageId: image.id,
    thumbnailId: thumbnail.id,
    imageDigest: sha256('image'),
    thumbnailDigest: sha256('thumbnail'),
  });
  f.properties.UNRELATED_SECRET = 'must-not-copy';
  f.properties.PRODUCTION_GOOGLE_CLIENT_IDS = 'production.apps.googleusercontent.com';
  const port = createBackupPort({
    root: f.root,
    book: f.book,
    sourceFolderId: f.source.id,
    workspaceId: f.context.workspaceId,
    properties: f.propertiesStore,
    assertAuthorized: () => {},
  });
  f.fail();
  f.failDrive();
  return { ...f, port, id: randomUUID(), image, photoKey };
}
it('copies every table/file, checks hashes and restores rights, history and photo references to separate resources', () => {
  const f = scenario(),
    restoreId = randomUUID();
  const before = readBackupTables(f.book);
  const saved = createBookBackup(f.port, f.id, f.context.workspaceId);
  expect(saved.tables).toBe(25);
  expect(saved.files).toBe(4);
  expect(verifyBookBackup(f.port, f.id, f.context.workspaceId)).toEqual(saved);
  const restored = restoreBookBackup(f.port, f.id, f.context.workspaceId, restoreId);
  expect(readBackupTables(f.book)).toEqual(before);
  const configuration = present(
    [...f.files.values()].find((file) => file.name === 'configuration.json'),
  );
  const config = JSON.parse(configuration.content) as Record<string, string>;
  expect(config.SPREADSHEET_ID).not.toBe('private-sheet');
  expect(config.DRIVE_FOLDER_ID).not.toBe('private-drive');
  expect(configuration.content).not.toContain('must-not-copy');
  expect(config.PRODUCTION_GOOGLE_CLIENT_IDS).toBe('production.apps.googleusercontent.com');
  const photo = JSON.parse(present(config[f.photoKey])) as { imageId: string; folderId: string };
  expect(photo.imageId).not.toBe(f.image.id);
  expect(photo.folderId).toBe(config.DRIVE_FOLDER_ID);
  const target = present(f.books.get(present(config.SPREADSHEET_ID)));
  expect(readBackupTables(target).find((table) => table.name === 'Users')?.hash).toBe(
    before.find((table) => table.name === 'Users')?.hash,
  );
  const count = f.driveWrites();
  expect(restoreBookBackup(f.port, f.id, f.context.workspaceId, restoreId)).toEqual(restored);
  expect(f.driveWrites()).toBe(count);
  expect(f.properties.SPREADSHEET_ID).toBe('private-sheet');
});
for (const mode of ['backup', 'restore'] as const)
  it(`continues ${mode} before/after every write and never publishes an incomplete result`, () => {
    const setup = () => {
      const f = scenario();
      if (mode === 'restore') createBookBackup(f.port, f.id, f.context.workspaceId);
      f.failDrive();
      const requestId = randomUUID();
      const run = () =>
        mode === 'backup'
          ? createBookBackup(f.port, f.id, f.context.workspaceId)
          : restoreBookBackup(f.port, f.id, f.context.workspaceId, requestId);
      return { ...f, run, requestId };
    };
    const measured = setup();
    measured.run();
    const count = measured.driveWrites();
    expect(count).toBeGreaterThan(5);
    for (const after of [false, true])
      for (let at = 1; at <= count; at++) {
        const f = setup(),
          before = readBackupTables(f.book);
        f.failDrive(at, after);
        expect(() => f.run()).toThrow();
        f.failDrive();
        f.run();
        expect(verifyBookBackup(f.port, f.id, f.context.workspaceId).tables).toBe(25);
        expect(readBackupTables(f.book)).toEqual(before);
        const writes = f.driveWrites();
        f.run();
        expect(f.driveWrites()).toBe(writes);
      }
  }, 20000);
it('restores using only the sealed backup after the source book and files are lost', () => {
  const f = scenario();
  createBookBackup(f.port, f.id, f.context.workspaceId);
  f.books.delete('private-sheet');
  for (const file of [...f.files.values()])
    if (file.parent === f.source || file.id === 'private-sheet') f.files.delete(file.id);
  f.properties.BACKUP_RECOVERY_ID = f.id;
  const restored = recoverBookBackup();
  expect(restored.backup.id).toBe(f.id);
  expect(f.properties.BACKUP_RECOVERY_REQUEST_ID).toBeTruthy();
  expect(recoverBookBackup()).toEqual(restored);
});
it('detects damaged tables/files and refuses unknown properties and foreign workspace before restore', () => {
  for (const damage of ['tables', 'files', 'workspace', 'properties']) {
    const f = scenario();
    createBookBackup(f.port, f.id, f.context.workspaceId);
    if (damage === 'files')
      present([...f.files.values()].find((file) => file.name === f.image.id)).content = 'corrupted';
    if (damage === 'tables' || damage === 'properties') {
      const file = present(
        [...f.files.values()].find((file) => file.name === backupKeys.plan(f.id)),
      );
      const plan = JSON.parse(file.content);
      if (damage === 'tables') plan.tables[0].rows[1][1] = 'corrupted';
      else plan.properties.credential = 'do-not-copy';
      file.content = JSON.stringify(plan);
    }
    const writes = f.driveWrites();
    expect(() =>
      restoreBookBackup(
        f.port,
        f.id,
        damage === 'workspace' ? randomUUID() : f.context.workspaceId,
        randomUUID(),
      ),
    ).toThrow();
    expect(f.driveWrites()).toBe(writes);
  }
});
it('rejects pending operations, formulas, shared files and changed files during an interrupted copy', () => {
  for (const fault of ['pending', 'formula', 'public', 'changed']) {
    const f = scenario();
    if (fault === 'pending') {
      f.fail(3);
      expect(() =>
        mutateRecipe(
          f.context,
          { action: 'recipes.create', payload: { value: f.value, visibility: 'private' } },
          randomUUID(),
        ),
      ).toThrow();
      f.fail();
    }
    if (fault === 'formula') f.formulas.add('Users');
    if (fault === 'public') f.image.privateAccess = false;
    if (fault === 'changed') {
      f.port.write(backupKeys.plan(f.id), canonicalRecipeJson(f.port.capture(f.id)));
      f.image.content = 'changed';
    }
    expect(() => createBookBackup(f.port, f.id, f.context.workspaceId)).toThrow();
    expect(f.port.read(backupKeys.ready(f.id))).toBeNull();
  }
});
it('does not overwrite a changed completed recovery and binds retries to one backup', () => {
  const f = scenario(),
    requestId = randomUUID();
  createBookBackup(f.port, f.id, f.context.workspaceId);
  restoreBookBackup(f.port, f.id, f.context.workspaceId, requestId);
  const rows = present(present([...f.createdTables.values()][0]).get('Recipes'));
  present(rows[1])[4] = '"Changed after restore"';
  const before = canonicalRecipeJson(rows);
  expect(() => restoreBookBackup(f.port, f.id, f.context.workspaceId, requestId)).toThrow(
    'BACKUP_INVALID',
  );
  expect(canonicalRecipeJson(rows)).toBe(before);
  const otherId = randomUUID();
  createBookBackup(f.port, otherId, f.context.workspaceId);
  expect(() => restoreBookBackup(f.port, otherId, f.context.workspaceId, requestId)).toThrow(
    'BACKUP_INVALID',
  );
});
it('requires the current owner and a live session for backup API and never trusts the session role', () => {
  const f = scenario();
  vi.useFakeTimers();
  vi.setSystemTime(f.context.now());
  f.context.session.user.role = 'owner';
  expect(() =>
    backups({ action: 'admin.backups.create', payload: {} }, f.id, f.context.session),
  ).toThrow('ACCESS_DENIED');
  f.context.session.user.id = 'owner-sub';
  const saved = backups({ action: 'admin.backups.create', payload: {} }, f.id, f.context.session);
  expect(saved.kind).toBe('backup');
  expect(
    backups({ action: 'admin.backups.list', payload: {} }, randomUUID(), f.context.session),
  ).toMatchObject({ backups: [{ id: f.id }], incomplete: [] });
  f.context.session.expiresAt = f.context.now().toISOString();
  expect(() =>
    backups(
      { action: 'admin.backups.verify', payload: { backupId: f.id } },
      randomUUID(),
      f.context.session,
    ),
  ).toThrow('UNAUTHENTICATED');
});
it('validates directory topology and duplicate paths before accepting a manifest', () => {
  const f = scenario(),
    plan = f.port.capture(f.id);
  expect(() =>
    validateBackupPlan(
      { ...plan, folders: [{ id: 'child', parentId: 'missing', name: 'child' }] },
      sha256,
    ),
  ).toThrow('BACKUP_INVALID');
  expect(() =>
    validateBackupPlan({ ...plan, files: [...plan.files, plan.files[0]] }, sha256),
  ).toThrow('BACKUP_INVALID');
});
