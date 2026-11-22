import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { isVideoId, searchCatalog, trendingCatalog, type CatalogTrack } from '@/lib/catalog';
import { fallbackShelves, fallbackTracks } from '@/lib/fallback-tracks';
import { youtubeRadio, deezerRadio } from '@/lib/radio-sources';
import { isBlocked, mergeBlocks, validBlocks, type Block } from '@/lib/blacklist';
import { cleanRecommendations, diverseRecommendations, recentlyPlayed, taste, type Signal } from '@/lib/recommendations';
import { ACCOUNT_TIMEOUT_MS, HOME_BUDGET_MS, PERSONAL_TIMEOUT_MS, freshArtistMix, shelvesAreEmpty, topUpShelves, withTimeout, type FreshTrack } from '@/lib/fresh-picks';

export const dynamic = 'force-dynamic';

/**
 * Блок «Откройте что-то новое» не имеет права зависать.
 * Каждый внешний шаг (Supabase, зеркала, Deezer) ограничен по времени, суммарный бюджет
 * держится заведомо меньше клиентского дедлайна, а пустые полки мгновенно заполняются
 * свежими миксами по популярным русским и зарубежным артистам.
 */
const noStore = { 'Cache-Control': 'no-store' };
const json = (body: unknown, init?: ResponseInit) => NextResponse.json(body, { ...init, headers: { ...noStore, ...(init?.headers || {}) } });

export async function GET(req: Request) { return handle(req); }
export async function POST(req: Request) {
  if (!['wave', 'home', 'radio'].includes(new URL(req.url).searchParams.get('mode') || '')) return json({ error: 'Invalid mode' }, { status: 400 });
  try {
    const raw = await req.text(); if (raw.length > 1_000_000) return json({ error: 'История слишком большая.' }, { status: 413 });
    const body = JSON.parse(raw); const valid = (items: unknown, limit: number): Signal[] => Array.isArray(items) ? items.slice(0, limit).flatMap((s: unknown) => {
      if (!s || typeof s !== 'object') return []; const v = s as Record<string, unknown>;
      if ((v.video_id !== null && (typeof v.video_id !== 'string' || !isVideoId(v.video_id))) || typeof v.artist !== 'string' || !v.artist.trim() || typeof v.title !== 'string' || typeof v.created_at !== 'string' || !Number.isFinite(Date.parse(v.created_at)) || !['listen', 'complete', 'skip', 'like'].includes(String(v.event_type))) return [];
      return [{ track_id: typeof v.video_id === 'string' ? `yt:${v.video_id}` : 'guest', video_id: v.video_id as string | null, title: v.title.slice(0, 300), artist: v.artist.slice(0, 200), event_type: v.event_type as Signal['event_type'], created_at: v.created_at }];
    }) : [];
    const blocks = validBlocks(body.blocks || []); if (!Array.isArray(body.blocks || []) || blocks.length !== (body.blocks || []).length) return json({ error: 'Некорректный чёрный список.' }, { status: 400 });
    // Вкусовые настройки из мастера первоначальной настройки: артисты и жанры питают волну и «Микс дня».
    const rawTaste = body.taste && typeof body.taste === 'object' ? body.taste : {};
    const names = (items: unknown, limit: number) => (Array.isArray(items) ? items.filter((x: unknown) => typeof x === 'string' && (x as string).trim().length > 1).map((x: string) => x.trim().slice(0, 60)) : []).slice(0, limit);
    const taste = { artists: [...new Set(names(rawTaste.artists, 6))], genres: [...new Set(names(rawTaste.genres, 8))] };
    return await handle(req, { taste, blocks, seeds: valid(body.seeds, 10).filter(s => s.event_type !== 'skip'), played: valid(body.played, 300).filter(s => s.event_type !== 'like'), skips: valid(body.skips, 100).filter(s => s.event_type === 'skip'), seen: Array.isArray(body.seen) ? body.seen.filter((x: unknown) => typeof x === 'string' && isVideoId(x)).slice(-100) : [] });
  } catch { return json({ error: 'Некорректный запрос волны.' }, { status: 400 }); }
}

const shuffled = <T,>(items: T[]) => { const result = [...items]; for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; } return result; };

type Account = { blocks: Block[]; signals: Signal[]; liked: Signal[]; daySignals: Signal[] };
type AccountFailure = { message: string; status: number };

/**
 * История, лайки и чёрный список читаются одним ограниченным по времени запросом:
 * подвешенный Supabase не должен утягивать ответ подборок за клиентский таймаут.
 */
