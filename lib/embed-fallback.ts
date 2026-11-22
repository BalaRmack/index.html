/**
 * Обход блокировки встраивания на YouTube.
 *
 * У официального клипа правообладатель может запрещать embed: IFrame API тогда отдаёт
 * 101/150 (иногда 100 — «видео удалено/закрыто»), и плеер молчит или показывает ошибку.
 * Здесь чистая логика: какие коды считать блокировкой, как искать разрешённую версию того же
 * трека, как выбирать кандидатов и как хранить рабочий videoId. React-обвязка — в app/page.tsx,
 * потому что «заиграло или нет» знает только плеер.
 */
/** Тот же формат, что и в lib/catalog.ts; держим локально — модуль живёт в клиентском бандле. */
const VALID_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export const isVideoId = (id: string) => VALID_VIDEO_ID.test(id);

/** 101/150 — «запрещено встраивание», 100 — видео не найдено/закрыто: тоже пробуем замену. */
export const BLOCKED_EMBED_CODES = [100, 101, 150] as const;
export const MAX_EMBED_ATTEMPTS = 3;
/** Сколько ждём, пока кандидат реально заработает: onError может не прийти вовсе. */
export const EMBED_ATTEMPT_TIMEOUT_MS = 7000;
/** Пока идёт обход, пользователь видит загрузку — дольше этого смысла нет: сдаёмся и переключаем. */
export const EMBED_FALLBACK_BUDGET_MS = 12000;
/** Рабочая замена живёт месяц, затем трек снова пробуется оригиналом. */
export const EMBED_CACHE_TTL_MS = 30 * 24 * 3600 * 1000;
export const EMBED_CACHE_LIMIT = 200;
export const EMBED_CACHE_KEY = 'nocturne.embed-versions.v1';
/** После двух неудач доверие к сохранённой замене теряется (правообладатель мог всё закрыть). */
export const EMBED_CACHE_MAX_FAILS = 2;

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const clean = (value: string) => value.replace(/\s+/g, ' ').trim();

export function isBlockedEmbedCode(code: unknown): boolean {
  return typeof code === 'number' && (BLOCKED_EMBED_CODES as readonly number[]).includes(code);
}

export function embedErrorMessage(code: number): string {
  if (code === 101 || code === 150) return 'Автор запретил встроенное воспроизведение. Выберите другой трек.';
  if (code === 100) return 'Видео удалено или закрыто для встраивания. Выберите другой трек.';
  if (code === 2) return 'YouTube отклонил идентификатор видео.';
  if (code === 5) return 'YouTube не смог воспроизвести это видео.';
  return `YouTube не смог воспроизвести видео (ошибка ${code}).`;
}

/**
 * Три формулировки запроса — у разрешённых версий разное название: «- Topic» у Audio-канала,
 * «lyrics video» у лейбла, plain «audio» для остальных. Пробелы и переносы в названии режем,
 * длина ограничена тем же, что принимает /api/catalog/search (2…120).
 */
/**
 * Формулировки запроса: у разрешённой версии обычно другое название — «- Topic» у Audio-канала,
 * «lyrics video» у лейбла, plain «audio» у всех остальных. Ограничение 2…120 символов диктует
 * /api/catalog/search, поэтому режем заголовок, но пометку («audio»/«lyrics»/«Topic») оставляем
 * целиком — иначе запрос превращается в «просто длинное название» и ищет опять клип.
 */
export const SEARCH_QUERY_LIMIT = 120;

export function embedFallbackQueries(track: { title: string; artist?: string }, limit = MAX_EMBED_ATTEMPTS): string[] {
  const title = clean(text(track.title, 160));
  const artist = clean(text(track.artist, 100));
  const seen = new Set<string>();
  const queries: string[] = [];
  const push = (head: string, marker: string) => {
    const suffix = ` ${marker}`;
    let body = clean(head);
    if (!body) return;
    if (body.length + suffix.length > SEARCH_QUERY_LIMIT) body = clean(body.slice(0, SEARCH_QUERY_LIMIT - suffix.length));
    const query = clean(body + suffix);
    if (query.length < 3 || query.length > SEARCH_QUERY_LIMIT) return;
    const key = query.toLocaleLowerCase('ru');
    if (seen.has(key)) return;
    seen.add(key);
    queries.push(query);
  };
  const named = artist ? `${artist} - ${title}` : title;
  const spaced = artist ? `${artist} ${title}` : title;
  if (artist) push(named, 'audio');
  push(spaced, 'lyrics');
  if (artist) push(spaced, 'Topic');
  else push(title, 'official audio');
  return queries.slice(0, Math.max(1, limit));
}

