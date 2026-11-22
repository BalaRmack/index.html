import { NextResponse } from 'next/server';
import { searchCatalog, type CatalogTrack } from '@/lib/catalog';
import { withTimeout } from '@/lib/fresh-picks';
import {
  deezerArtistSearchUrl,
  deezerRelatedUrl,
  parseDeezerArtist,
  parseDeezerSimilar,
  pickDeezerArtist,
  parseWikipedia,
  wikipediaLanguage,
  wikipediaUrl,
} from '@/lib/artist-info';

export const dynamic = 'force-dynamic';

/** Прокси к Deezer и Википедии: страницы артиста не должны зависеть от CORS браузера. */
async function readJson(url: string, timeoutMs: number): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' }, redirect: 'error', cache: 'default' });
  if (!response.ok) throw new Error('unavailable');
  const raw = await response.text();
  if (raw.length > 1_500_000) throw new Error('too large');
  return JSON.parse(raw);
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const name = (params.get('name') || '').trim().slice(0, 120);
  if (name.length < 2) return NextResponse.json({ error: 'Укажите исполнителя.' }, { status: 400 });
  const lang = wikipediaLanguage(params.get('lang') || 'ru');

  const profile = withTimeout(
    (async () => {
      const found = pickDeezerArtist(await readJson(deezerArtistSearchUrl(name), 2600), name);
      if (!found) throw new Error('no artist');
      const [artist, related] = await Promise.all([
        Promise.resolve(found),
        readJson(deezerRelatedUrl(found.id), 2200).catch(() => ({})),
      ]);
      const parsed = parseDeezerArtist(artist);
      if (!parsed) throw new Error('bad artist');
      return { ...parsed, similar: parseDeezerSimilar(related) };
    })(),
    3200,
    null,
  );

  const wiki = withTimeout(
    readJson(wikipediaUrl(name, lang), 2400).then((payload) => parseWikipedia(payload, name, lang)).catch(() => ({ biography: '', url: null, thumbnail: null })),
    2600,
    { biography: '', url: null, thumbnail: null },
  );

  const tracks = withTimeout(
    searchCatalog(`${name} music`).then((result) => result.value.slice(0, 14)).catch(() => [] as CatalogTrack[]),
    3000,
    [] as CatalogTrack[],
  );

  const [deezer, summary, catalog] = await Promise.all([profile, wiki, tracks]);
  // частичный ответ лучше ошибки: страница артиста открывается всегда, просто беднее.
  return NextResponse.json(
    {
      name: deezer?.name || name,
      picture: deezer?.picture ?? summary.thumbnail,
      genres: deezer?.genres ?? [],
      fans: deezer?.fans ?? null,
      albums: deezer?.albums ?? null,
      biography: summary.biography,
      wikiUrl: summary.url,
      similar: deezer?.similar ?? [],
      tracks: catalog,
      partial: !deezer && !summary.biography && !catalog.length,
    },
    { headers: { 'Cache-Control': `public, s-maxage=${deezer ? 86400 : 300}, stale-while-revalidate=604800` } },
  );
}
