import { searchAlternative, type AlternativeTrack } from './alternatives';
import { searchCatalog, type CatalogTrack } from './catalog';
import { fallbackTracks } from './fallback-tracks';
import { artistKey } from './recommendations';

/**
 * Блок «Откройте что-то новое» обязан показаться.
 * SHELF_TIMEOUT_MS — жёсткий дедлайн всего клиентского запроса: если персональные
 * подборки не ответили за 4 секунды, блок мгновенно заполняется свежими миксами,
 * а состояние загрузки снимается в любом случае.
 */
export const SHELF_TIMEOUT_MS = 4000;
/** Сколько сервер ждёт персональные данные аккаунта и агрегаторы, чтобы успеть ответить до клиентского дедлайна. */
export const ACCOUNT_TIMEOUT_MS = 1200;
export const PERSONAL_TIMEOUT_MS = 2200;
/** deezer/youtube отвечают параллельно с персональными подборками, поэтому ждём их коротко. */
export const MIX_TIMEOUT_MS = 1200;
/** Общий бюджет ответа /api/recommendations?mode=home — заметно меньше клиентского дедлайна. */
export const HOME_BUDGET_MS = 3400;

export type FreshTrack = {
  id: string;
  title: string;
  artist: string;
  storage_path: null;
  source: 'youtube' | 'deezer' | 'jiosaavn';
  video_id?: string | null;
  external_id?: string | null;
  thumbnail: string | null;
  duration: number;
};

export type Shelves = {
  similar: FreshTrack[];
  recent: FreshTrack[];
  daily: FreshTrack[];
  trending: FreshTrack[];
};

/** Никогда не отклоняется: зависевший промис возвращает fallback, а не вешает UI. */
export function withTimeout<T>(promise: PromiseLike<T> | null | undefined, ms: number, fallback: T): Promise<T> {
  if (!promise) return Promise.resolve(fallback);
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => { settled = true; resolve(fallback); }, ms);
    const done = (value: T) => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
    void Promise.resolve(promise).then((value) => done(value ?? fallback), () => done(fallback));
  });
}

export function shuffleTracks<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export type TrackLike = { id: string; title: string; artist: string };

const asTracks = <T extends TrackLike>(items: readonly T[]): T[] =>
  items.filter((item) => typeof item?.title === 'string' && item.title.length > 0);

/** Чередует артистов, чтобы в одной полке не было подряд пяти треков одного исполнителя. */
export function diverseTracks<T extends TrackLike>(items: readonly T[], limit = 16): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  let last = '';
  const pool = asTracks(items);
  while (pool.length && out.length < limit) {
    const index = pool.findIndex((track) => artistKey(track.artist) !== last);
    const [track] = pool.splice(index < 0 ? 0 : index, 1);
    if (!track) break;
    last = artistKey(track.artist);
    if (seen.has(track.id)) continue;
    seen.add(track.id);
    out.push(track);
  }
  return out;
}

/** Популярные русские и зарубежные артисты для «свежих» миксов, когда персональные источники молчат. */
export const RU_ARTISTS = ['Кино', 'Земфира', 'Скриптонит', 'Мумий Тролль', 'Пошлая Молли', 'Zivert', 'АИГЕЛ', 'Дима Билан'] as const;
export const WORLD_ARTISTS = ['The Weeknd', 'Arctic Monkeys', 'Dua Lipa', 'Tame Impala', 'Billie Eilish', 'DVRST', 'Kavinsky', 'Woodkid'] as const;

/** Русские и зарубежные артисты идут вперемешку, чтобы микс не превращался в один чарт. */
export function freshArtists(count = 10): string[] {
  const ru = shuffleTracks(RU_ARTISTS);
  const world = shuffleTracks(WORLD_ARTISTS);
  const mixed: string[] = [];
  for (let i = 0; i < Math.max(ru.length, world.length) && mixed.length < count; i++) {
    if (ru[i]) mixed.push(ru[i]);
    if (world[i]) mixed.push(world[i]);
  }
  return mixed;
}

