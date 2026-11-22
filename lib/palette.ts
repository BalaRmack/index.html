/** Доминирующие цвета обложки: нужны для живого фона полноэкранного плеера. */
export type Palette = { base: string; glow: string; deep: string; fromArtwork: boolean };

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

export function toHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((value) => clampByte(value).toString(16).padStart(2, '0')).join('')}`;
}

/** HSL → hex: поднимаем насыщенность и светлоту, чтобы градиент не выглядел грязно. */
export function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((char) => char + char).join('') : value;
  const number = Number.parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(number)) return [120, 200, 130];
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

export function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const mix = (channel: number) => (amount >= 0 ? channel + (255 - channel) * amount : channel * (1 + amount));
  return toHex(mix(r), mix(g), mix(b));
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
}

/**
 * Усредняем пиксели по корзинам оттенка: берём самые частые «насыщенные» кластеры,
 * а не просто средний цвет обложки — так фон реально похож на трек.
 */
export function paletteFromPixels(pixels: Uint8ClampedArray | number[], size: number): Palette | null {
  const length = Math.min(pixels.length, size * 4);
  if (length < 4) return null;
  const buckets = new Map<string, { r: number; g: number; b: number; weight: number; count: number }>();
  for (let index = 0; index + 3 < length; index += 4) {
    const r = pixels[index], g = pixels[index + 1], b = pixels[index + 2], a = pixels[index + 3];
    if (a < 128) continue;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    // Пресветлые и почти чёрные пиксели фона не несут настроение трека.
    if (max > 250 || max < 14) continue;
    const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
    const bucket = buckets.get(key) || { r: 0, g: 0, b: 0, weight: 0, count: 0 };
    bucket.r += r; bucket.g += g; bucket.b += b;
    bucket.weight += 0.35 + saturation;
    bucket.count += 1;
    buckets.set(key, bucket);
  }
  const ranked = [...buckets.values()].sort((a, b) => b.weight - a.weight).slice(0, 3);
  if (!ranked.length) return null;
  const average = ranked.map((bucket) => [bucket.r / bucket.count, bucket.g / bucket.count, bucket.b / bucket.count] as const);
  const [br, bg, bb] = average[0];
  const base = toHex(br, bg, bb);
  const second = average[1] ?? average[0];
  const third = average[2] ?? average[0];
  return {
    base,
    glow: toHex(second[0] * 0.55 + br * 0.45, second[1] * 0.55 + bg * 0.45, second[2] * 0.55 + bb * 0.45),
    deep: toHex(third[0] * 0.3, third[1] * 0.3, third[2] * 0.3),
    fromArtwork: true,
  };
}

export function fallbackPalette(accent: string): Palette {
  return { base: accent, glow: shade(accent, -0.35), deep: shade(accent, -0.78), fromArtwork: false };
}

/**
 * Извлекаем палитру из обложки. Для кросс-доменных картинок canvas может быть «испорчен» —
 * тогда тихо возвращаемся на акцентный градиент, а не падаем.
 */
export async function extractPalette(src: string, accent: string, timeoutMs = 2500): Promise<Palette> {
  const fallback = fallbackPalette(accent);
  if (typeof document === 'undefined' || !src) return fallback;
  try {
    const image = await loadImage(src, timeoutMs);
    const canvas = document.createElement('canvas');
    const side = 48;
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context || !image) return fallback;
    context.drawImage(image, 0, 0, side, side);
    return paletteFromPixels(context.getImageData(0, 0, side, side).data, side * side) ?? fallback;
  } catch {
    return fallback;
  }
}

function loadImage(src: string, timeoutMs: number): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const done = (value: HTMLImageElement | null) => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => done(null), timeoutMs);
    // crossOrigin обязателен, иначе getImageData выбросит SecurityError на чужом домене.
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => done(image);
    image.onerror = () => done(null);
    image.src = src;
  });
}
