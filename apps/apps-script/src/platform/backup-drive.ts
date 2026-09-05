import {
  BUILTIN_RECIPE_TEMPLATES,
  BUILTIN_STICKER_PACKS,
  recipeAggregateSchema,
} from '@tastory/contracts';
import { BackupError, backupKeys } from '../services/book-backup';
import type { BackupFile, BackupPlan, BackupPort } from '../services/book-backup';
import {
  canonicalRecipeJson,
  readRecipeOperations,
  recipeRows,
  dataTables,
} from '../services/recipe-storage';
import { historicalSnapshot } from '../services/recipe-history';
import { readJournal } from '../services/operation-journal';
import { createRecipeStore } from './recipe-store';
import { createRecipeArchive } from './recipe-archive';
import { createRecipeReader } from '../services/recipe-reader';
import { inspectCurrentSchema, sha256 } from './current-schema';
import { readWorkspaceDirectory } from './workspace-directory';
import { readStickerState } from '../services/sticker-storage';
import { readTemplateState } from '../services/template-storage';
import {
  assertPrivateResource,
  privateResourceFolder,
  fileInFolder,
  bytesDigest,
} from './private-resources';

export function readBackupTables(book: GoogleAppsScript.Spreadsheet.Spreadsheet) {
  return book
    .getSheets()
    .filter((sheet) => sheet.getLastRow() > 0)
    .map((sheet) => {
      if (sheet.getLastRow() > 100001 || sheet.getLastColumn() > 100)
        throw new BackupError('BACKUP_LIMIT');
      const range = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn());
      if (range.getFormulas().some((row) => row.some(Boolean)))
        throw new BackupError('BACKUP_INVALID');
      const rows = range
        .getValues()
        .map((row) =>
          row.map((value: unknown) =>
            value instanceof Date ? value.toISOString() : String(value),
          ),
        );
      return { name: sheet.getName(), rows, hash: sha256(canonicalRecipeJson(rows)) };
    });
}
export function validateBook(book: GoogleAppsScript.Spreadsheet.Spreadsheet, folderId: string) {
  if (inspectCurrentSchema(book, folderId).schemaVersion !== 9)
    throw new BackupError('BACKUP_INVALID');
  const directory = readWorkspaceDirectory(book);
  const store = createRecipeStore(book);
  store.archive = createRecipeArchive(store, folderId, sha256);
  const journal = readJournal(store.journal);
  const operations = readRecipeOperations(store);
  if (
    journal.operations.some((op) => op.status === 'started') ||
    operations.some((op) => op.state === 'started')
  )
    throw new BackupError('BACKUP_PENDING');
  const ids = new Set(operations.map((op) => op.requestId));
  if (
    dataTables.some((table) =>
      recipeRows(store, table).some((row) => !ids.has(String(row.versionId))),
    )
  )
    throw new BackupError('BACKUP_INVALID');
  const reader = createRecipeReader(store, sha256);
  const stickerState = readStickerState(store);
  const templateState = readTemplateState(store);
  for (const op of operations) {
    if (!op.state.startsWith('committed@')) continue;
    historicalSnapshot(store, op, sha256);
    if (
      !directory.members.some(
        (member) => member.workspace_id === op.workspaceId && member.user_id === op.userId,
      )
    )
      throw new BackupError('BACKUP_INVALID');
  }
  for (const workspace of directory.workspaces) {
    for (const recipe of reader.listRecipes(workspace.workspace_id)) {
      const id = (recipe as { id: string }).id;
      const aggregate = recipeAggregateSchema.parse(reader.getAggregate(id));
      const authors = [
        aggregate.recipe.ownerUserId,
        ...aggregate.tags.map((tag) => tag.createdBy),
        ...aggregate.recipeTags.map((link) => link.assignedBy),
      ];
      if (
        authors.some(
          (id) =>
            !directory.members.some(
              (member) => member.workspace_id === workspace.workspace_id && member.user_id === id,
            ),
        )
      )
        throw new BackupError('BACKUP_INVALID');
    }
  }
  for (const pack of stickerState.packs.values()) {
    if (
      pack.workspaceId === null ||
      pack.ownerUserId === null ||
      !directory.members.some(
        (member) => member.workspace_id === pack.workspaceId && member.user_id === pack.ownerUserId,
      )
    )
      throw new BackupError('BACKUP_INVALID');
  }
  for (const sticker of stickerState.stickers.values())
    if (!stickerState.packs.has(sticker.packId)) throw new BackupError('BACKUP_INVALID');
  const builtinStickerIds = new Set(
    BUILTIN_STICKER_PACKS.flatMap((pack) => pack.stickers.map((item) => item.id)),
  );
  for (const placement of stickerState.placements.values())
    if (
      (!stickerState.stickers.has(placement.stickerId) &&
        !builtinStickerIds.has(placement.stickerId)) ||
      !reader.getRecipe(placement.recipeId)
    )
      throw new BackupError('BACKUP_INVALID');
  if (templateState.operations.some((operation) => operation.state === 'started'))
    throw new BackupError('BACKUP_PENDING');
  const templateIds = new Set([
    ...BUILTIN_RECIPE_TEMPLATES.map((template) => template.id),
    ...templateState.templates.keys(),
  ]);
  for (const applied of templateState.applied.values())
    if (
      !reader.getRecipe(applied.recipeId) ||
      (applied.templateId !== null && !templateIds.has(applied.templateId))
    )
      throw new BackupError('BACKUP_INVALID');
  for (const design of templateState.designs.values()) {
    const applied = templateState.applied.get(design.recipeId);
    if (
      !reader.getRecipe(design.recipeId) ||
      design.recipeTemplateRevision !== (applied?.revision ?? null) ||
      design.sourceTemplateId !== (applied?.templateId ?? null) ||
      (design.sourceTemplateId !== null && !templateIds.has(design.sourceTemplateId))
    )
      throw new BackupError('BACKUP_INVALID');
  }
}

