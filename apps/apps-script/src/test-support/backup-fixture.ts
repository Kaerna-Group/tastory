import { createHash, randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { persistenceFixture } from './recipe-persistence-fixture';
import { createRecipeArchive } from '../platform/recipe-archive';
import { sha256 } from './journal-fixture';
export function present<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Missing fixture value');
  return value;
}

export function backupFixture() {
  const f = persistenceFixture();
  let count = 0,
    failAt = 0,
    after = false;
  const change = <T>(callback: () => T): T => {
    count++;
    if (count === failAt && !after) throw new Error('before mutation');
    const result = callback();
    if (count === failAt && after) throw new Error('after mutation');
    return result;
  };
  const iter = <T>(values: T[]) => {
    let index = 0;
    return { hasNext: () => index < values.length, next: () => present(values[index++]) };
  };
  const blob = (value: string | number[], mime = 'application/json', name = '') => {
    const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value);
    return {
      getBytes: () => [...bytes],
      getDataAsString: () => bytes.toString('utf8'),
      getContentType: () => mime,
      getName: () => name,
    };
  };
  const folders = new Map<string, Folder>(),
    files = new Map<string, File>();
  class Resource {
    privateAccess = true;
    trashed = false;
    constructor(
      public id: string,
      public name: string,
      public parent: Folder | null,
    ) {}
    getId() {
      return this.id;
    }
    getName() {
      return this.name;
    }
    getUrl() {
      return `https://drive.google.com/drive/folders/${this.id}`;
    }
    isTrashed() {
      return this.trashed;
    }
    getSharingAccess() {
      return this.privateAccess ? 'PRIVATE' : 'ANYONE';
    }
    getEditors() {
      return [];
    }
    getViewers() {
      return [];
    }
    getOwner() {
      return { getEmail: () => 'owner@example.test' };
    }
    getParents() {
      return iter(this.parent ? [this.parent] : []);
    }
    setTrashed(value: boolean) {
      change(() => {
        this.trashed = value;
      });
      return this;
    }
  }
  class File extends Resource {
    constructor(
      id: string,
      name: string,
      parent: Folder | null,
      public content: string,
      public mime = 'application/json',
    ) {
      super(id, name, parent);
      files.set(id, this);
    }
    getSize() {
      return Buffer.byteLength(this.content);
    }
    getMimeType() {
      return this.mime;
    }
    getBlob() {
      return blob(this.content, this.mime, this.name);
    }
    makeCopy(name: string, parent: Folder) {
      return change(() => new File(randomUUID(), name, parent, this.content, this.mime));
    }
    moveTo(parent: Folder) {
      change(() => {
        this.parent = parent;
      });
      return this;
    }
  }
  class Folder extends Resource {
    constructor(id: string, name: string, parent: Folder | null = null) {
      super(id, name, parent);
      folders.set(id, this);
    }
    createFile(value: ReturnType<typeof blob>) {
      return change(
        () =>
          new File(
            randomUUID(),
            value.getName(),
            this,
            value.getDataAsString(),
            value.getContentType(),
          ),
      );
    }
    createFolder(name: string) {
      return change(() => new Folder(randomUUID(), name, this));
    }
    getFiles() {
      return iter([...files.values()].filter((file) => file.parent === this && !file.trashed));
    }
    getFilesByName(name: string) {
      return iter(
        [...files.values()].filter(
          (file) => file.parent === this && file.name === name && !file.trashed,
        ),
      );
    }
    getFolders() {
      return iter([...folders.values()].filter((folder) => folder.parent === this));
    }
    getFoldersByName(name: string) {
      return iter(
        [...folders.values()].filter((folder) => folder.parent === this && folder.name === name),
      );
    }
  }
  const source = new Folder('private-drive', 'Source'),
    root = new Folder('backups', 'Backups');
  new File('private-sheet', 'source-book', null, '', 'application/vnd.google-apps.spreadsheet');
  const books = new Map<string, GoogleAppsScript.Spreadsheet.Spreadsheet>([
    ['private-sheet', f.book],
  ]);
  const createdTables = new Map<string, Map<string, string[][]>>();
  const newBook = (name: string) =>
    change(() => {
      const id = randomUUID(),
        tables = new Map<string, string[][]>();
      createdTables.set(id, tables);
      new File(id, name, null, '', 'application/vnd.google-apps.spreadsheet');
      const sheet = (name: string) => {
        const rows = tables.get(name);
        if (!rows) return null;
        let maxRows = 1000,
          maxColumns = 26;
        return {
          getName: () => name,
          getLastRow: () => rows.length,
          getLastColumn: () => Math.max(0, ...rows.map((row) => row.length)),
          getMaxRows: () => maxRows,
          getMaxColumns: () => maxColumns,
          insertRowsAfter: (_: number, count: number) =>
            change(() => {
              maxRows += count;
            }),
          insertColumnsAfter: (_: number, count: number) =>
            change(() => {
              maxColumns += count;
            }),
          deleteRows: (start: number, count: number) => change(() => rows.splice(start - 1, count)),
          getRange(row: number, column: number, height: number, width: number) {
            const range = {
              getValues: () =>
                Array.from({ length: height }, (_, i) =>
                  Array.from(
                    { length: width },
                    (_, j) => rows[row - 1 + i]?.[column - 1 + j] ?? '',
                  ),
                ),
              getFormulas: () => [],
              setNumberFormat: () => range,
              setValues: (values: string[][]) => {
                change(() =>
                  values.forEach((value, i) => {
                    const target = rows[row - 1 + i] ?? [];
                    value.forEach((cell, j) => {
                      target[column - 1 + j] = cell;
                    });
                    rows[row - 1 + i] = target;
                  }),
                );
                return range;
              },
            };
            return range;
          },
        };
      };
      const book = {
        getId: () => id,
        getUrl: () => `https://docs.google.com/spreadsheets/d/${id}/edit`,
        getSheetByName: sheet,
        getSheets: () => [...tables.keys()].map(sheet),
        insertSheet: (name: string) => {
          change(() => tables.set(name, []));
          return sheet(name);
        },
      } as unknown as GoogleAppsScript.Spreadsheet.Spreadsheet;
      books.set(id, book);
      return book;
    });
  vi.stubGlobal('DriveApp', {
    Access: { PRIVATE: 'PRIVATE' },
    getFolderById: (id: string) => {
      const folder = folders.get(id);
      if (!folder) throw new Error('missing folder');
      return folder;
    },
    getFileById: (id: string) => {
      const file = files.get(id);
      if (!file) throw new Error('missing file');
      return file;
    },
    createFolder: (name: string) => change(() => new Folder(randomUUID(), name)),
  });
  vi.stubGlobal('Session', { getEffectiveUser: () => ({ getEmail: () => 'owner@example.test' }) });
  vi.stubGlobal('SpreadsheetApp', {
    openById: (id: string) => {
      const book = books.get(id);
      if (!book) throw new Error('missing book');
      return book;
    },
    create: newBook,
    flush: () => change(() => {}),
  });
  vi.stubGlobal('Utilities', {
    getUuid: randomUUID,
    newBlob: blob,
    DigestAlgorithm: { SHA_256: 'sha' },
    Charset: { UTF_8: 'utf' },
    computeDigest: (_: string, value: string | number[]) => [
      ...createHash('sha256')
        .update(typeof value === 'string' ? value : Buffer.from(value))
        .digest(),
    ],
  });
  f.properties.BACKUP_FOLDER_ID = root.getId();
  const properties = {
    getProperties: () => ({ ...f.properties }),
    getProperty: (key: string) => f.properties[key] ?? null,
    setProperty: (key: string, value: string) =>
      change(() => {
        f.properties[key] = value;
      }),
  } as unknown as GoogleAppsScript.Properties.Properties;
  vi.stubGlobal('PropertiesService', { getScriptProperties: () => properties });
  const archive = () => createRecipeArchive(f.store, source.getId(), sha256);
  f.store.archive = archive();
  return {
    ...f,
    files,
    folders,
    books,
    createdTables,
    propertiesStore: properties,
    root: root as unknown as GoogleAppsScript.Drive.Folder,
    source,
    archive,
    addFile: (name: string, content: string, mime = 'application/json', parent = source) =>
      new File(randomUUID(), name, parent, content, mime),
    failDrive(at = 0, failAfter = false) {
      count = 0;
      failAt = at;
      after = failAfter;
    },
    driveWrites: () => count,
  };
}
