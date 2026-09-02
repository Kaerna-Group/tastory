import { PHOTO_LIMITS } from '@tastory/contracts';
import type { PhotoUpload } from '@tastory/contracts';

export type PreparedPhoto = {
  payload: PhotoUpload;
  sourceBytes: number;
  imageBytes: number;
  thumbnailBytes: number;
};
const jpegBlob = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Не удалось уменьшить фото.'))),
      'image/jpeg',
      quality,
    );
  });
async function resize(image: HTMLImageElement, edge: number, limit: number, signal: AbortSignal) {
  const canvas = document.createElement('canvas');
  try {
    for (let size = edge; size >= Math.min(edge, 320); size = Math.floor(size * 0.75)) {
      signal.throwIfAborted();
      const scale = Math.min(1, size / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Этот браузер не может обработать фото.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.86, 0.72, 0.58, 0.44]) {
        const blob = await jpegBlob(canvas, quality);
        signal.throwIfAborted();
        if (blob.size <= limit) return blob;
      }
    }
    throw new Error('Фото слишком сложное для пробной загрузки. Выберите другое.');
  } finally {
    canvas.width = canvas.height = 0;
  }
}
async function base64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768)
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}
export async function preparePhoto(file: File, signal: AbortSignal): Promise<PreparedPhoto> {
  if (
    !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
    !file.size ||
    file.size > PHOTO_LIMITS.sourceBytes
  )
    throw new Error('Выберите JPEG, PNG или WebP размером до 20 МБ.');
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = url;
    try {
      await image.decode();
    } catch {
      throw new Error('Изображение не удалось открыть. Выберите другое фото.');
    }
    signal.throwIfAborted();
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      image.naturalWidth * image.naturalHeight > PHOTO_LIMITS.sourcePixels
    )
      throw new Error('Выберите фото с разрешением до 40 мегапикселей.');
    const optimized = await resize(image, PHOTO_LIMITS.imageEdge, PHOTO_LIMITS.imageBytes, signal);
    const thumbnail = await resize(
      image,
      PHOTO_LIMITS.thumbnailEdge,
      PHOTO_LIMITS.thumbnailBytes,
      signal,
    );
    const imageBase64 = await base64(optimized),
      thumbnailBase64 = await base64(thumbnail);
    signal.throwIfAborted();
    return {
      payload: { uploadId: crypto.randomUUID(), imageBase64, thumbnailBase64 },
      sourceBytes: file.size,
      imageBytes: optimized.size,
      thumbnailBytes: thumbnail.size,
    };
  } finally {
    image.src = '';
    URL.revokeObjectURL(url);
  }
}