function folderNamed(parent: GoogleAppsScript.Drive.Folder, name: string, create = true) {
  const folders = parent.getFoldersByName(name);
  if (!create && !folders.hasNext()) throw new BackupError('BACKUP_INVALID');
  const folder = folders.hasNext() ? folders.next() : parent.createFolder(name);
  if (folders.hasNext()) throw new BackupError('BACKUP_INVALID');
  return privateResourceFolder(folder.getId());
}
function fileNamed(parent: GoogleAppsScript.Drive.Folder, name: string) {
  const files = parent.getFilesByName(name);
  if (!files.hasNext()) return null;
  const file = fileInFolder(files.next(), parent.getId());
  if (files.hasNext()) throw new BackupError('BACKUP_INVALID');
  return file;
}
function verifyFile(file: GoogleAppsScript.Drive.File, expected: BackupFile) {
  assertPrivateResource(file);
  if (
    file.getSize() !== expected.bytes ||
    file.getMimeType() !== expected.mime ||
    bytesDigest(file.getBlob().getBytes()) !== expected.hash
  )
    throw new BackupError('BACKUP_INVALID');
}
function readDocument(root: GoogleAppsScript.Drive.Folder, key: string) {
  const file = fileNamed(root, key);
  if (!file) return null;
  if (file.getSize() > 50 * 1024 * 1024) throw new BackupError('BACKUP_LIMIT');
  return file.getBlob().getDataAsString('UTF-8');
}
function writeDocument(root: GoogleAppsScript.Drive.Folder, key: string, text: string) {
  // UTF-8 uses at most three bytes per UTF-16 code unit; stay within the 50 MiB read bound.
  if (text.length > 16 * 1024 * 1024) throw new BackupError('BACKUP_LIMIT');
  if (!fileNamed(root, key)) root.createFile(Utilities.newBlob(text, 'application/json', key));
  if (readDocument(root, key) !== text) throw new BackupError('BACKUP_INVALID');
}
export function backupRoot(
  properties: GoogleAppsScript.Properties.Properties,
  sourceFolderId: string,
  create: boolean,
) {
  let id = properties.getProperty('BACKUP_FOLDER_ID');
  if (!id) {
    if (!create) return null;
    const folder = DriveApp.createFolder('Tastory — резервные копии');
    assertPrivateResource(folder);
    id = folder.getId();
    properties.setProperty('BACKUP_FOLDER_ID', id);
  }
  const root = privateResourceFolder(id);
  let current = root;
  for (let depth = 0; depth < 20; depth++) {
    if (current.getId() === sourceFolderId) throw new BackupError('BACKUP_INVALID');
    const parents = current.getParents();
    if (!parents.hasNext()) return root;
    current = parents.next();
  }
  throw new BackupError('BACKUP_INVALID');
}

