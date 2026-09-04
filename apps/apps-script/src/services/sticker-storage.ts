import { z } from 'zod';
import {
  recipeStickerSchema,
  stickerItemSchema,
  stickerMutationActions,
  stickerPackSchema,
} from '@tastory/contracts';
import type { RecipeSticker, StickerItem, StickerPack } from '@tastory/contracts';
import { encodeRecipeRow, recipeRows } from './recipe-storage';
import type { RecipeStore } from './recipe-storage';

export class StickerStorageError extends Error {
  constructor(
    public readonly code:
      | 'STICKER_NOT_READY'
      | 'STICKER_INVALID'
      | 'STICKER_UNAVAILABLE'
      | 'STICKER_CONFLICT'
      | 'STICKER_LIMIT' = 'STICKER_UNAVAILABLE',
  ) {
    super(code);
  }
}

const terminal = z.string().refine((value) => {
  const [state, date] = value.split('@');
  return state === 'committed' && z.iso.datetime().safeParse(date).success;
});
const operationSchema = z.strictObject({
  requestId: z.uuid(),
  workspaceId: z.uuid(),
  userId: z.uuid(),
  action: z.enum(stickerMutationActions),
  entityId: z.uuid(),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  startedAt: z.iso.datetime(),
  state: z.union([z.literal('started'), terminal]),
});
const versionedPack = stickerPackSchema.extend({ versionId: z.uuid() });
const versionedSticker = stickerItemSchema.extend({ versionId: z.uuid() });
const versionedPlacement = recipeStickerSchema.extend({ versionId: z.uuid() });
export type StickerOperation = z.infer<typeof operationSchema>;

function latest<T extends { id: string; revision: number; versionId: string }>(
  rows: T[],
  committed: Set<string>,
) {
  const result = new Map<string, T>();
  for (const row of rows) {
    if (!committed.has(row.versionId)) continue;
    const previous = result.get(row.id);
    if (previous && row.revision !== previous.revision + 1) throw new StickerStorageError();
    result.set(row.id, row);
  }
  return result;
}

export function readStickerOperations(store: RecipeStore): StickerOperation[] {
  const parsed = z.array(operationSchema).safeParse(recipeRows(store, 'StickerOperations'));
  if (
    !parsed.success ||
    new Set(parsed.data.map((item) => item.requestId)).size !== parsed.data.length
  )
    throw new StickerStorageError();
  return parsed.data;
}

export function readStickerState(store: RecipeStore) {
  const operations = readStickerOperations(store);
  const committed = new Set(
    operations.filter((item) => item.state.startsWith('committed@')).map((item) => item.requestId),
  );
  const packs = z.array(versionedPack).safeParse(recipeRows(store, 'StickerPacks'));
  const stickers = z.array(versionedSticker).safeParse(recipeRows(store, 'Stickers'));
  const placements = z.array(versionedPlacement).safeParse(recipeRows(store, 'RecipeStickers'));
  if (!packs.success || !stickers.success || !placements.success) throw new StickerStorageError();
  return {
    operations,
    packs: latest(packs.data, committed),
    stickers: latest(stickers.data, committed),
    placements: latest(placements.data, committed),
  };
}

type StickerWrite =
  | { table: 'StickerPacks'; value: StickerPack }
  | { table: 'Stickers'; value: StickerItem }
  | { table: 'RecipeStickers'; value: RecipeSticker };

export function publishStickerMutation(
  store: RecipeStore,
  operation: Omit<StickerOperation, 'state'>,
  writes: StickerWrite[],
  now: () => Date,
) {
  const operations = readStickerOperations(store);
  const existing = operations.find((item) => item.requestId === operation.requestId);
  if (existing) {
    if (
      existing.workspaceId !== operation.workspaceId ||
      existing.userId !== operation.userId ||
      existing.action !== operation.action ||
      existing.entityId !== operation.entityId ||
      existing.payloadHash !== operation.payloadHash
    )
      throw new StickerStorageError('STICKER_CONFLICT');
    if (existing.state.startsWith('committed@')) return 'replayed' as const;
  } else {
    store.writeRows('StickerOperations', operations.length + 2, [
      encodeRecipeRow('StickerOperations', { ...operation, state: 'started' }),
    ]);
    store.flush();
  }
  for (const table of ['StickerPacks', 'Stickers', 'RecipeStickers'] as const) {
    const planned = writes.filter((item) => item.table === table);
    if (!planned.length) continue;
    const rows = recipeRows(store, table);
    const present = new Set(
      rows.filter((row) => row.versionId === operation.requestId).map((row) => String(row.id)),
    );
    const missing = planned.filter((item) => !present.has(item.value.id));
    if (present.size + missing.length !== planned.length) throw new StickerStorageError();
    if (missing.length)
      store.writeRows(
        table,
        rows.length + 2,
        missing.map((item) =>
          encodeRecipeRow(table, { versionId: operation.requestId, ...item.value }),
        ),
      );
  }
  store.flush();
  const index = readStickerOperations(store).findIndex(
    (item) => item.requestId === operation.requestId,
  );
  if (index < 0) throw new StickerStorageError();
  store.writeState('StickerOperations', index + 2, `committed@${now().toISOString()}`);
  store.flush();
  return 'committed' as const;
}