async function accountData(req: Request, budget: number): Promise<{ account: Account | null; failure: AccountFailure | null }> {
  const token = req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return { account: null, failure: null };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { account: null, failure: { message: 'Authentication unavailable', status: 401 } };
  const db = createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const query = (async (): Promise<Account | null> => {
    const { data: { user }, error } = await db.auth.getUser(token);
    if (error || !user) return null;
    const rows: Block[] = [];
    for (let start = 0; ; start += 1000) {
      const result = await db.from('recommendation_blocks').select('kind,track_id,video_id,title,artist').eq('user_id', user.id).order('kind').order('track_id').range(start, start + 999);
      if (result.error) throw new Error('Не удалось загрузить чёрный список.');
      const batch = validBlocks(result.data); if (batch.length !== result.data.length) throw new Error('Ошибка чёрного списка.');
      rows.push(...batch); if (result.data.length < 1000) break;
    }
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [history, likes, played] = await Promise.all([
      db.from('listening_history').select('track_id,video_id,title,artist,event_type,created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(300),
      db.from('likes').select('created_at, tracks(id,title,artist,video_id)').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50),
      db.from('listening_history').select('track_id,video_id,title,artist,event_type,created_at').eq('user_id', user.id).gte('created_at', since).in('event_type', ['listen', 'complete', 'skip']).order('created_at', { ascending: false }).limit(1000),
    ]);
    if (history.error || likes.error || played.error) throw new Error('Не удалось загрузить историю.');
    const liked = (likes.data || []).flatMap((row: Record<string, any>) => { const t = Array.isArray(row.tracks) ? row.tracks[0] : row.tracks; return t?.video_id ? [{ track_id: t.id, video_id: t.video_id, title: t.title, artist: t.artist, event_type: 'like' as const, created_at: row.created_at }] : []; });
    return { blocks: rows, signals: (history.data || []) as Signal[], daySignals: (played.data || []) as Signal[], liked };
  })();
  const outcome = await withTimeout(query.then((account) => ({ account, timedOut: false })), budget, { account: null, timedOut: true });
  if (!outcome.account) return { account: null, failure: { message: outcome.timedOut ? 'Персональные данные не ответили вовремя.' : 'Unauthorized', status: outcome.timedOut ? 503 : 401 } };
  return { account: outcome.account, failure: null };
}

type Taste = { artists: string[]; genres: string[] };

