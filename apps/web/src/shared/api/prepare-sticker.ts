import { STICKER_LIMITS } from '@tastory/contracts';
import type { StickerUpload } from '@tastory/contracts';

export type PreparedSticker = Omit<StickerUpload, 'uploadId'>;

function base64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
function canvasBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Не удалось подготовить стикер.'))),
      'image/webp',
      quality,
    ),
  );
}

export async function prepareSticker(file: File): Promise<PreparedSticker> {
  if (file.type !== 'image/png' && file.type !== 'image/webp')
    throw new Error('Выберите статичный PNG или WebP.');
  const image = await createImageBitmap(file);
  try {
    if (image.width < 1 || image.height < 1)
      throw new Error('Не удалось определить размер стикера.');
    if (
      file.size <= STICKER_LIMITS.imageBytes &&
      image.width <= STICKER_LIMITS.imageEdge &&
      image.height <= STICKER_LIMITS.imageEdge
    )
      return {
        base64: base64(await file.arrayBuffer()),
        mimeType: file.type,
        width: image.width,
        height: image.height,
        bytes: file.size,
      };
    const scale = Math.min(1, 512 / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Браузер не поддерживает подготовку стикеров.');
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    let blob: Blob | null = null;
    for (const quality of [0.9, 0.8, 0.7, 0.6]) {
      const candidate = await canvasBlob(canvas, quality);
      if (candidate.size <= STICKER_LIMITS.imageBytes) {
        blob = candidate;
        break;
      }
    }
    if (!blob) throw new Error('Стикер не удалось уменьшить до безопасного размера.');
    return {
      base64: base64(await blob.arrayBuffer()),
      mimeType: 'image/webp',
      width,
      height,
      bytes: blob.size,
    };
  } finally {
    image.close();
  }
}
