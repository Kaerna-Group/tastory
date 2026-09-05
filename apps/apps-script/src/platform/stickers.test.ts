import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { BUILTIN_STICKER_PACKS } from '@tastory/contracts';
import { persistenceFixture } from '../test-support/recipe-persistence-fixture';
import { recipes } from './recipes';
import { stickers } from './stickers';
import { timestamp } from '../test-support/journal-fixture';
import { publishStickerMutation } from '../services/sticker-storage';
import * as stickerAssets from './sticker-assets';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(timestamp);
  return persistenceFixture();
}

describe('sticker packs platform', () => {
  it('keeps an authorized placement readable after its private source pack is archived', () => {
    const f = setup();
    const saved = recipes(
      { action: 'recipes.create', payload: { value: f.value, visibility: 'workspace' } },
      randomUUID(),
      f.context.session,
    );
    if (saved.kind !== 'saved') throw new Error('fixture');
    const pack = stickers(
      {
        action: 'stickers.packs.create',
        payload: { name: 'Личные рисунки', emoji: '✨', visibility: 'private' },
      },
      randomUUID(),
      f.context.session,
    );
    const source = BUILTIN_STICKER_PACKS[0]?.stickers[0];
    if (pack.kind !== 'stickerPack' || !source || !pack.pack.ownerUserId)
      throw new Error('fixture');
    const item = { ...source, id: randomUUID(), packId: pack.pack.id, assetKey: null };
    f.lock();
    publishStickerMutation(
      f.store,
      {
        requestId: randomUUID(),
        workspaceId: f.context.workspaceId,
        userId: pack.pack.ownerUserId,
        action: 'stickers.items.add',
        entityId: pack.pack.id,
        payloadHash: 'a'.repeat(64),
        startedAt: timestamp,
      },
      [{ table: 'Stickers', value: item }],
      () => new Date(timestamp),
    );
    const placed = stickers(
      {
        action: 'recipes.stickers.add',
        payload: {
          recipeId: saved.entityId,
          expectedRecipeRevision: 1,
          stickerId: item.id,
          page: 1,
          pageId: 'page-1',
          x: 10,
          y: 20,
          width: 18,
          height: 18,
          rotation: -15,
          zIndex: 5,
        },
      },
      randomUUID(),
      f.context.session,
    );
    if (placed.kind !== 'recipeSticker') throw new Error('fixture');
    stickers(
      { action: 'stickers.packs.archive', payload: { packId: pack.pack.id, expectedRevision: 1 } },
      randomUUID(),
      f.context.session,
    );
    const viewer = {
      ...f.context.session,
      user: { ...f.context.session.user, id: 'viewer-sub', role: 'viewer' as const },
    };
    const read = vi.spyOn(stickerAssets, 'readStickerAsset').mockReturnValue('aW1hZ2U=');
    expect(
      stickers(
        {
          action: 'stickers.assets.read',
          payload: { recipeId: saved.entityId, instanceId: placed.sticker.id },
        },
        randomUUID(),
        viewer,
      ),
    ).toMatchObject({ kind: 'stickerAsset', digest: item.digest });
    expect(read).toHaveBeenCalledTimes(1);
    expect(() =>
      stickers(
        { action: 'stickers.assets.read', payload: { stickerId: item.id } },
        randomUUID(),
        viewer,
      ),
    ).toThrow('ACCESS_DENIED');
    expect(() =>
      stickers(
        {
          action: 'stickers.assets.read',
          payload: { recipeId: randomUUID(), instanceId: placed.sticker.id },
        },
        randomUUID(),
        viewer,
      ),
    ).toThrow('ACCESS_DENIED');
    expect(read).toHaveBeenCalledTimes(1);
    stickers(
      {
        action: 'recipes.stickers.delete',
        payload: { recipeId: saved.entityId, instanceId: placed.sticker.id, expectedRevision: 1 },
      },
      randomUUID(),
      f.context.session,
    );
    expect(() =>
      stickers(
        {
          action: 'stickers.assets.read',
          payload: { recipeId: saved.entityId, instanceId: placed.sticker.id },
        },
        randomUUID(),
        viewer,
      ),
    ).toThrow('ACCESS_DENIED');
  });
  it('hides a private custom pack from other members and viewers while owner can inspect it', () => {
    const f = setup();
    const requestId = randomUUID();
    const created = stickers(
      {
        action: 'stickers.packs.create',
        payload: { name: 'Личный набор', emoji: '✨', visibility: 'private' },
      },
      requestId,
      f.context.session,
    );
    expect(created).toMatchObject({
      kind: 'stickerPack',
      outcome: 'committed',
      pack: { id: requestId, visibility: 'private' },
    });
    expect(
      stickers(
        { action: 'stickers.packs.list', payload: { query: '', includeArchived: false } },
        randomUUID(),
        f.context.session,
      ),
    ).toMatchObject({
      kind: 'stickerPacks',
      packs: expect.arrayContaining([
        expect.objectContaining({ pack: expect.objectContaining({ id: requestId }) }),
      ]),
    });
    f.context.session.user.id = 'viewer-sub';
    const viewer = stickers(
      { action: 'stickers.packs.list', payload: { query: '', includeArchived: false } },
      randomUUID(),
      f.context.session,
    );
    expect(
      viewer.kind === 'stickerPacks' && viewer.packs.some((item) => item.pack.id === requestId),
    ).toBe(false);
    f.context.session.user.id = 'owner-sub';
    const owner = stickers(
      { action: 'stickers.packs.list', payload: { query: 'личный', includeArchived: false } },
      randomUUID(),
      f.context.session,
    );
    expect(owner).toMatchObject({
      kind: 'stickerPacks',
      packs: [expect.objectContaining({ canManage: true })],
    });
  });

  it('adds, updates and deletes a builtin sticker placement without changing recipe content', () => {
    const f = setup();
    const saved = recipes(
      { action: 'recipes.create', payload: { value: f.value, visibility: 'workspace' } },
      randomUUID(),
      f.context.session,
    );
    if (saved.kind !== 'saved') throw new Error('fixture');
    const aggregate = recipes(
      { action: 'recipes.get', payload: { recipeId: saved.entityId } },
      randomUUID(),
      f.context.session,
    );
    if (aggregate.kind !== 'recipe') throw new Error('fixture');
    const source = BUILTIN_STICKER_PACKS[0]?.stickers[0];
    if (!source) throw new Error('fixture');
    const instanceId = randomUUID();
    const added = stickers(
      {
        action: 'recipes.stickers.add',
        payload: {
          recipeId: saved.entityId,
          expectedRecipeRevision: aggregate.aggregate.recipe.revision,
          stickerId: source.id,
          page: 1,
          x: 10,
          y: 12,
          width: 20,
          height: 20,
          rotation: 0,
          zIndex: 1,
        },
      },
      instanceId,
      f.context.session,
    );
    expect(added).toMatchObject({
      kind: 'recipeSticker',
      sticker: { id: instanceId, assetKey: 'jam' },
    });
    const moved = stickers(
      {
        action: 'recipes.stickers.update',
        payload: {
          recipeId: saved.entityId,
          instanceId,
          expectedRevision: 1,
          page: 1,
          x: 30,
          y: 25,
          width: 25,
          height: 25,
          rotation: 15,
          zIndex: 2,
        },
      },
      randomUUID(),
      f.context.session,
    );
    expect(moved).toMatchObject({
      kind: 'recipeSticker',
      sticker: { revision: 2, x: 30, rotation: 15 },
    });
    const listed = stickers(
      { action: 'recipes.stickers.list', payload: { recipeId: saved.entityId } },
      randomUUID(),
      f.context.session,
    );
    expect(listed).toMatchObject({
      kind: 'recipeStickers',
      stickers: [
        expect.objectContaining({
          id: instanceId,
          pageId: 'page-1',
          page: 1,
          x: 30,
          y: 25,
          width: 25,
          height: 25,
          rotation: 15,
          zIndex: 2,
        }),
      ],
    });
    const stored = structuredClone(f.required('RecipeStickers'));
    f.lock();
    const malicious = [...(stored[1] ?? [])];
    const rotationColumn = stored[0]?.indexOf('rotation') ?? -1;
    expect(rotationColumn).toBeGreaterThan(-1);
    malicious[rotationColumn] = '-15+SUM(A1:A9)';
    expect(() => f.store.writeRows('RecipeStickers', 2, [malicious])).toThrow('RECIPE_LIMIT');
    expect(
      stickers(
        { action: 'recipes.stickers.list', payload: { recipeId: saved.entityId } },
        randomUUID(),
        f.context.session,
      ),
    ).toEqual(listed);
    expect(f.required('RecipeStickers')).toEqual(stored);
    const viewer = {
      ...f.context.session,
      user: { ...f.context.session.user, id: 'viewer-sub', role: 'viewer' as const },
    };
    expect(
      stickers(
        { action: 'recipes.stickers.list', payload: { recipeId: saved.entityId } },
        randomUUID(),
        viewer,
      ),
    ).toEqual(listed);
    expect(() =>
      stickers(
        {
          action: 'recipes.stickers.delete',
          payload: { recipeId: saved.entityId, instanceId, expectedRevision: 2 },
        },
        randomUUID(),
        viewer,
      ),
    ).toThrow('ACCESS_DENIED');
    stickers(
      {
        action: 'recipes.stickers.delete',
        payload: { recipeId: saved.entityId, instanceId, expectedRevision: 2 },
      },
      randomUUID(),
      f.context.session,
    );
    expect(
      stickers(
        { action: 'recipes.stickers.list', payload: { recipeId: saved.entityId } },
        randomUUID(),
        f.context.session,
      ),
    ).toMatchObject({ stickers: [] });
    const unchanged = recipes(
      { action: 'recipes.get', payload: { recipeId: saved.entityId } },
      randomUUID(),
      f.context.session,
    );
    expect(unchanged.kind === 'recipe' && unchanged.aggregate.recipe.revision).toBe(
      aggregate.aggregate.recipe.revision,
    );
  });
});
