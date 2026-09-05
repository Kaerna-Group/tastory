import { describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@/shared/api';
import type { StickerCommand, StickerData } from '@tastory/contracts';
import { StickerPlacementRequests, stickerPlacementScope } from './sticker-placement-requests';

const recipeId = '00000000-0000-4000-8000-000000000001';
const instanceId = '00000000-0000-4000-8000-000000000002';
const request1 = '00000000-0000-4000-8000-000000000003';
const request2 = '00000000-0000-4000-8000-000000000004';
const command = {
  action: 'recipes.stickers.update' as const,
  payload: {
    recipeId,
    instanceId,
    expectedRevision: 1,
    page: 1,
    pageId: 'page-1',
    x: 12,
    y: 14,
    width: 18,
    height: 18,
    rotation: 15,
    zIndex: 2,
  },
};

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

const result: StickerData = {
  kind: 'recipeSticker',
  recipeId,
  sticker: {
    id: instanceId,
    recipeId,
    stickerId: request1,
    packId: request2,
    name: 'Ягода',
    emoji: '🍓',
    mimeType: 'image/png',
    assetWidth: 64,
    assetHeight: 64,
    assetBytes: 100,
    assetDigest: 'a'.repeat(64),
    assetKey: 'jam',
    page: 1,
    pageId: 'page-1',
    x: 12,
    y: 14,
    width: 18,
    height: 18,
    rotation: 15,
    zIndex: 2,
    status: 'active',
    revision: 2,
    createdAt: '2026-09-05T00:00:00.000Z',
    updatedAt: '2026-09-05T00:01:00.000Z',
  },
  outcome: 'replayed',
};

describe('StickerPlacementRequests', () => {
  it('repeats an unknown placement result with the same request ID after reload', async () => {
    const storage = new MemoryStorage();
    const request = vi
      .fn<(command: StickerCommand, requestId: string) => Promise<StickerData>>()
      .mockRejectedValueOnce(new ApiClientError('TRANSPORT_ERROR', 'lost'))
      .mockResolvedValueOnce(result);
    const first = new StickerPlacementRequests(storage, 'scope', request, () => request1);
    await expect(first.execute(command)).rejects.toThrow('lost');
    const reloaded = new StickerPlacementRequests(storage, 'scope', request, () => request2);
    await expect(reloaded.execute(command)).resolves.toEqual(result);
    expect(request.mock.calls.map((call) => call[1])).toEqual([request1, request1]);
    expect(reloaded.pending()).toEqual([]);
  });

  it('separates accounts and never stores credentials', async () => {
    const storage = new MemoryStorage();
    const request = vi.fn().mockRejectedValue(new ApiClientError('STICKER_CONFLICT', 'conflict'));
    const chef = new StickerPlacementRequests(
      storage,
      stickerPlacementScope('api', 'chef'),
      request,
      () => request1,
    );
    await expect(chef.execute(command)).rejects.toThrow('conflict');
    const viewer = new StickerPlacementRequests(
      storage,
      stickerPlacementScope('api', 'viewer'),
      async () => result,
      () => request2,
    );
    expect(viewer.pending()).toEqual([]);
    expect(JSON.stringify([...storage.values.values()])).not.toContain('token');
  });
});
