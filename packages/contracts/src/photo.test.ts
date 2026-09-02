import { describe, expect, it } from 'vitest';
import { PHOTO_LIMITS, photoUploadSchema } from './photo';
describe('bounded photo envelopes', () => {
  const payload = {
    uploadId: 'c3dcd2e8-e2f8-428b-9e26-3e715f678fac',
    imageBase64: 'AAAA',
    thumbnailBase64: 'AAAA',
  };
  it('validates the full allowed payload without recursive regular expressions', () => {
    const imageBase64 = 'A'.repeat(Math.ceil(PHOTO_LIMITS.imageBytes / 3) * 4);
    expect(photoUploadSchema.safeParse({ ...payload, imageBase64 }).success).toBe(true);
    expect(
      photoUploadSchema.safeParse({ ...payload, imageBase64: imageBase64 + 'AAAA' }).success,
    ).toBe(false);
  });
  it.each(['A', 'AA=A', 'A===', 'https://example.com/image', 'data:image/jpeg;base64,AAAA'])(
    'rejects invalid base64 %s',
    (imageBase64) => {
      expect(photoUploadSchema.safeParse({ ...payload, imageBase64 }).success).toBe(false);
    },
  );
});
