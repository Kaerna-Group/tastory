import { describe, expect, it } from 'vitest';
import {
  BUILTIN_STICKER_PACKS,
  normalizeStickerName,
  recipeStickerSchema,
  stickerCommandSchema,
  stickerItemSchema,
} from './index';

describe('sticker contracts', () => {
  it('accepts the lossless legacy page adapter and rejects contradictory or foreign page IDs', () => {
    const payload = {
      recipeId: '10000000-0000-4000-8000-000000000001',
      stickerId: '10000000-0000-4000-8000-000000000002',
      expectedRecipeRevision: 1,
      page: 1,
      x: 8,
      y: 12,
      width: 18,
      height: 20,
      rotation: 15,
      zIndex: 3,
    };
    const parse = (extra: object) =>
      stickerCommandSchema.safeParse({
        action: 'recipes.stickers.add',
        payload: { ...payload, ...extra },
      });
    expect(parse({}).success).toBe(true);
    expect(parse({ pageId: 'page-1' }).success).toBe(true);
    expect(parse({ pageId: 'page-2' }).success).toBe(false);
    expect(parse({ pageId: 'other-recipe/page-1' }).success).toBe(false);
    expect(parse({ x: Infinity }).success).toBe(false);
  });
  it('ships valid, ordered builtin PNG packs', () => {
    expect(BUILTIN_STICKER_PACKS).toHaveLength(2);
    for (const view of BUILTIN_STICKER_PACKS) {
      expect(view.pack.kind).toBe('builtin');
      expect(view.stickers.map((item) => item.position)).toEqual(
        view.stickers.map((_, index) => index),
      );
      for (const sticker of view.stickers)
        expect(stickerItemSchema.parse(sticker)).toEqual(sticker);
    }
  });

  it('normalizes Russian search without changing stored display names', () => {
    expect(normalizeStickerName('  Чай   С ЛИМОНОМ ')).toBe('чай с лимоном');
  });

  it('rejects unsafe geometry, duplicate reorder IDs and unsupported uploads', () => {
    const duplicate = '10000000-0000-4000-8000-000000000001';
    expect(
      stickerCommandSchema.safeParse({
        action: 'stickers.items.reorder',
        payload: {
          packId: '10000000-0000-4000-8000-000000000002',
          expectedRevision: 1,
          stickerIds: [duplicate, duplicate],
        },
      }).success,
    ).toBe(false);
    const placement = BUILTIN_STICKER_PACKS[0]?.stickers[0];
    expect(
      recipeStickerSchema.safeParse({
        id: '10000000-0000-4000-8000-000000000003',
        recipeId: '10000000-0000-4000-8000-000000000004',
        stickerId: placement?.id,
        packId: placement?.packId,
        name: placement?.name,
        emoji: placement?.emoji,
        mimeType: placement?.mimeType,
        assetWidth: 384,
        assetHeight: 384,
        assetBytes: placement?.bytes,
        assetDigest: placement?.digest,
        assetKey: placement?.assetKey,
        page: 1,
        x: -1,
        y: 0,
        width: 20,
        height: 20,
        rotation: 0,
        zIndex: 0,
        status: 'active',
        revision: 1,
        createdAt: '2026-09-04T00:00:00.000Z',
        updatedAt: '2026-09-04T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});
