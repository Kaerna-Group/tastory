import { describe, expect, it } from 'vitest';
import { canManageStickerPack, canReadStickerPack } from './sticker-access';

const pack = {
  workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  ownerUserId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  kind: 'custom' as const,
  visibility: 'private' as const,
};
const actor = (
  role: 'owner' | 'member' | 'viewer',
  userId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
) => ({
  userId,
  workspaceId: pack.workspaceId,
  role,
});

describe('sticker pack access', () => {
  it('keeps private packs between their creator and workspace owner', () => {
    expect(canReadStickerPack(actor('member'), pack)).toBe(false);
    expect(canReadStickerPack(actor('viewer'), pack)).toBe(false);
    expect(canReadStickerPack(actor('member', pack.ownerUserId), pack)).toBe(true);
    expect(canReadStickerPack(actor('owner'), pack)).toBe(true);
  });

  it('allows every current role to read shared and builtin packs', () => {
    for (const role of ['owner', 'member', 'viewer'] as const) {
      expect(canReadStickerPack(actor(role), { ...pack, visibility: 'workspace' })).toBe(true);
      expect(
        canReadStickerPack(actor(role), {
          ...pack,
          kind: 'builtin',
          workspaceId: null,
          ownerUserId: null,
        }),
      ).toBe(true);
    }
  });

  it('only lets the creator or workspace owner manage a custom pack', () => {
    expect(canManageStickerPack(actor('member'), pack)).toBe(false);
    expect(canManageStickerPack(actor('viewer', pack.ownerUserId), pack)).toBe(false);
    expect(canManageStickerPack(actor('member', pack.ownerUserId), pack)).toBe(true);
    expect(canManageStickerPack(actor('owner'), pack)).toBe(true);
    expect(canManageStickerPack(actor('owner'), { ...pack, kind: 'builtin' })).toBe(false);
  });
});
