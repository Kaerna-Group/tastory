import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { BUILTIN_STICKER_PACKS } from '@tastory/contracts';
import { persistenceFixture } from '../test-support/recipe-persistence-fixture';
import { recipes } from './recipes';
import { stickers } from './stickers';
import { timestamp } from '../test-support/journal-fixture';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(timestamp);
  return persistenceFixture();
}

describe('sticker packs platform', () => {
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
      stickers: [expect.objectContaining({ id: instanceId })],
    });
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
