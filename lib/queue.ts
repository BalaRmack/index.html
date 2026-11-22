/** Логика очереди: перетаскивание, удаление и переходы — отдельно от React, чтобы можно было тестировать. */
export type QueueIndex = { index: number; end: boolean };

export function moveInQueue<T>(items: readonly T[], from: number, to: number): T[] {
  const result = [...items];
  if (from < 0 || from >= result.length) return result;
  const clamped = Math.max(0, Math.min(result.length - 1, to));
  const [moved] = result.splice(from, 1);
  result.splice(clamped, 0, moved);
  return result;
}

export function removeInQueue<T>(items: readonly T[], index: number): T[] {
  if (index < 0 || index >= items.length) return [...items];
  return [...items.slice(0, index), ...items.slice(index + 1)];
}

/** Удалили трек до текущего — играющий трек уезжает на позицию левее. */
export function indexAfterRemove(current: number, removed: number): number {
  if (removed < current) return Math.max(0, current - 1);
  return current;
}

/** Добавляем в конец без дублей и с жёстким потолком размера. */
export function appendQueue<T extends { id: string }>(existing: readonly T[], additions: readonly T[], limit = 300): { items: T[]; added: number } {
  const seen = new Set(existing.map((item) => item.id));
  const fresh = additions.filter((item) => item && !seen.has(item.id) && !!seen.add(item.id));
  const items = [...existing, ...fresh];
  return { items: items.length > limit ? items.slice(items.length - limit) : items, added: fresh.length };
}

export function trackIds<T extends { video_id?: string | null }>(items: readonly T[]): string[] {
  return items.map((item) => item.video_id || '').filter(Boolean);
}

/**
 * Следующий/предыдущий трек. При включённом перемешивании пропускаем текущий индекс,
 * иначе после random() легко получились бы два одинаковых трека подряд.
 */
export function resolveNextIndex(options: { length: number; index: number; direction?: 1 | -1; shuffle?: boolean; repeat?: boolean }): QueueIndex {
  const direction = options.direction ?? 1;
  const { length, index, shuffle = false, repeat = false } = options;
  if (length <= 0) return { index: 0, end: true };
  if (length === 1) return repeat ? { index: 0, end: false } : { index: 0, end: direction > 0 };
  let next = shuffle && direction > 0 ? Math.floor(Math.random() * (length - 1)) : index + direction;
  if (shuffle && direction > 0 && next >= index) next += 1;
  if (next < 0) return { index: 0, end: false };
  if (next >= length) {
    if (repeat) return { index: 0, end: false };
    return { index: length - 1, end: true };
  }
  return { index: next, end: false };
}

/** Позиция для перетаскивания мышью: превращаем смещение курсора в индекс строки. */
export function dropIndexFrom(offset: number, itemCount: number): number {
  if (!Number.isFinite(offset)) return itemCount - 1;
  return Math.max(0, Math.min(itemCount - 1, Math.floor(offset / 56)));
}
