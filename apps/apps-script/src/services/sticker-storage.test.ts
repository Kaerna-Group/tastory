import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { recipeStickerSchema, stickerItemSchema, stickerPackSchema } from '@tastory/contracts';
import { persistenceFixture } from '../test-support/recipe-persistence-fixture';
import { publishStickerMutation, readStickerState } from './sticker-storage';

const timestamp = '2026-09-04T12:00:00.000Z';
const now = () => new Date(timestamp);
const operation = (
  requestId: string,
  action:
    | 'stickers.packs.create'
    | 'stickers.items.add'
    | 'recipes.stickers.add'
    | 'stickers.packs.archive',
  entityId: string,
  workspaceId: string,
  userId: string,
  payloadHash = 'a'.repeat(64),
) => ({ requestId, workspaceId, userId, action, entityId, payloadHash, startedAt: timestamp });

describe('durable sticker storage', () => {
  it('publishes once, replays the same request and rejects a changed retry', () => {
    const f = persistenceFixture();
    const requestId = randomUUID();
    const userId = randomUUID();
    const pack = stickerPackSchema.parse({
      id: requestId,
      workspaceId: f.context.workspaceId,
      ownerUserId: userId,
      kind: 'custom',
      name: 'Семейный пак',
      emoji: '✨',
      visibility: 'private',
      status: 'active',
      position: 0,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const op = operation(
      requestId,
      'stickers.packs.create',
      pack.id,
      f.context.workspaceId,
      userId,
    );
    expect(publishStickerMutation(f.store, op, [{ table: 'StickerPacks', value: pack }], now)).toBe(
      'committed',
    );
    expect(publishStickerMutation(f.store, op, [{ table: 'StickerPacks', value: pack }], now)).toBe(
      'replayed',
    );
    expect(readStickerState(f.store).packs.get(pack.id)).toMatchObject({ name: 'Семейный пак' });
    expect(() =>
      publishStickerMutation(
        f.store,
        { ...op, payloadHash: 'b'.repeat(64) },
        [{ table: 'StickerPacks', value: pack }],
        now,
      ),
    ).toThrow('STICKER_CONFLICT');
  });

  it('keeps a placed sticker intact after its source pack is archived', () => {
    const f = persistenceFixture();
    const packId = randomUUID();
    const stickerId = randomUUID();
    const placementId = randomUUID();
    const userId = randomUUID();
    const pack = stickerPackSchema.parse({
      id: packId,
      workspaceId: f.context.workspaceId,
      ownerUserId: userId,
      kind: 'custom',
      name: 'Травы',
      emoji: '🌿',
      visibility: 'workspace',
      status: 'active',
      position: 0,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    publishStickerMutation(
      f.store,
      operation(packId, 'stickers.packs.create', packId, f.context.workspaceId, userId),
      [{ table: 'StickerPacks', value: pack }],
      now,
    );
    const sticker = stickerItemSchema.parse({
      id: stickerId,
      packId,
      name: 'Базилик',
      normalizedName: 'базилик',
      emoji: '🌱',
      position: 0,
      mimeType: 'image/png',
      width: 384,
      height: 384,
      bytes: 100,
      digest: 'c'.repeat(64),
      assetKey: null,
      status: 'active',
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const pack2 = { ...pack, revision: 2, updatedAt: timestamp };
    const itemRequest = randomUUID();
    publishStickerMutation(
      f.store,
      operation(itemRequest, 'stickers.items.add', packId, f.context.workspaceId, userId),
      [
        { table: 'Stickers', value: sticker },
        { table: 'StickerPacks', value: pack2 },
      ],
      now,
    );
    const placement = recipeStickerSchema.parse({
      id: placementId,
      recipeId: randomUUID(),
      stickerId,
      packId,
      name: sticker.name,
      emoji: sticker.emoji,
      mimeType: sticker.mimeType,
      assetWidth: sticker.width,
      assetHeight: sticker.height,
      assetBytes: sticker.bytes,
      assetDigest: sticker.digest,
      assetKey: null,
      page: 1,
      x: 10,
      y: 10,
      width: 20,
      height: 20,
      rotation: 0,
      zIndex: 0,
      status: 'active',
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    publishStickerMutation(
      f.store,
      operation(placementId, 'recipes.stickers.add', placementId, f.context.workspaceId, userId),
      [{ table: 'RecipeStickers', value: placement }],
      now,
    );
    const archiveId = randomUUID();
    publishStickerMutation(
      f.store,
      operation(archiveId, 'stickers.packs.archive', packId, f.context.workspaceId, userId),
      [{ table: 'StickerPacks', value: { ...pack2, status: 'archived', revision: 3 } }],
      now,
    );
    const state = readStickerState(f.store);
    expect(state.packs.get(packId)?.status).toBe('archived');
    expect(state.placements.get(placementId)).toMatchObject({
      status: 'active',
      stickerId,
      name: 'Базилик',
      assetDigest: 'c'.repeat(64),
    });
  });
});