export function createBackupPort(options: {
  root: GoogleAppsScript.Drive.Folder;
  book?: GoogleAppsScript.Spreadsheet.Spreadsheet;
  sourceFolderId: string;
  workspaceId: string;
  properties: GoogleAppsScript.Properties.Properties;
  assertAuthorized: () => void;
}): BackupPort {
  const { root, book, sourceFolderId, workspaceId, properties, assertAuthorized } = options;
  const assets = (id: string) => folderNamed(root, `backup-${id}-files`);
  return {
    sha256,
    assertAuthorized,
    read: (key) => readDocument(root, key),
    write: (key, text) => {
      assertAuthorized();
      writeDocument(root, key, text);
    },
    capture(id) {
      if (!book) throw new BackupError('BACKUP_INVALID');
      assertPrivateResource(DriveApp.getFileById(book.getId()));
      validateBook(book, sourceFolderId);
      const folders: BackupPlan['folders'] = [],
        files: BackupPlan['files'] = [];
      const seen = new Set<string>();
      const scan = (folderId: string, depth: number) => {
        if (depth > 20 || seen.has(folderId) || seen.size > 100)
          throw new BackupError('BACKUP_LIMIT');
        seen.add(folderId);
        const folder = privateResourceFolder(folderId);
        const children = folder.getFolders();
        while (children.hasNext()) {
          const child = children.next();
          folders.push({ id: child.getId(), parentId: folderId, name: child.getName() });
          scan(child.getId(), depth + 1);
        }
        const items = folder.getFiles();
        while (items.hasNext()) {
          assertAuthorized();
          const file = fileInFolder(items.next(), folderId);
          if (
            file.getMimeType().startsWith('application/vnd.google-apps.') ||
            file.getSize() > 20 * 1024 * 1024 ||
            files.length >= 2000
          )
            throw new BackupError('BACKUP_LIMIT');
          files.push({
            id: file.getId(),
            parentId: folderId,
            name: file.getName(),
            mime: file.getMimeType(),
            bytes: file.getSize(),
            hash: bytesDigest(file.getBlob().getBytes()),
          });
        }
      };
      scan(sourceFolderId, 0);
      const savedProperties = Object.fromEntries(
        Object.entries(properties.getProperties()).filter(
          ([key]) =>
            [
              'APP_ENV',
              'SHEETS_AUTH_CONFIG',
              'GOOGLE_CLIENT_IDS',
              'PRODUCTION_GOOGLE_CLIENT_IDS',
            ].includes(key) || /^STAGING_PHOTO_[a-f0-9]{64}$/.test(key),
        ),
      );
      return {
        version: 1,
        id,
        workspaceId,
        createdAt: new Date().toISOString(),
        sourceSpreadsheetId: book.getId(),
        sourceFolderId,
        properties: savedProperties,
        tables: readBackupTables(book),
        folders,
        files,
      };
    },
    copyFile(id, expected) {
      const destination = assets(id);
      let file = fileNamed(destination, expected.id);
      if (!file) {
        const source = fileInFolder(DriveApp.getFileById(expected.id), expected.parentId);
        verifyFile(source, expected);
        assertAuthorized();
        file = source.makeCopy(expected.id, destination);
      }
      fileInFolder(file, destination.getId());
      verifyFile(file, expected);
    },
    verifyFile(id, expected) {
      const folders = root.getFoldersByName(`backup-${id}-files`);
      if (!folders.hasNext()) throw new BackupError('BACKUP_INVALID');
      const folder = privateResourceFolder(folders.next().getId());
      if (folders.hasNext()) throw new BackupError('BACKUP_INVALID');
      const file = fileNamed(folder, expected.id);
      if (!file) throw new BackupError('BACKUP_INVALID');
      verifyFile(file, expected);
    },
    restore(plan, requestId) {
      assertAuthorized();
      const published = readDocument(root, backupKeys.restored(requestId)) !== null;
      const destination = folderNamed(root, `restore-${requestId}`, !published);
      const restoredRoot = folderNamed(destination, 'files', !published);
      const folders = new Map([[plan.sourceFolderId, restoredRoot]]);
      for (const entry of plan.folders) {
        assertAuthorized();
        const parent = folders.get(entry.parentId);
        if (!parent) throw new BackupError('BACKUP_INVALID');
        folders.set(entry.id, folderNamed(parent, entry.name, !published));
      }
      const fileIds = new Map<string, string>();
      for (const entry of plan.files) {
        assertAuthorized();
        const parent = folders.get(entry.parentId);
        const source = fileNamed(assets(plan.id), entry.id);
        if (!parent || !source) throw new BackupError('BACKUP_INVALID');
        const existing = fileNamed(parent, entry.name);
        if (!existing && published) throw new BackupError('BACKUP_INVALID');
        const file = existing ?? source.makeCopy(entry.name, parent);
        fileInFolder(file, parent.getId());
        verifyFile(file, entry);
        fileIds.set(entry.id, file.getId());
      }
      let bookFile = fileNamed(destination, 'book');
      if (!bookFile) {
        if (published) throw new BackupError('BACKUP_INVALID');
        assertAuthorized();
        const created = SpreadsheetApp.create('book');
        bookFile = DriveApp.getFileById(created.getId());
        bookFile.moveTo(destination);
      }
      fileInFolder(bookFile, destination.getId());
      const restored = SpreadsheetApp.openById(bookFile.getId());
      const expectedTables = plan.tables.map((table) => ({
        ...table,
        rows: table.rows.map((row) =>
          table.name === 'Meta' && row[0] === 'drive_root_folder_id'
            ? [row[0], restoredRoot.getId(), row[2] ?? '']
            : row,
        ),
      }));
      for (const table of expectedTables) {
        if (published) break;
        assertAuthorized();
        const sheet = restored.getSheetByName(table.name) ?? restored.insertSheet(table.name);
        const width = table.rows[0]?.length ?? 0;
        if (sheet.getLastRow() > table.rows.length || sheet.getLastColumn() > width)
          throw new BackupError('BACKUP_INVALID');
        if (sheet.getMaxRows() < table.rows.length)
          sheet.insertRowsAfter(sheet.getMaxRows(), table.rows.length - sheet.getMaxRows());
        if (sheet.getMaxColumns() < width)
          sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
        for (let offset = 0; offset < table.rows.length; offset += 100) {
          assertAuthorized();
          const batch = table.rows.slice(offset, offset + 100);
          const range = sheet.getRange(offset + 1, 1, batch.length, width);
          const existing = range.getValues().map((row) => row.map(String));
          if (canonicalRecipeJson(existing) !== canonicalRecipeJson(batch))
            range.setNumberFormat('@').setValues(batch);
        }
      }
      if (!published) SpreadsheetApp.flush();
      const actual = readBackupTables(restored);
      if (
        actual.length !== expectedTables.length ||
        expectedTables.some(
          (table) =>
            actual.find((entry) => entry.name === table.name)?.hash !==
            sha256(canonicalRecipeJson(table.rows)),
        )
      )
        throw new BackupError('BACKUP_INVALID');
      validateBook(restored, restoredRoot.getId());
      const configuration: Record<string, string> = {
        ...plan.properties,
        SPREADSHEET_ID: restored.getId(),
        DRIVE_FOLDER_ID: restoredRoot.getId(),
      };
      for (const [key, value] of Object.entries(plan.properties)) {
        if (!key.startsWith('STAGING_PHOTO_')) continue;
        const photo = JSON.parse(value) as Record<string, unknown>;
        photo.folderId = restoredRoot.getId();
        photo.imageId = fileIds.get(String(photo.imageId));
        photo.thumbnailId = fileIds.get(String(photo.thumbnailId));
        configuration[key] = canonicalRecipeJson(photo);
      }
      writeDocument(destination, 'configuration.json', canonicalRecipeJson(configuration));
      const configFile = fileNamed(destination, 'configuration.json');
      if (!configFile) throw new BackupError('BACKUP_INVALID');
      return {
        spreadsheetUrl: restored.getUrl(),
        folderUrl: restoredRoot.getUrl(),
        configurationUrl: configFile.getUrl(),
      };
    },
  };
}
