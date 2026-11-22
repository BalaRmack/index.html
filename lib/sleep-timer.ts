/** Таймер сна: плавное затухание громкости и остановка в нужный момент. */
export const SLEEP_MINUTES = [15, 30, 45, 60] as const;
export const SLEEP_FADE_SECONDS = 25;

export type SleepTimer = { kind: 'off' } | { kind: 'minutes'; endsAt: number } | { kind: 'track' };

export const sleepOff = (): SleepTimer => ({ kind: 'off' });
export const sleepMinutes = (minutes: number, now = Date.now()): SleepTimer => ({ kind: 'minutes', endsAt: now + Math.max(1, Math.round(minutes)) * 60_000 });
export const sleepEndOfTrack = (): SleepTimer => ({ kind: 'track' });

/** Сколько секунд осталось до выключения (для «до конца трека» считаем снаружи). */
export function secondsLeft(timer: SleepTimer, now = Date.now()): number | null {
  if (timer.kind !== 'minutes') return null;
  return Math.max(0, (timer.endsAt - now) / 1000);
}

/**
 * Множитель громкости: последние SLEEP_FADE_SECONDS секунд плавно уводят звук в ноль.
 * Возвращаемое значение уже поделено на 100 — умножаем на текущую громкость пользователя.
 */
export function sleepMultiplier(timer: SleepTimer, now = Date.now(), fadeSeconds = SLEEP_FADE_SECONDS): number {
  const left = secondsLeft(timer, now);
  if (left === null) return 1;
  if (left <= 0) return 0;
  if (left >= fadeSeconds) return 1;
  return Math.max(0, Math.min(1, left / fadeSeconds));
}

export function sleepExpired(timer: SleepTimer, now = Date.now()): boolean {
  return timer.kind === 'minutes' && timer.endsAt - now <= 0;
}

/** Валидация таймера из localStorage: только числа и осмысленный срок. */
export function sanitizeSleepTimer(raw: unknown): SleepTimer {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  if (value.kind === 'track') return { kind: 'track' };
  if (value.kind === 'minutes' && Number.isFinite(Number(value.endsAt)) && Number(value.endsAt) > Date.now() - 60_000) {
    return { kind: 'minutes', endsAt: Number(value.endsAt) };
  }
  return { kind: 'off' };
}
