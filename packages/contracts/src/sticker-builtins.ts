import type { StickerItem, StickerPack } from './sticker';

const createdAt = '2026-09-04T00:00:00.000Z';
const item = (
  id: string,
  packId: string,
  name: string,
  emoji: string,
  position: number,
  assetKey: StickerItem['assetKey'],
  bytes: number,
  digest: string,
): StickerItem => ({
  id,
  packId,
  name,
  normalizedName: name.toLocaleLowerCase('ru'),
  emoji,
  position,
  mimeType: 'image/png',
  width: 384,
  height: 384,
  bytes,
  digest,
  assetKey,
  status: 'active',
  revision: 1,
  createdAt,
  updatedAt: createdAt,
});

const cozyId = '11111111-1111-4111-8111-111111111111';
const gardenId = '22222222-2222-4222-8222-222222222222';
export const BUILTIN_STICKER_PACKS: ReadonlyArray<{
  pack: StickerPack;
  stickers: StickerItem[];
}> = [
  {
    pack: {
      id: cozyId,
      workspaceId: null,
      ownerUserId: null,
      kind: 'builtin',
      name: 'Уютная кухня',
      emoji: '☕',
      visibility: 'workspace',
      status: 'active',
      position: 0,
      revision: 1,
      createdAt,
      updatedAt: createdAt,
    },
    stickers: [
      item(
        '11111111-1111-4111-8111-111111111112',
        cozyId,
        'Клубничное варенье',
        '🍓',
        0,
        'jam',
        250325,
        'a15ae3a9070296304f6df245681ccd4314a501ca20ee9e26a425093ca496eb27',
      ),
      item(
        '11111111-1111-4111-8111-111111111113',
        cozyId,
        'Чай с лимоном',
        '🍋',
        1,
        'tea',
        233425,
        '8303a67adb4bb1fa874242cb7cfd8c6fd2edd5fd12b35184865541ccf889dba7',
      ),
    ],
  },
  {
    pack: {
      id: gardenId,
      workspaceId: null,
      ownerUserId: null,
      kind: 'builtin',
      name: 'Сад и выпечка',
      emoji: '🌿',
      visibility: 'workspace',
      status: 'active',
      position: 1,
      revision: 1,
      createdAt,
      updatedAt: createdAt,
    },
    stickers: [
      item(
        '22222222-2222-4222-8222-222222222223',
        gardenId,
        'Золотой круассан',
        '🥐',
        0,
        'croissant',
        215257,
        '2496955b6194e1260dd22f2426b1642fc249e52eb5567c2203420954915bf83e',
      ),
      item(
        '22222222-2222-4222-8222-222222222224',
        gardenId,
        'Садовые травы',
        '🌱',
        1,
        'herbs',
        276026,
        '448da8c8552ced3408438cf65908f3c2b91741a8d703f22748dfe6caa93bac65',
      ),
    ],
  },
];

export const BUILTIN_STICKER_ASSET_PATHS: Record<NonNullable<StickerItem['assetKey']>, string> = {
  jam: 'stickers/builtin/jam.png',
  tea: 'stickers/builtin/tea.png',
  croissant: 'stickers/builtin/croissant.png',
  herbs: 'stickers/builtin/herbs.png',
};