async function handle(req: Request, guest?: { taste?: Taste; blocks: Block[]; seeds: Signal[]; played: Signal[]; skips: Signal[]; seen: string[] }) {
  const params = new URL(req.url).searchParams; const mode = params.get('mode') || 'home';
  if (!['home', 'radio', 'wave'].includes(mode) || (mode === 'wave' && !guest)) return json({ error: 'Invalid mode' }, { status: 400 });
  const startedAt = Date.now();
  /** Сколько времени осталось в общем бюджете подборок (минимум — чтобы не ждать отрицательное число). */
  const left = () => Math.max(50, HOME_BUDGET_MS - (Date.now() - startedAt));
  const seed = params.get('seed') || ''; const artist = (params.get('artist') || '').trim().slice(0, 200);
  if (seed && !isVideoId(seed)) return json({ error: 'Invalid seed' }, { status: 400 });
  const seen = (params.get('seen') || '').split(',').filter(isVideoId).slice(0, 100);
  let signals: Signal[] = [], liked: Signal[] = [], daySignals: Signal[] = [], blocks: Block[] = guest?.blocks || [];
  let personalUnavailable = false;
  const { account, failure } = await accountData(req, mode === 'home' ? Math.min(ACCOUNT_TIMEOUT_MS, left()) : ACCOUNT_TIMEOUT_MS);
  if (account) {
    blocks = mergeBlocks(blocks, account.blocks);
    signals = account.signals; daySignals = account.daySignals; liked = account.liked;
  } else if (failure && mode !== 'home') return json({ error: failure.message }, { status: failure.status });
  // Для главной страницы отсутствие аккаунта — не ошибка, а повод показать свежие подборки.
  else personalUnavailable = true;
  const permitted = <T extends { id: string; video_id?: string | null; title: string; artist: string }>(tracks: T[]) => tracks.filter(t => !isBlocked(t, blocks));
  const allowedSignal = (s: Signal) => !isBlocked({ id: s.track_id, video_id: s.video_id, title: s.title, artist: s.artist }, blocks);
  const editorial = () => ({ ...fallbackShelves(), trending: permitted(fallbackTracks) });
  signals = signals.filter(allowedSignal); liked = liked.filter(allowedSignal);
  const seeds = (guest?.seeds || []).filter(allowedSignal);
  const profile = taste([...signals, ...liked, ...seeds, ...(guest?.skips || [])]), recent = recentlyPlayed([...daySignals, ...(guest?.played || [])]), blocked = new Set([...profile.excluded, ...recent.ids]);
  // Свежие миксы стартуют сразу: к моменту, когда они понадобились, они обычно уже готовы.
  const freshMix: Promise<FreshTrack[]> = mode === 'home' ? freshArtistMix(20).catch(() => [] as FreshTrack[]) : Promise.resolve([] as FreshTrack[]);
  async function sources(id: string, name: string) {
    const [youtube, deezer] = await Promise.allSettled([id ? youtubeRadio(id) : Promise.reject(new Error('Нет видео')), name ? deezerRadio(name) : Promise.reject(new Error('Нет исполнителя'))]);
    const yt = youtube.status === 'fulfilled' ? youtube.value : [], dz = deezer.status === 'fulfilled' ? deezer.value : [];
    // Чередуем провайдеров, чтобы один не захватывал всю очередь.
    const combined: CatalogTrack[] = []; for (let i = 0; i < Math.max(yt.length, dz.length); i++) { if (yt[i]) combined.push(yt[i]); if (dz[i]) combined.push(dz[i]); }
    return { tracks: permitted(combined), providers: [...(yt.length ? ['youtube-radio'] : []), ...(dz.length ? ['deezer-related'] : [])] };
  }
  if (mode === 'wave' && guest) {
    const taste = guest.taste || { artists: [], genres: [] };
    const candidates = [...seeds, ...liked, ...signals].filter(s => s.artist && ['listen', 'complete', 'like'].includes(s.event_type));
    const distinct = candidates.filter((s, i) => candidates.findIndex(x => s.video_id ? x.video_id === s.video_id : x.artist === s.artist) === i).slice(0, 10);
    // Посев из мастера первоначальной настройки: выбранные артисты и жанры превращаем в живой поиск каталога.
    const tasteQueries = [...(taste.artists.length ? [taste.artists[Math.floor(Math.random() * taste.artists.length)]] : []), ...taste.genres.slice(0, 2).map(genre => `${genre} music`)];
    const tasteTracks = tasteQueries.length
      ? withTimeout(Promise.all(tasteQueries.map(query => searchCatalog(query).then(r => r.value.slice(0, 6)).catch(() => [] as CatalogTrack[]))).then(groups => permitted(groups.flat())), PERSONAL_TIMEOUT_MS, [] as CatalogTrack[])
      : Promise.resolve([] as CatalogTrack[]);
    if (distinct.length) {
      const selected = distinct[Math.floor(Math.random() * distinct.length)];
      const result = await sources(selected.video_id || '', selected.artist);
      const fromTaste = result.providers.length ? [] : await tasteTracks;
      // Радио молчит, а вкус задан — не обрываем волну, а продолжаем её каталогом по любимым артистам.
      if (!result.providers.length && !fromTaste.length) return json({ error: 'Источники похожих исполнителей временно недоступны. Попробуйте ещё раз.' }, { status: 503 });
      const pool = result.providers.length ? result.tracks : fromTaste;
      const tracks = diverseRecommendations(shuffled(pool), blocked, [...guest.seen, ...(selected.video_id ? [selected.video_id] : [])], recent.recordings, '', 20);
      return json({ tracks, providers: result.providers.length ? result.providers : ['taste-search'], personalized: true, emptyReason: tracks.length ? null : 'Новых похожих треков пока не найдено.' });
    }
    // Истории нет: сначала вкус из онбординга, затем актуальные чарты региона, и только потом редакционный резерв.
    const fromTaste = await tasteTracks;
    if (fromTaste.length) {
      const tracks = diverseRecommendations(shuffled(fromTaste), blocked, guest.seen, recent.recordings, '', 20);
      return json({ tracks, providers: ['taste-search'], personalized: false, tasteSeeded: true, emptyReason: tracks.length ? null : 'По выбранным интересам пока ничего не нашлось.' });
    }
    const popular = await Promise.race([Promise.all((['RU', 'US'] as const).map(async region => { try { return (await trendingCatalog(region)).value } catch { return [] as CatalogTrack[] } })), new Promise<CatalogTrack[][]>(resolve => setTimeout(() => resolve([[], []]), 5000))]);
    const live = popular.flat(); const tracks = diverseRecommendations(shuffled(permitted(live.length ? live : fallbackTracks)), blocked, guest.seen, recent.recordings, '', 20);
    return json({ tracks, providers: live.length ? ['trending'] : ['editorial-fallback'], personalized: false, editorialFallback: !live.length, emptyReason: tracks.length ? null : 'Новых популярных треков пока не найдено.' });
  }
  if (mode === 'radio') {
    if (!seed) return json({ error: 'Нужен трек для радио.' }, { status: 400 });
    const result = await sources(seed, artist); if (!result.providers.length) return json({ error: 'Источники похожих треков временно недоступны. Попробуйте позже.' }, { status: 503 });
    const tracks = diverseRecommendations(result.tracks, blocked, [...seen, seed], recent.recordings, artist, 20);
    return json({ tracks, providers: result.providers, emptyReason: tracks.length ? null : 'Новых похожих треков пока не найдено.' });
  }
  const top = liked[0] || signals.find(s => s.event_type === 'like' && s.video_id);
  const work = Promise.all([
    top?.video_id ? sources(top.video_id, top.artist) : Promise.resolve({ tracks: [] as CatalogTrack[], providers: [] as string[] }),
    (profile.artists.length || guest?.taste?.artists.length || guest?.taste?.genres.length) ? Promise.all([...new Set([...profile.artists, ...(guest?.taste?.artists || [])])].slice(0, 6)
      .map(async a => { try { return (await searchCatalog(`${a} music`)).value.slice(0, 6) } catch { return [] as CatalogTrack[] } })
      .concat((guest?.taste?.genres || []).map(async g => { try { return (await searchCatalog(g)).value.slice(0, 4) } catch { return [] as CatalogTrack[] } }))).then(xs => xs.flat()) : Promise.resolve([] as CatalogTrack[]),
    ...(['RU', 'US'] as const).map(async region => { try { return { tracks: (await trendingCatalog(region)).value.slice(0, 10), fallback: false } } catch { try { return { tracks: (await searchCatalog(region === 'RU' ? 'популярная русская музыка' : 'popular music hits')).value.slice(0, 10), fallback: true } } catch { return { tracks: [] as CatalogTrack[], fallback: true } } } }),
  ]);
  const result = await withTimeout(work, Math.min(PERSONAL_TIMEOUT_MS, left()), null);
  const mix = permitted(await withTimeout(freshMix, left(), [] as FreshTrack[]));
  // Персонального ответа нет: сначала пробуем живые свежие миксы, затем редакционный резерв.
  const freshOrEditorial = () => json(mix.length ? { ...freshShelvesFrom(mix), personalized: false } : { ...editorial(), personalized: false, personalUnavailable: true });
  if (!result) return freshOrEditorial();
  const [related, daily, ...trends] = result;
  if (!related.tracks.length && !daily.length && !trends.some(x => x.tracks.length)) return freshOrEditorial();
  const recentTracks = profile.recent.map(s => ({ id: `yt:${s.video_id}`, video_id: s.video_id!, title: s.title, artist: s.artist, storage_path: null, source: 'youtube' as const, thumbnail: `https://i.ytimg.com/vi/${s.video_id}/mqdefault.jpg`, duration: 0 }));
  const shelves = {
    similar: diverseRecommendations(related.tracks, blocked, top?.video_id ? [top.video_id] : [], recent.recordings, '', 12),
    recent: cleanRecommendations(permitted(recentTracks), profile.excluded).slice(0, 12),
    daily: diverseRecommendations(shuffled(permitted(daily)), blocked, [], recent.recordings, '', 12),
    trending: diverseRecommendations(shuffled(permitted(trends.flatMap(x => x.tracks))), blocked, [], recent.recordings, '', 16),
  };
  const before = shelves.daily.length + shelves.trending.length;
  // Пустые публичные полки мгновенно дозаполняются свежими миксами (или редакционным резервом).
  topUpShelves(shelves, mix.length ? mix : permitted(fallbackTracks), 4);
  if (shelvesAreEmpty(shelves)) return freshOrEditorial();
  return json({
    ...shelves,
    trendingFallback: trends.some(x => x.fallback),
    editorialFallback: false,
    freshFallback: shelves.daily.length + shelves.trending.length > before,
    similarUnavailable: !!top && !related.providers.length,
    personalized: !!signals.length,
    personalUnavailable,
  });
}

/** Персональные данные недоступны — отдаём свежие миксы, а не пустой блок. */
function freshShelvesFrom(mix: FreshTrack[]) {
  const half = Math.ceil(mix.length / 2);
  return {
    similar: [] as FreshTrack[], recent: [] as FreshTrack[],
    daily: mix.slice(0, half), trending: mix.slice(half),
    trendingFallback: false, editorialFallback: false, freshFallback: true,
    similarUnavailable: false, personalUnavailable: false,
  };
}
