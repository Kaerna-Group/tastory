import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { BUILTIN_STICKER_ASSET_PATHS, BUILTIN_STICKER_PACKS } from '@tastory/contracts';

describe('builtin sticker files', () => {
  it('matches contract size and base64 digest', async () => {
    for (const sticker of BUILTIN_STICKER_PACKS.flatMap((pack) => pack.stickers)) {
      if (!sticker.assetKey) throw new Error('builtin sticker without asset key');
      const bytes = await readFile(
        new URL(
          `../apps/web/public/${BUILTIN_STICKER_ASSET_PATHS[sticker.assetKey]}`,
          import.meta.url,
        ),
      );
      expect(bytes.byteLength).toBe(sticker.bytes);
      expect(createHash('sha256').update(bytes.toString('base64')).digest('hex')).toBe(
        sticker.digest,
      );
      expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    }
  });
});