export type EmbedCandidate = { video_id: string; title: string; artist: string; duration: number };

/** Заголовки «аудио/lyrics/Topic» обычно и разрешены; «official video» почти всегда и есть причина 101. */
const markerScore = (title: string) => (/(?:\blyrics?\b|\baudio\b|\btopic\b|visualiz)/i.test(title) ? 1 : 0) - (/(?:official video|official clip|\bvevo\b|full album|reaction|karaoke)/i.test(title) ? 2 : 0);

/**
 * Кандидаты из ответа поиска: не тот же ролик, не заблокированный пользователем, без дублей.
 * Порядок — как в выдаче, но внутри одного запроса предпочитаем заведомо «аудио/lyrics/Topic»
 * и длительность, близкую к оригиналу (0 если она неизвестна).
 */
export function pickEmbedCandidates(payload: unknown, options: { title?: string; artist?: string; duration?: number; exclude?: string[]; limit?: number } = {}): EmbedCandidate[] {
  const raw = Array.isArray(payload) ? payload : (payload && typeof payload === 'object' ? (payload as { tracks?: unknown }).tracks : undefined);
  const items = Array.isArray(raw) ? raw : [];
  const wanted = clean(text(options.title, 160)).toLocaleLowerCase('ru');
  const artist = clean(text(options.artist, 100)).toLocaleLowerCase('ru');
  const exclude = new Set((options.exclude ?? []).filter(Boolean));
  const seen = new Set<string>();
  const scored: { item: EmbedCandidate; score: number }[] = [];
  for (const entry of items.slice(0, 40)) {
    const row = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    const videoId = text(row.video_id, 20) || (text(row.id, 40).startsWith('yt:') ? text(row.id, 40).slice(3) : '');
    if (!isVideoId(videoId) || exclude.has(videoId) || seen.has(videoId)) continue;
    const title = text(row.title, 300);
    if (!title) continue;
    const lower = title.toLocaleLowerCase('ru');
    const duration = Number(row.duration ?? row.lengthSeconds ?? 0);
    const safeDuration = Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 0;
    // Длительность — не основание отвергать: live-версии короче студии на десятки секунд.
    const near = options.duration && safeDuration ? (Math.abs(safeDuration - options.duration) <= Math.max(45, options.duration * 0.35) ? 1 : -1) : 0;
    const nameMatch = wanted ? (lower.includes(wanted) ? 1 : 0) : 1;
    const artistMatch = artist ? (lower.includes(artist) || text(row.artist, 200).toLocaleLowerCase('ru').includes(artist) ? 1 : -1) : 0;
    // Мусор отсеиваем только явный: ни названия, ни исполнителя, ни длительности — это не тот трек.
    if (nameMatch === 0 && artistMatch === -1 && near === -1) continue;
    seen.add(videoId);
    scored.push({ item: { video_id: videoId, title, artist: text(row.artist, 200) || text(options.artist, 200), duration: safeDuration }, score: nameMatch * 2 + artistMatch + markerScore(title) + near });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, options.limit ?? MAX_EMBED_ATTEMPTS))
    .map((entry) => entry.item);
}

export type EmbedCacheEntry = { video_id: string; title: string; artist: string; at: number; fails: number };
export type EmbedCache = Record<string, EmbedCacheEntry>;
export type EmbedStore = { getItem(key: string): string | null; setItem(key: string, value: string): void };

const sane = (value: unknown): value is EmbedCacheEntry => {
  const row = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return typeof row.video_id === 'string' && isVideoId(row.video_id) && typeof row.title === 'string' && typeof row.at === 'number';
};

export function readEmbedCache(store?: EmbedStore | null): EmbedCache {
  if (!store) return {};
  try {
    const parsed = JSON.parse(store.getItem(EMBED_CACHE_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: EmbedCache = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!sane(value)) continue;
      out[key.slice(0, 80)] = { video_id: value.video_id, title: value.title, artist: value.artist, at: Number(value.at) || 0, fails: Number(value.fails) || 0 };
    }
    return out;
  } catch { return {}; }
}

function writeEmbedCache(cache: EmbedCache, store?: EmbedStore | null): EmbedCache {
  if (!store) return cache;
  const entries = Object.entries(cache).sort((a, b) => b[1].at - a[1].at).slice(0, EMBED_CACHE_LIMIT);
  try { store.setItem(EMBED_CACHE_KEY, JSON.stringify(Object.fromEntries(entries))); } catch { /* приватный режим: кэш просто не работает */ }
  return Object.fromEntries(entries);
}

