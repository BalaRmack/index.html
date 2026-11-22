/** Человекочитаемые даты и длительности: без технических «—» и «Стриминг» в интерфейсе. */

/** Секунды → «М:СС». 75 → '1:15', 600 → '10:00'. Неизвестная длительность — пустая строка. */
export function formatDuration(seconds: number | null | undefined): string {
  const total = Math.round(Number(seconds));
  if (!Number.isFinite(total) || total <= 0) return '';
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

const DAY = 24 * 60 * 60 * 1000;
const startOfDay = (time: number) => {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

function calendarDate(value: Date, locale: string) {
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(value);
  } catch {
    return value.toLocaleDateString();
  }
}

/**
 * «Сегодня», «Вчера», «3 дня назад» или «22 нояб. 2026».
 * Возвращает пустую строку, когда дата неизвестна — колонка тогда просто молчит.
 */
export function formatAddedDate(value: string | number | null | undefined, options: { now?: number; locale?: string } = {}): string {
  if (value === null || value === undefined || value === '') return '';
  const time = typeof value === 'number' ? value : Date.parse(String(value));
  if (!Number.isFinite(time)) return '';
  const locale = options.locale || 'ru-RU';
  const now = options.now ?? Date.now();
  const days = Math.floor((startOfDay(now) - startOfDay(time)) / DAY);
  if (days <= 0) return locale.startsWith('en') ? 'Today' : 'Сегодня';
  if (days === 1) return locale.startsWith('en') ? 'Yesterday' : 'Вчера';
  if (days < 7 && !locale.startsWith('en')) return `${days} дн. назад`;
  if (days < 7) return `${days} days ago`;
  return calendarDate(new Date(time), locale);
}

/** Длительность для подписи «осталось слушать» в панели «Сейчас играет». */
export function formatRemaining(seconds: number | null | undefined): string {
  const total = Math.round(Number(seconds));
  if (!Number.isFinite(total) || total <= 0) return '';
  return `−${formatDuration(total)}`;
}

/** Часы таймера сна: 45 → «45 мин», 90 → «1 ч 30 мин». */
export function formatMinutes(minutes: number, locale = 'ru'): string {
  const value = Math.max(0, Math.round(minutes));
  if (value < 60) return locale === 'en' ? `${value} min` : `${value} мин`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  const tail = rest ? (locale === 'en' ? ` ${rest} min` : ` ${rest} мин`) : '';
  return locale === 'en' ? `${hours} h${tail}` : `${hours} ч${tail}`;
}
