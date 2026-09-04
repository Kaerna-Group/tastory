import { describe, expect, it } from 'vitest';
import { inspectStickerImage } from './sticker-assets';

describe('sticker image inspection', () => {
  it('reads bounded PNG and static WebP dimensions', () => {
    const png = [
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 1, 128, 0, 0, 1, 128, 8,
      6, 0, 0, 0, 0, 0, 0, 0,
    ];
    expect(inspectStickerImage(png, 'image/png')).toEqual({ width: 384, height: 384 });
    const webp = [
      82, 73, 70, 70, 22, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 88, 10, 0, 0, 0, 16, 0, 0, 0, 127, 1,
      0, 127, 1, 0,
    ];
    expect(inspectStickerImage(webp, 'image/webp')).toEqual({ width: 384, height: 384 });
  });

  it('rejects animation, wrong signatures and oversized dimensions', () => {
    const animated = [
      82, 73, 70, 70, 22, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 88, 10, 0, 0, 0, 2, 0, 0, 0, 10, 0,
      0, 10, 0, 0,
    ];
    expect(() => inspectStickerImage(animated, 'image/webp')).toThrow('STICKER_INVALID');
    expect(() => inspectStickerImage([1, 2, 3], 'image/png')).toThrow('STICKER_INVALID');
  });
});
