/** Сведения об артисте из открытых источников: Deezer + Википедия. Разбор — чистые функции. */
export type ArtistInfo = {
  name: string;
  picture: string | null;
  genres: string[];
  fans: number | null;
  albums: number | null;
  biography: string;
  wikiUrl: string | null;
  similar: { name: string; picture: string | null }[];
};

const obj = (value: unknown): Record<string, any> => (value && typeof value === 'object' ? (value as Record<string, any>) : {});
const text = (value: unknown, max = 300) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const digits = (value: unknown) => {
  const match = String(value ?? '').match(/\d+/g);
  return match ? Number(match.join('')) : null;
};

/** https-обложки разрешены только с CDN Deezer — чужие ссылки в markup нам не нужны. */
export function safePicture(value: unknown, hosts: string[]): string | null {
  const raw = text(value, 800);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)) ? url.href : null;
  } catch {
    return null;
  }
}

const key = (value: string) => value.toLocaleLowerCase().replace(/[^a-zа-я0-9]+/gi, '');

/** Лучшее совпадение из `search/artist`: точное имя важнее частичного. */
export function pickDeezerArtist(payload: unknown, wanted: string): Record<string, any> | null {
  const rows: Record<string, any>[] = Array.isArray(obj(payload).data) ? obj(payload).data.map(obj) : [];
  if (!rows.length) return null;
  const target = key(wanted);
  return (
    rows.find((row) => key(text(row.name)) === target && /^\d+$/.test(String(row.id ?? ''))) ||
    rows.find((row) => key(text(row.name)).includes(target) && /^\d+$/.test(String(row.id ?? ''))) ||
    rows.find((row) => /^\d+$/.test(String(row.id ?? ''))) ||
    null
  );
}

export function parseDeezerArtist(payload: unknown): Omit<ArtistInfo, 'similar' | 'biography' | 'wikiUrl'> | null {
  const data = obj(payload);
  const name = text(data.name, 160);
  if (!name) return null;
  return {
    name,
    picture: safePicture(data.picture_xl || data.picture_big || data.picture, ['cdn-images.dzcdn.net', 'images.dmca.com']),
    genres: [text(obj(data.genre).name, 60)].filter(Boolean),
    fans: digits(data.nb_fan),
    albums: digits(data.nb_album),
  };
}

export function parseDeezerSimilar(payload: unknown, limit = 8): { name: string; picture: string | null }[] {
  const rows: Record<string, any>[] = Array.isArray(obj(payload).data) ? obj(payload).data : [];
  const seen = new Set<string>();
  return rows
    .map(obj)
    .filter((row: Record<string, any>) => text(row.name) && /^\d+$/.test(String(row.id ?? '')))
    .filter((row: Record<string, any>) => !seen.has(key(text(row.name))) && !!seen.add(key(text(row.name))))
    .slice(0, limit)
    .map((row: Record<string, any>) => ({ name: text(row.name, 160), picture: safePicture(row.picture_medium || row.picture_small, ['cdn-images.dzcdn.net']) }));
}

/** Ответ Википедии (generator=search + extracts + pageimages) → краткая справка, ссылка и превью. */
export function parseWikipedia(payload: unknown, wanted: string, language: 'ru' | 'en' = 'en'): { biography: string; url: string | null; thumbnail: string | null } {
  const rawPages = Object.values(obj(obj(payload).query).pages || {}).map(obj);
  if (!rawPages.length) return { biography: '', url: null, thumbnail: null };
  const withText = rawPages.filter((page) => text(page.extract, 1400).length > 20);
  const pages = withText.length ? withText : rawPages;
  const target = key(wanted);
  const best =
    pages.find((page) => key(text(page.title, 300)).startsWith(target)) ||
    [...pages].sort((a, b) => Number(a.index ?? 99) - Number(b.index ?? 99))[0] ||
    pages[0];
  const extract = text(best.extract, 1400).replace(/\s+/g, ' ');
  const selfLink = text(best.url, 400);
  const title = text(best.title, 200);
  const url = /^https?:\/\//.test(selfLink) ? selfLink : title ? `https://${language}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}` : null;
  return { biography: extract, url: url?.startsWith('https://') ? url : null, thumbnail: safePicture(obj(best.thumbnail).source, ['wikimedia.org']) };
}

/** Поддомены Википедии для языка интерфейса: ru-статьи точнее описывают русскую сцену. */
export function wikipediaLanguage(language: string): 'ru' | 'en' {
  return language.startsWith('ru') ? 'ru' : 'en';
}

export function wikipediaUrl(name: string, language: 'ru' | 'en'): string {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrsearch: `${name} musician OR singer OR band OR рэпер OR группа OR певица OR певец`,
    gsrnamespace: '0',
    gsrlimit: '5',
    prop: 'extracts|pageimages|info',
    inprop: 'url',
    exintro: '1',
    explaintext: '1',
    exlimit: '5',
    piprop: 'thumbnail',
    pithumbsize: '640',
  });
  return `https://${language}.wikipedia.org/w/api.php?${params.toString()}`;
}

export function deezerArtistSearchUrl(name: string): string {
  return `https://api.deezer.com/search/artist?q=${encodeURIComponent(name.slice(0, 200))}&limit=8`;
}

const deezerPage = (kind: string, limit: number) => (id: string | number) =>
  `https://api.deezer.com/artist/${encodeURIComponent(String(id))}/${kind}?limit=${limit}`;

export const deezerRelatedUrl = deezerPage('related', 8);
export const deezerTopUrl = deezerPage('top', 10);
export const deezerAlbumsUrl = deezerPage('albums', 6);