const toFresh = (track: CatalogTrack | AlternativeTrack): FreshTrack => ({
  ...track,
  source: track.source as FreshTrack['source'],
  video_id: 'video_id' in track ? track.video_id ?? null : null,
  external_id: 'external_id' in track ? track.external_id ?? null : null,
});

/**
 * Живые свежие миксы: для каждого популярного артиста берём треки из Deezer, а если
 * он молчит — поиск по YouTube. Каждый запрос ограничен по времени, а ошибка одного
 * источника не должна ронять всю подборку.
 */
export async function freshArtistMix(limit = 16, timeoutMs = MIX_TIMEOUT_MS): Promise<FreshTrack[]> {
  const artists = freshArtists();
  const perArtist = await Promise.all(artists.map(async (artist): Promise<FreshTrack[]> => {
    const deezer = await withTimeout(
      searchAlternative('deezer', `${artist} hits`).then((tracks) => asTracks(tracks).slice(0, 2).map((track) => ({ ...track, artist: track.artist || artist }))),
      timeoutMs,
      [] as AlternativeTrack[],
    );
    if (deezer.length) return deezer.map(toFresh);
    const youtube = await withTimeout(
      searchCatalog(`${artist} music`).then((result) => asTracks(result.value).slice(0, 2)),
      timeoutMs,
      [] as CatalogTrack[],
    );
    return youtube.map(toFresh);
  }));
  return diverseTracks(shuffleTracks(perArtist.flat()), limit);
}

const asEditorial = (): FreshTrack[] => fallbackTracks.map((track) => ({ ...track, external_id: null }));

/**
 * Аварийный набор для клиента: сеть/API не ответили, поэтому берём проверенную редакционную
 * коллекцию и перемешиваем её. Полки «Недавно слушали» и «Похоже на ваши лайки» остаются
 * пустыми — они по смыслу персональные, врать в них нечем.
 */
export function freshShelves(): Shelves & { editorialFallback: true; freshFallback: true } {
  const pool = shuffleTracks(asEditorial());
  const half = Math.ceil(pool.length / 2);
  return { similar: [], recent: [], daily: pool.slice(0, half), trending: pool.slice(half), editorialFallback: true, freshFallback: true };
}

/** True, если ни на одной полке нет карточек — блок был бы пустым. */
export function shelvesAreEmpty(shelves: Partial<Record<'similar' | 'recent' | 'daily' | 'trending', readonly unknown[]>> | null | undefined) {
  if (!shelves) return true;
  return !(['similar', 'recent', 'daily', 'trending'] as const).some((key) => Array.isArray(shelves[key]) && (shelves[key] as readonly unknown[]).length > 0);
}

/**
 * Заполняет пустые публичные полки свежими треками, не дублируя то, что уже показано.
 * Персональные полки (recent/similar) не трогаем: выдавать редакцию за историю прослушивания нельзя.
 */
export function topUpShelves<T extends TrackLike>(
  shelves: { similar: T[]; recent: T[]; daily: T[]; trending: T[] },
  pool: readonly TrackLike[],
  minPerShelf = 4,
) {
  const used = new Set<string>();
  for (const key of ['trending', 'daily', 'similar', 'recent'] as const) for (const track of shelves[key] ?? []) used.add(track.id);
  const remaining = asTracks(pool).filter((track) => !used.has(track.id)) as T[];
  let offset = 0;
  for (const key of ['trending', 'daily'] as const) {
    const current = shelves[key] ?? [];
    if (current.length >= minPerShelf) continue;
    const take = Math.max(0, Math.min(minPerShelf * 2 - current.length, remaining.length - offset));
    if (take <= 0) continue;
    shelves[key] = [...current, ...remaining.slice(offset, offset + take)];
    offset += take;
  }
  return shelves;
}

export const freshPool = asEditorial;
