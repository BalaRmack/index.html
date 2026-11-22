/** Переходы между треками и бережная нормализация громкости. */

/** Плавное появление: первые fadeSeconds секунд трек набирает громкость. */
export function fadeInGain(elapsed: number, fadeSeconds: number): number {
  if (fadeSeconds <= 0) return 1;
  const value = Number(elapsed);
  if (!Number.isFinite(value) || value <= 0) return 0.02;
  return Math.max(0.02, Math.min(1, value / fadeSeconds));
}

/** Плавное затухание: последние fadeSeconds секунд перед концом. */
export function fadeOutGain(remaining: number, fadeSeconds: number): number {
  if (fadeSeconds <= 0) return 1;
  const value = Number(remaining);
  if (!Number.isFinite(value)) return 1;
  if (value >= fadeSeconds) return 1;
  if (value <= 0) return 0;
  return Math.max(0, Math.min(1, value / fadeSeconds));
}

/** Порог, с которого пора начинать отпускание (учитываем, что длительность может быть неизвестна). */
export function shouldFadeOut(remaining: number, fadeSeconds: number): boolean {
  return fadeSeconds > 0 && Number.isFinite(remaining) && remaining > 0 && remaining <= fadeSeconds;
}

/**
 * Итоговая громкость элемента 0..1.
 * Нормализация для внешних стримов — это мягкий потолок громкости: переопределить
 * мастеринг трека в iframe YouTube нельзя, зато пики можно честно прибрать.
 */
export function resolveVolume(options: {
  volume: number;
  normalize?: boolean;
  remote?: boolean;
  fade?: number;
}): number {
  const base = Math.max(0, Math.min(100, Number(options.volume) || 0)) / 100;
  const fade = Math.max(0, Math.min(1, options.fade ?? 1));
  let value = base;
  if (options.normalize) {
    const ceiling = options.remote ? 0.86 : 0.92;
    value = base > ceiling ? ceiling + (base - ceiling) * 0.35 : base;
  }
  return Math.max(0, Math.min(1, value * fade));
}

/** Плавность для Web Audio: экспонента, а не линейка — так переход не щёлкает. */
export function applyRamp(param: { setValueAtTime: (value: number, time: number) => void; exponentialRampToValueAtTime: (value: number, time: number) => void }, target: number, now: number, seconds: number) {
  const safe = Math.max(0.0001, target);
  try {
    param.setValueAtTime(safe, now);
    param.exponentialRampToValueAtTime(Math.max(0.0001, safe * 0.999), now + Math.max(0.05, seconds));
  } catch {
    /* Параметр мог быть отсоединён вместе со старым плеером. */
  }
}
