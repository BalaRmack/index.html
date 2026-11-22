import { NextResponse } from 'next/server';
import { chooseLyrics, isSupportedQuery, lyricsUrl } from '@/lib/lyrics';

export const dynamic = 'force-dynamic';

/**
 * Прокси к LRCLIB: браузеру нельзя ходить на lrclib.net напрямую (CORS и лимиты),
 * а ответ мы кэшируем на edge, чтобы не долбить открытый API на каждую перемотку.
 */
const cached = (seconds: number) => ({ headers: { 'Cache-Control': `public, s-maxage=${seconds}, stale-while-revalidate=86400` } });
const empty = (reason?: string) => NextResponse.json({ synced: [], plain: '', source: 'none', ...(reason ? { reason } : {}) }, cached(600));

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const title = (params.get('title') || '').slice(0, 200);
  const artist = (params.get('artist') || '').slice(0, 160);
  const album = (params.get('album') || '').slice(0, 160) || undefined;
  const rawDuration = Number(params.get('duration'));
  const duration = Number.isFinite(rawDuration) ? Math.max(0, Math.min(3600, Math.round(rawDuration))) : 0;
  if (!isSupportedQuery({ title, artist })) return NextResponse.json({ error: 'Нужны название и исполнитель.' }, { status: 400 });

  try {
    const response = await fetch(lyricsUrl({ title, artist, duration, album }), {
      // LRCLIB просит узнать приложение и не ставит CORS-заголовки — отсюда и прокси.
      headers: { accept: 'application/json', 'user-agent': 'Nocturne (music player; +https://nocturne-music-player-chi.vercel.app)' },
      signal: AbortSignal.timeout(4000),
      redirect: 'error',
      cache: 'default',
    });
    if (!response.ok) return empty('unavailable');
    const raw = await response.text();
    if (raw.length > 400_000) return empty('too-large');
    const lyrics = chooseLyrics(JSON.parse(raw), { title, artist });
    if (lyrics.source === 'none') return empty('not-found');
    return NextResponse.json(
      { ...lyrics, plain: lyrics.plain.slice(0, 40_000), synced: lyrics.synced.slice(0, 900) },
      cached(lyrics.synced.length ? 86_400 : 6 * 3600),
    );
  } catch {
    return empty('timeout');
  }
}
