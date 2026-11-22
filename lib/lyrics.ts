/** Разбор LRC и запросы к открытому LRCLIB. Никакого DOM: чисто, тестируется без сети. */
export type LyricLine = { time: number; text: string };

const LRCLIB = 'https://lrclib.net';
const TIME_STAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

/**
 * Поддерживает несколько таймкодов в одной строке («[00:12.10][01:45.00]припев»)
 * и метаданные вида [offset:500] — их применяем к остальным строкам.
 */
export function parseLrc(source: string | null | undefined): LyricLine[] {
  if (typeof source !== 'string' || !source) return [];
  let offset = 0;
  const lines: LyricLine[] = [];
  for (const rawLine of String(source).replace(/\r/g, '').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    // Метаданные читаем до таймкодов: у строки [offset:500] их просто нет.
    const meta = /^\[(offset|re|ve|ti|ar|au):([^\]]*)\]$/i.exec(line);
    if (meta) {
      if (meta[1].toLowerCase() === 'offset') {
        const value = Number.parseInt(meta[2].replace(/[^+-\d]/g, ''), 10);
        if (Number.isFinite(value)) offset = value / 1000;
      }
      continue;
    }
    const stamps = [...line.matchAll(TIME_STAMP)];
    if (!stamps.length) continue;
    const text = line.replace(TIME_STAMP, '').trim();
    for (const stamp of stamps) {
      const minutes = Number(stamp[1]);
      const seconds = Number(stamp[2]);
      const fraction = Number(`0.${(stamp[3] || '0').padEnd(3, '0')}`);
      if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) continue;
      const time = Math.max(0, minutes * 60 + seconds + fraction - offset);
      if (text) lines.push({ time, text });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

/** Индекс последней строки, которая уже должна гореть (бинарный поиск). */
export function activeLyricLine(lines: readonly LyricLine[], seconds: number): number {
  if (!lines.length || seconds < lines[0].time) return -1;
  let low = 0;
  let high = lines.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (lines[middle].time <= seconds) low = middle;
    else high = middle - 1;
  }
  return low;
}

const clean = (value: unknown, max = 200) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** Убираем «(Official Video)», «— Topic» и прочий мусор из названий при поиске текста. */
export function searchTitle(title: string): string {
  return clean(title, 200)
    .replace(/\s*[([][^)\]]*(official|lyrics?|video|audio|remaster|version|live)[^)\]]*[)\]]/gi, '')
    .replace(/\s*[–—-]\s*(topic|vevo|mvo)$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function searchArtist(artist: string): string {
  return clean(artist, 160)
    .replace(/\s*[–—-]\s*topic$/i, '')
    .replace(/\s*[([][^)\]]*[)\]]/g, '')
    .replace(/^-\s*/, '')
    .trim();
}

export function isSupportedQuery(input: { title?: string; artist?: string }) {
  return searchTitle(input.title || '').length >= 2 && searchArtist(input.artist || '').length >= 1;
}

export function lyricsUrl(input: { title: string; artist: string; duration?: number; album?: string }): string {
  const params = new URLSearchParams();
  const title = searchTitle(input.title);
  const artist = searchArtist(input.artist);
  if (title) params.set('track_name', title);
  if (artist) params.set('artist_name', artist);
  const album = clean(input.album, 160);
  if (album) params.set('album_name', album);
  const duration = Math.round(Number(input.duration));
  if (Number.isFinite(duration) && duration > 0) params.set('duration', String(Math.min(3600, duration)));
  return `${LRCLIB}/api/search?${params.toString()}`;
}

export type LyricResult = { synced: LyricLine[]; plain: string; source: 'lrclib' | 'none'; language?: string; instrumentational?: boolean };

const key = (value: string) => value.toLocaleLowerCase('ru-RU').replace(/[^\p{L}\p{N}]+/gu, '');

/** Из выдачи /api/search берём совпадение по артисту и названию, иначе первую строку. */
export function chooseLyrics(payload: unknown, input: { title: string; artist: string }): LyricResult {
  const rows = Array.isArray(payload) ? payload : [];
  const wantedTitle = key(searchTitle(input.title));
  const wantedArtist = key(searchArtist(input.artist));
  const rank = (row: Record<string, any>) => {
    const rowTitle = key(clean(row?.parsed?.trackName || row?.trackName, 200));
    const rowArtist = key(clean(row?.parsed?.artistName || row?.artistName, 160));
    return (wantedTitle && rowTitle === wantedTitle ? 2 : wantedTitle && rowTitle.includes(wantedTitle) ? 1 : 0)
      + (wantedArtist && rowArtist === wantedArtist ? 2 : wantedArtist && rowArtist.includes(wantedArtist) ? 1 : 0);
  };
  const best = [...rows]
    .map((row) => (row && typeof row === 'object' ? (row as Record<string, any>) : {}))
    .sort((a, b) => rank(b) - rank(a))
    .find((row) => clean(row.syncedLyrics).length > 0 || clean(row.plainLyrics).length > 0);
  if (!best) return { synced: [], plain: '', source: 'none' };
  const synced = parseLrc(clean(best.syncedLyrics, 200_000));
  const plain = clean(best.plainLyrics, 60_000);
  if (!synced.length && !plain) return { synced: [], plain: '', source: 'none' };
  return {
    synced,
    plain,
    source: 'lrclib',
    language: clean(best.language, 40) || undefined,
    instrumentational: Boolean(best.instrumental) || (!synced.length && !plain),
  };
}

/** Ключ кэша найденных текстов: одинаковые треки ищем один раз за сессию. */
export function lyricsCacheKey(input: { title: string; artist: string; duration?: number }) {
  return `${key(searchArtist(input.artist))}|${key(searchTitle(input.title))}|${Math.round(Number(input.duration) || 0)}`;
}
