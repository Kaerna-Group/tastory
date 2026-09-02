import { PhotoError } from './photo-error';

// A bounded JPEG envelope/dimension check, not a full image decoder.
export function inspectJpeg(bytes: number[], maxBytes: number, maxEdge: number) {
  const b = (i: number) => (bytes[i] ?? 0) & 255;
  const word = (i: number) => (b(i) << 8) | b(i + 1);
  if (
    bytes.length < 20 ||
    bytes.length > maxBytes ||
    word(0) !== 0xffd8 ||
    word(bytes.length - 2) !== 0xffd9
  )
    throw new PhotoError('PHOTO_INVALID');
  let dimensions: { width: number; height: number } | undefined;
  for (let i = 2; i + 3 < bytes.length;) {
    if (b(i++) !== 255) throw new PhotoError('PHOTO_INVALID');
    while (b(i) === 255) i++;
    const marker = b(i++);
    if (marker === 0xda) {
      if (!dimensions) throw new PhotoError('PHOTO_INVALID');
      return dimensions;
    }
    const length = word(i);
    if (length < 2 || i + length > bytes.length) throw new PhotoError('PHOTO_INVALID');
    if (marker === 0xc0 || marker === 0xc2) {
      const height = word(i + 3),
        width = word(i + 5);
      if (
        length < 8 ||
        b(i + 2) !== 8 ||
        width < 1 ||
        height < 1 ||
        width > maxEdge ||
        height > maxEdge
      )
        throw new PhotoError('PHOTO_INVALID');
      dimensions = { width, height };
    }
    i += length;
  }
  throw new PhotoError('PHOTO_INVALID');
}
