/** Обложки плейлистов: маленькое превью в виде data URL (приватный бакет не требует подписи ссылок). */
export const COVER_MAX_BYTES = 220_000;
export const COVER_SIDE = 240;

export type CoverFileCheck = { ok: true; type: string } | { ok: false; reason: 'type' | 'size' };

/** Проверку проходим до чтения файла: не читаем в память 40-мегабайтный PNG. */
export function checkCoverFile(file: { type?: string; size?: number }, maxBytes = 6 * 1024 * 1024): CoverFileCheck {
  const type = String(file.type || '').toLowerCase();
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(type)) return { ok: false, reason: 'type' };
  if (Number(file.size) > maxBytes) return { ok: false, reason: 'size' };
  return { ok: true, type };
}

export function isCoverDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.length <= COVER_MAX_BYTES && /^data:image\/(png|jpe?g|webp);base64,[a-z0-9+/=]+$/i.test(value);
}

/**
 * Square-crop + даунскейл в JPEG: обложка должна весить десятки килобайт,
 * потому что лежит рядом с названием плейлиста (в БД и в localStorage гостя).
 */
export async function makeCoverDataUrl(file: File, side = COVER_SIDE): Promise<string> {
  const check = checkCoverFile(file);
  if (!check.ok) throw new Error(check.reason === 'size' ? 'Файл слишком большой.' : 'Нужен PNG, JPEG или WebP.');
  const bitmap = await readBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas недоступен.');
  const source = bitmap || await readImage(file);
  const width = 'width' in source ? source.width : 0;
  const height = 'height' in source ? source.height : 0;
  const size = Math.min(width, height) || side;
  context.fillStyle = '#141a15';
  context.fillRect(0, 0, side, side);
  context.drawImage(source as CanvasImageSource, (width - size) / 2, (height - size) / 2, size, size, 0, 0, side, side);
  if ('close' in source && typeof source.close === 'function') source.close();
  for (const quality of [0.74, 0.6, 0.45]) {
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url.length <= COVER_MAX_BYTES) return url;
  }
  throw new Error('Не удалось сжать обложку.');
}

async function readBitmap(file: File): Promise<ImageBitmap | null> {
  try {
    if (typeof createImageBitmap !== 'function') return null;
    return await createImageBitmap(file);
  } catch {
    return null;
  }
}

function readImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Изображение не читается.')); };
    image.src = url;
  });
}
