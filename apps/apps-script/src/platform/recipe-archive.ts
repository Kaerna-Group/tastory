import { z } from 'zod';
import {
  canonicalRecipeJson,
  recipeOperationSchema,
  RecipeStorageError,
} from '../services/recipe-storage';
import type { RecipeArchiveStore, RecipeSnapshot, RecipeStore } from '../services/recipe-storage';
import { privateResourceFolder, fileInFolder } from './private-resources';

export const ARCHIVE_HEAD = 'recipe_archive_head';
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const pageSchema = z.strictObject({
  version: z.literal(1),
  previous: digest.nullable(),
  payload: digest,
  operations: z.array(recipeOperationSchema).min(1).max(100),
});
type Page = z.infer<typeof pageSchema>;
export function createRecipeArchive(
  store: RecipeStore,
  folderId: string,
  sha256: (value: string) => string,
): RecipeArchiveStore {
  const pages = new Map<string, Page>();
  const payloads = new Map<string, Record<string, RecipeSnapshot>>();
  const head = () =>
    store.journal.core.read('Meta')?.rows.find((row) => row[0] === ARCHIVE_HEAD)?.[1] ?? null;
  const filename = (hash: string) => `tastory-history-${hash}.json`;
  const read = (hash: string) => {
    digest.parse(hash);
    const folder = privateResourceFolder(folderId);
    const files = folder.getFilesByName(filename(hash));
    if (!files.hasNext()) throw new RecipeStorageError();
    const file = fileInFolder(files.next(), folderId);
    if (file.getSize() > 20 * 1024 * 1024) throw new RecipeStorageError();
    const text = file.getBlob().getDataAsString('UTF-8');
    if (sha256(text) !== hash) throw new RecipeStorageError();
    return text;
  };
  const write = (value: unknown) => {
    const text = canonicalRecipeJson(value),
      hash = sha256(text);
    const folder = privateResourceFolder(folderId);
    if (!folder.getFilesByName(filename(hash)).hasNext())
      fileInFolder(
        folder.createFile(Utilities.newBlob(text, 'application/json', filename(hash))),
        folderId,
      );
    if (read(hash) !== text) throw new RecipeStorageError();
    return hash;
  };
  const chain = () => {
    const result: Page[] = [];
    const seen = new Set<string>();
    let hash = head();
    while (hash) {
      if (seen.has(hash) || seen.size >= 1000) throw new RecipeStorageError('RECIPE_LIMIT');
      seen.add(hash);
      let page = pages.get(hash);
      if (!page) {
        page = pageSchema.parse(JSON.parse(read(hash)));
        pages.set(hash, page);
      }
      if (page.operations.some((op) => op.state === 'started')) throw new RecipeStorageError();
      result.push(page);
      hash = page.previous;
    }
    return result;
  };
  return {
    operations: () => {
      const operations = chain()
        .reverse()
        .flatMap((page) => page.operations);
      if (new Set(operations.map((op) => op.requestId)).size !== operations.length)
        throw new RecipeStorageError();
      return operations;
    },
    snapshot(requestId) {
      const page = chain().find((page) => page.operations.some((op) => op.requestId === requestId));
      if (!page) return null;
      let records = payloads.get(page.payload);
      if (!records) {
        records = JSON.parse(read(page.payload)) as Record<string, RecipeSnapshot>;
        const parsedRecords = records;
        if (
          !parsedRecords ||
          Array.isArray(parsedRecords) ||
          typeof parsedRecords !== 'object' ||
          Object.keys(parsedRecords).length !== page.operations.length ||
          page.operations.some((op) => !Object.hasOwn(parsedRecords, op.requestId))
        )
          throw new RecipeStorageError();
        payloads.set(page.payload, records);
      }
      return records[requestId] ?? null;
    },
    publish(entries) {
      if (chain().length >= 1000) throw new RecipeStorageError('RECIPE_LIMIT');
      const previous = head();
      const payload = write(
        Object.fromEntries(entries.map((entry) => [entry.operation.requestId, entry.snapshot])),
      );
      const page = pageSchema.parse({
        version: 1,
        previous,
        payload,
        operations: entries.map((entry) => entry.operation),
      });
      const hash = write(page);
      const meta = store.journal.core.read('Meta');
      if (!meta) throw new RecipeStorageError();
      const index = meta.rows.findIndex((row) => row[0] === ARCHIVE_HEAD);
      // One Meta row publishes the hash-linked chain. No payload is removed before read-back.
      store.journal.core.writeRow('Meta', index < 0 ? meta.rows.length + 2 : index + 2, [
        ARCHIVE_HEAD,
        hash,
        new Date().toISOString(),
      ]);
      store.flush();
      if (head() !== hash) throw new RecipeStorageError();
    },
  };
}