/** Свежая и ещё не опровергнутая замена для этого ролика. */
export function embedSubstituteFor(cache: EmbedCache, videoId: string | null | undefined, now = Date.now()): EmbedCacheEntry | null {
  if (!videoId) return null;
  const entry = cache[videoId];
  if (!entry || entry.fails >= EMBED_CACHE_MAX_FAILS) return null;
  if (!(entry.at > 0) || now - entry.at > EMBED_CACHE_TTL_MS) return null;
  if (entry.video_id === videoId) return null; // курьёз: «замена» равна оригиналу
  return entry;
}

export function rememberEmbedSubstitute(cache: EmbedCache, blockedVideoId: string, candidate: EmbedCandidate, store?: EmbedStore | null, now = Date.now()): EmbedCache {
  if (!isVideoId(blockedVideoId) || !isVideoId(candidate.video_id) || blockedVideoId === candidate.video_id) return cache;
  const next: EmbedCache = { ...cache, [blockedVideoId]: { video_id: candidate.video_id, title: candidate.title.slice(0, 300), artist: candidate.artist.slice(0, 200), at: now, fails: 0 } };
  return writeEmbedCache(next, store);
}

export function dropEmbedSubstitute(cache: EmbedCache, blockedVideoId: string, store?: EmbedStore | null): EmbedCache {
  if (!(blockedVideoId in cache)) return cache;
  const next = { ...cache };
  delete next[blockedVideoId];
  return writeEmbedCache(next, store);
}

/** Неудача не затирает запись молча: на второй раз она удаляется. */
export function failEmbedSubstitute(cache: EmbedCache, blockedVideoId: string, store?: EmbedStore | null): EmbedCache {
  const entry = cache[blockedVideoId];
  if (!entry) return cache;
  if (entry.fails + 1 >= EMBED_CACHE_MAX_FAILS) return dropEmbedSubstitute(cache, blockedVideoId, store);
  return writeEmbedCache({ ...cache, [blockedVideoId]: { ...entry, fails: entry.fails + 1 } }, store);
}

/** Трек, ради которого затевается обход: метаданные, а не весь Track — плееру хватит и этого. */
export type EmbedTrack = { video_id?: string | null; title: string; artist?: string; duration?: number | null };

export type EmbedFallbackDeps = {
  /** /api/catalog/search: строка запроса → ответ зеркала (массив или { tracks }). */
  search: (query: string) => Promise<unknown>;
  /** Перезапустить тот же слот плеера на другом видео. */
  load: (videoId: string) => void;
  /** Закэшированная замена для этого видео (или null, если играем оригинал). */
  resolve: (videoId: string) => EmbedCacheEntry | null;
  /** Замена подтверждена — сохранить, чтобы повторный старт был мгновенным. */
  remember: (blockedVideoId: string, candidate: EmbedCandidate) => void;
  /** Подтверждённая замена в этот раз не сыграла — сбросить доверие к ней. */
  invalidate: (blockedVideoId: string) => void;
  /** Все три варианта тоже закрыты: показать короткий notice и уйти на следующий трек. */
  onExhausted: (track: EmbedTrack) => void;
  waitMs?: number;
  maxAttempts?: number;
  /** Общий бюджет одного раунда проб: медленные зеркала не должны держать загрузку вечно. */
  budgetMs?: number;
};

export type EmbedFallback = {
  /** Чем играть это видео: закэшированная замена, если она есть и ещё не опровергнута. */
  playbackId: (videoId?: string | null) => string | null;
  /** Начать игру треком: возвращает videoId, которым нужно играть (замена из кэша или оригинал). */
  begin: (track: EmbedTrack) => string | null;
  /** onError из плеера. true — случай взят на обработку, сообщение показывать не надо. */
  error: (code: number) => boolean;
  /** Плеер сообщил «playing»: кандидат признан рабочим. */
  playing: () => void;
  cancel: () => void;
  /** Прямо сейчас в фоне грузится кандидат. */
  isRetrying: () => boolean;
};

/**
 * Машина обхода: «упало → ищем → грузим → playing подтверждает / таймаут и onError опровергают».
 * Всё молча, до трёх вариантов; наружу только два сигнала — load() и onExhausted().
 */
export function createEmbedFallback(deps: EmbedFallbackDeps): EmbedFallback {
  const waitMs = Math.max(50, deps.waitMs ?? EMBED_ATTEMPT_TIMEOUT_MS);
  const maxAttempts = Math.max(1, deps.maxAttempts ?? MAX_EMBED_ATTEMPTS);
  const budgetMs = Math.max(waitMs, deps.budgetMs ?? EMBED_FALLBACK_BUDGET_MS);
  type Session = {
    track: EmbedTrack; blocked: string; queries: string[]; queryAt: number; tried: string[]; played: string;
    pending: EmbedCandidate[]; fromCache: boolean; candidate: EmbedCandidate | null; attempts: number;
    deadline: number; timer: ReturnType<typeof setTimeout> | null;
  };
  let session: Session | null = null;
  /** Растёт при любой смене трека/отмене: опоздавший ответ поиска не должен ничего загрузить. */
  let epoch = 0;

  const clearTimer = (state: Session) => { if (state.timer !== null) { clearTimeout(state.timer); state.timer = null; } };

  function exhausted(state: Session) {
    epoch += 1;
    clearTimer(state);
    session = null;
    deps.onExhausted(state.track);
  }

  /** Загрузить кандидата и завести таймаут: «либо заиграет, либо идём дальше сами». */
  function deploy(state: Session, candidate: EmbedCandidate) {
    state.attempts += 1;
    state.tried.push(candidate.video_id);
    state.candidate = candidate;
    state.played = candidate.video_id;
    state.fromCache = false;
    deps.load(candidate.video_id);
    clearTimer(state);
    // onError приходит не всегда (iframe умеет просто молчать) — ждём сами.
    state.timer = setTimeout(() => { state.timer = null; state.candidate = null; void advance(state); }, waitMs);
  }

  async function advance(state: Session) {
    const my = epoch;
    const alive = () => session === state && my === epoch;
    // Сначала съедаем кандидатов из последнего найденного запроса, и только потом новый запрос.
    for (;;) {
      if (state.attempts >= maxAttempts) break;
      const next = state.pending.find((x) => !state.tried.includes(x.video_id));
      if (next) {
        state.pending = state.pending.filter((x) => x !== next);
        if (alive()) deploy(state, next);
        return;
      }
      if (state.queryAt >= state.queries.length) break;
      // Бюджет ограничен на случай зависшего зеркала; готовых кандидатов это не касается — load() дёшев.
      if (Date.now() > state.deadline) break;
      const query = state.queries[state.queryAt];
      state.queryAt += 1;
      let payload: unknown = null;
      try { payload = await deps.search(query); } catch { payload = null; }
      if (!alive()) return;
      const duration = Number(state.track.duration);
      const found = pickEmbedCandidates(payload, {
        title: state.track.title, artist: state.track.artist,
        duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
        exclude: state.tried, limit: maxAttempts,
      });
      state.pending = found;
    }
    if (alive()) exhausted(state);
  }

  return {
    begin(track) {
      epoch += 1;
      if (session) clearTimer(session);
      session = null;
      if (!track.video_id) return null;
      const substitute = deps.resolve(track.video_id);
      const blocked = track.video_id;
      const state: Session = {
        track, blocked, queries: embedFallbackQueries(track, maxAttempts), queryAt: 0, tried: [blocked], pending: [],
        played: substitute ? substitute.video_id : blocked, fromCache: Boolean(substitute), candidate: null, attempts: 0,
        deadline: 0, timer: null,
      };
      session = state;
      return state.played;
    },
    playbackId(videoId) { return videoId ? (deps.resolve(videoId)?.video_id || videoId) : null; },
    error(code) {
      const state = session;
      if (!state || !isBlockedEmbedCode(code)) return false;
      clearTimer(state);
      // Каждый новый раунд проб (то есть каждая свежая ошибка) получает свой бюджет.
      if (Date.now() + waitMs > state.deadline) state.deadline = Date.now() + budgetMs;
      if (state.candidate) { state.tried.push(state.candidate.video_id); state.candidate = null; }
      else {
        // Не завёлся оригинал или то, что мы помнили с прошлого раза.
        state.tried.push(state.played);
        if (state.fromCache) deps.invalidate(state.blocked);
      }
      void advance(state);
      return true;
    },
    playing() {
      const state = session;
      if (!state) return;
      const candidate = state.candidate;
      if (!candidate) { state.fromCache = false; return; }
      clearTimer(state);
      state.candidate = null;
      deps.remember(state.blocked, candidate);
      // Дальше играем этой заменой: если её заблокируют в середине — пересоберёмся, но кэш почистим.
      state.tried = [state.blocked, candidate.video_id];
      state.attempts = 0;
      state.fromCache = true;
    },
    cancel() {
      epoch += 1;
      if (session) clearTimer(session);
      session = null;
    },
    isRetrying() { return Boolean(session?.candidate); },
  };
}
