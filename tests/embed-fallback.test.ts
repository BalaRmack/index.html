import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  EMBED_CACHE_KEY,
  createEmbedFallback,
  dropEmbedSubstitute,
  embedErrorMessage,
  embedFallbackQueries,
  embedSubstituteFor,
  failEmbedSubstitute,
  isBlockedEmbedCode,
  pickEmbedCandidates,
  readEmbedCache,
  rememberEmbedSubstitute,
  type EmbedCache,
  type EmbedCacheEntry,
  type EmbedCandidate,
} from '../lib/embed-fallback';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function memoryStore(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => { data[key] = value; },
  };
}

const video = (id: string, title: string, artist = 'Rick Astley', duration = 213) => ({ id: `yt:${id}`, video_id: id, title, artist, duration });

test('blocked-embed codes are recognised and keep their own messages', () => {
  assert.equal(isBlockedEmbedCode(101), true);
  assert.equal(isBlockedEmbedCode(150), true);
  assert.equal(isBlockedEmbedCode(100), true);
  assert.equal(isBlockedEmbedCode(2), false);
  assert.equal(isBlockedEmbedCode(undefined), false);
  assert.match(embedErrorMessage(150), /Автор запретил встроенное воспроизведение/);
  assert.match(embedErrorMessage(100), /ошибк|закрыто/i);
  assert.match(embedErrorMessage(5), /не смог воспроизвести/);
});

test('three fallback queries: audio, lyrics, Topic — deduped and short enough for the search API', () => {
  assert.deepEqual(
    embedFallbackQueries({ title: 'Never Gonna Give You Up', artist: 'Rick Astley' }),
    [
      'Rick Astley - Never Gonna Give You Up audio',
      'Rick Astley Never Gonna Give You Up lyrics',
      'Rick Astley Never Gonna Give You Up Topic',
    ],
  );
  // Без исполнителя «Topic» бессмысленен — берём official audio вторым вариантом.
  assert.deepEqual(embedFallbackQueries({ title: 'Bohemian Rhapsody' }), ['Bohemian Rhapsody lyrics', 'Bohemian Rhapsody official audio']);
  // Лишние пробелы и переносы не должны уезжать в запрос.
  assert.deepEqual(embedFallbackQueries({ title: 'A\n  B', artist: ' C ' })[0], 'C - A B audio');
  // Запрос длиннее 120 символов /api/catalog/search отвергнет бы — режем сами.
  const long = embedFallbackQueries({ title: 'x'.repeat(200), artist: 'y'.repeat(120) });
  assert.equal(long.length, 3);
  for (const query of long) assert.ok(query.length <= 120, `слишком длинный запрос: ${query.length}`);
  assert.equal(embedFallbackQueries({ title: 'Track', artist: 'Artist' }, 1).length, 1);
});

test('candidates skip the blocked video, the user blacklist and unrelated results', () => {
  const payload = {
    tracks: [
      video('AAAAAAAAAAA', 'Rick Astley - Never Gonna Give You Up (official video)'),
      video('BBBBBBBBBBB', 'Rick Astley - Never Gonna Give You Up (audio)'),
      video('CCCCCCCCCCC', 'Rick Astley - Never Gonna Give You Up Lyrics Video', 'Rick Astley', 205),
      video('DDDDDDDDDDD', 'Rick Astley - Crying Is Not For Me', 'Rick Astley', 60),
      video('EEEEEEEEEEE', 'Someone Else - Never Gonna Give You Up', 'Someone Else', 213),
      { id: 'yt:bad', video_id: 'bad', title: 'короткий id' },
      { id: 'yt:FFFFFFFFFFF', video_id: 'FFFFFFFFFFF', title: '' },
      video('BBBBBBBBBBB', 'дубликат того же ролика'),
    ],
  };
  const picked = pickEmbedCandidates(payload, {
    title: 'Never Gonna Give You Up', artist: 'Rick Astley', duration: 213,
    exclude: ['AAAAAAAAAAA', 'EEEEEEEEEEE'], limit: 3,
  });
  // Официальный клип («official video») уходит в конец: именно он и даёт 101.
  assert.deepEqual(picked.map((x) => x.video_id), ['BBBBBBBBBBB', 'CCCCCCCCCCC', 'DDDDDDDDDDD']);
  // Дубликат и исходный ролик не предлагем, чужую песню того же исполнителя — тоже.
  assert.ok(!picked.some((x) => x.video_id === 'AAAAAAAAAAA'));
  assert.ok(!picked.some((x) => x.video_id === 'EEEEEEEEEEE'));
  assert.ok(picked[2].title.includes('Crying'), 'другая песня того же исполнителя — только в конце списка');
  // Массив вместо { tracks } — тоже валидный ответ зеркала.
  assert.equal(pickEmbedCandidates([video('GGGGGGGGGGG', 'Rick Astley Never Gonna Give You Up audio')], { title: 'Never Gonna Give You Up', artist: 'Rick Astley' })[0].video_id, 'GGGGGGGGGGG');
  assert.deepEqual(pickEmbedCandidates(null, { title: 'x' }), []);
  assert.deepEqual(pickEmbedCandidates({ nope: 1 }, {}), []);
});

test('a working substitute survives a reload, and two failures retire it', () => {
  const store = memoryStore();
  let cache: EmbedCache = {};
  const candidate: EmbedCandidate = { video_id: 'BBBBBBBBBBB', title: 'Rick Astley - Never Gonna Give You Up (audio)', artist: 'Rick Astley', duration: 213 };
  cache = rememberEmbedSubstitute(cache, 'AAAAAAAAAAA', candidate, store);
  assert.equal(embedSubstituteFor(cache, 'AAAAAAAAAAA')?.video_id, 'BBBBBBBBBBB');
  assert.deepEqual(readEmbedCache(store), cache);
  assert.ok(store.data[EMBED_CACHE_KEY].includes('BBBBBBBBBBB'));
  // Первый промах — только предупреждение, второй — запись уходит совсем вместе из localStorage.
  cache = failEmbedSubstitute(cache, 'AAAAAAAAAAA', store);
  assert.equal(embedSubstituteFor(cache, 'AAAAAAAAAAA')?.video_id, 'BBBBBBBBBBB');
  cache = failEmbedSubstitute(cache, 'AAAAAAAAAAA', store);
  assert.equal(embedSubstituteFor(cache, 'AAAAAAAAAAA'), null);
  assert.deepEqual(JSON.parse(store.data[EMBED_CACHE_KEY]), {});
  // Оригинал не может быть сам себе заменой, мусор в хранилище — не причина падать.
  assert.equal(rememberEmbedSubstitute(cache, 'AAAAAAAAAAA', { ...candidate, video_id: 'AAAAAAAAAAA' }, store), cache);
  const broken = memoryStore({ [EMBED_CACHE_KEY]: '{not json' });
  assert.deepEqual(readEmbedCache(broken), {});
  assert.deepEqual(readEmbedCache({ getItem: () => '[1,2]', setItem: () => { } }), {});
  assert.deepEqual(readEmbedCache(null), {});
  // Протухшая запись не используется.
  const stale: EmbedCache = { AAAAAAAAAAA: { video_id: 'BBBBBBBBBBB', title: 'x', artist: 'y', at: Date.now() - 31 * 24 * 3600 * 1000, fails: 0 } };
  assert.equal(embedSubstituteFor(stale, 'AAAAAAAAAAA'), null);
  assert.equal(embedSubstituteFor({}, 'missing'), null);
  assert.equal(embedSubstituteFor({}, null), null);
  const entry: EmbedCacheEntry = { video_id: 'BBBBBBBBBBB', title: 'x', artist: 'y', at: Date.now(), fails: 0 };
  assert.equal(embedSubstituteFor(dropEmbedSubstitute({ AAAAAAAAAAA: entry }, 'AAAAAAAAAAA', store), 'AAAAAAAAAAA'), null);
});

test('101 from the player starts a silent retry and caches the video that worked', async () => {
  const store = memoryStore();
  const queries: string[] = [];
  const loads: string[] = [];
  const remembered: string[] = [];
  let cache: EmbedCache = {};
  let exhausted = 0;
  const fallback = createEmbedFallback({
    waitMs: 60,
    search: async (query) => { queries.push(query); return { tracks: [video('CCCCCCCCCCC', 'Rick Astley - Never Gonna Give You Up (lyrics)'), video('BBBBBBBBBBB', 'Rick Astley - Never Gonna Give You Up (audio)')] }; },
    load: (id) => { loads.push(id); },
    resolve: (id) => embedSubstituteFor(cache, id),
    remember: (blocked, candidate) => { remembered.push(`${blocked}->${candidate.video_id}`); cache = rememberEmbedSubstitute(cache, blocked, candidate, store); },
    invalidate: () => { },
    onExhausted: () => { exhausted += 1; },
  });
  const track = { video_id: 'AAAAAAAAAAA', title: 'Never Gonna Give You Up', artist: 'Rick Astley', duration: 213 };
  assert.equal(fallback.begin(track), 'AAAAAAAAAAA');
  assert.equal(fallback.error(101), true, 'заблокированное встраивание забираем себе');
  assert.equal(fallback.error(5), false, 'обычная ошибка остаётся на совести страницы');
  await flush();
  assert.deepEqual(queries, ['Rick Astley - Never Gonna Give You Up audio']);
  assert.deepEqual(loads, ['CCCCCCCCCCC']);
  assert.equal(fallback.isRetrying(), true);
  assert.equal(exhausted, 0, 'пользователь пока не видит ничего');
  // Тот же трек заиграл — значит вариант подходит: запоминаем надолго.
  fallback.playing();
  assert.deepEqual(remembered, ['AAAAAAAAAAA->CCCCCCCCCCC']);
  assert.equal(fallback.isRetrying(), false);
  // Повторный старт — мгновенно с заменой и без единого запроса к каталогу.
  queries.length = 0;
  assert.equal(fallback.begin(track), 'CCCCCCCCCCC');
  assert.deepEqual(queries, []);
  assert.deepEqual(JSON.parse(store.data[EMBED_CACHE_KEY]).AAAAAAAAAAA.video_id, 'CCCCCCCCCCC');
  fallback.cancel();
});

test('three blocked variants in a row mean one short notice and the next track', async () => {
  const loads: string[] = [];
  const queries: string[] = [];
  let exhausted: string | null = null;
  const candidates = [video('BBBBBBBBBBB', 'audio'), video('CCCCCCCCCCC', 'lyrics'), video('DDDDDDDDDDD', 'Topic'), video('EEEEEEEEEEE', 'extra')];
  const fallback = createEmbedFallback({
    waitMs: 60,
    search: async (query) => { queries.push(query); return { tracks: candidates }; },
    load: (id) => { loads.push(id); },
    resolve: () => null,
    remember: () => assert.fail('несыгравшего кандидата помнить нельзя'),
    invalidate: () => { },
    onExhausted: (track) => { exhausted = track.title; },
  });
  fallback.begin({ video_id: 'AAAAAAAAAAA', title: 'Never Gonna Give You Up', artist: 'Rick Astley' });
  fallback.error(150);
  await flush();
  assert.deepEqual(loads, ['BBBBBBBBBBB']);
  // Каждый кандидат умер — тишина, никакого сообщения пользователю.
  fallback.error(150);
  await flush();
  fallback.error(150);
  await flush();
  assert.deepEqual(queries, ['Rick Astley - Never Gonna Give You Up audio'], 'кандидаты одного запроса съедаются до следующего запроса');
  fallback.error(150);
  await flush();
  assert.equal(loads.length, 3, 'не больше трёх проб после оригинала');
  assert.deepEqual(loads, ['BBBBBBBBBBB', 'CCCCCCCCCCC', 'DDDDDDDDDDD']);
  assert.equal(exhausted, 'Never Gonna Give You Up');
  // После сдачи машина забывает трек: новый onError уже ничего не меняет.
  assert.equal(fallback.error(150), false);
});

test('a candidate that never reports back is dropped on the timeout', async () => {
  const loads: string[] = [];
  let exhausted = 0;
  const fallback = createEmbedFallback({
    waitMs: 60,
    search: async () => ({ tracks: [video('BBBBBBBBBBB', 'Singer - Song audio'), video('CCCCCCCCCCC', 'Singer - Song live')] }),
    load: (id) => { loads.push(id); },
    resolve: () => null,
    remember: () => { },
    invalidate: () => { },
    onExhausted: () => { exhausted += 1; },
  });
  fallback.begin({ video_id: 'AAAAAAAAAAA', title: 'Song', artist: 'Singer' });
  fallback.error(100);
  await flush();
  assert.deepEqual(loads, ['BBBBBBBBBBB']);
  // Ни playing, ни onError: iframe молчит — сами уходим к следующему.
  await new Promise((resolve) => setTimeout(resolve, 140));
  assert.deepEqual(loads, ['BBBBBBBBBBB', 'CCCCCCCCCCC']);
  await new Promise((resolve) => setTimeout(resolve, 140));
  assert.equal(loads.length, 2, 'новых кандидатов нет — исчерпаны запросы');
  assert.equal(exhausted, 1);
});

test('a remembered substitute that stops working is reported and replaced', async () => {
  const invalidated: string[] = [];
  const loads: string[] = [];
  const fallback = createEmbedFallback({
    waitMs: 60,
    search: async () => ({ tracks: [video('DDDDDDDDDDD', 'Rick Astley - Never Gonna Give You Up Topic')] }),
    load: (id) => { loads.push(id); },
    // Кэш знает замену, но она больше не играет.
    resolve: (id) => (id === 'AAAAAAAAAAA' ? { video_id: 'BBBBBBBBBBB', title: 'stale', artist: 'Rick Astley', at: Date.now(), fails: 0 } : null),
    remember: () => { },
    invalidate: (blocked) => { invalidated.push(blocked); },
    onExhausted: () => { },
  });
  assert.equal(fallback.begin({ video_id: 'AAAAAAAAAAA', title: 'Never Gonna Give You Up', artist: 'Rick Astley' }), 'BBBBBBBBBBB');
  assert.equal(fallback.error(101), true);
  await flush();
  assert.deepEqual(invalidated, ['AAAAAAAAAAA'], 'доверие к кэшу теряется сразу');
  assert.deepEqual(loads, ['DDDDDDDDDDD'], 'и ищем свежий вариант');
  // Чужой трек (SoundCloud/локальный) машину не касается.
  assert.equal(fallback.begin({ video_id: null, title: 'Local', artist: 'Me' }), null);
  assert.equal(fallback.error(101), false);
});

test('a hung mirror cannot keep the player in loading forever', async () => {
  const queries: string[] = [];
  const loads: string[] = [];
  let exhausted = 0;
  const fallback = createEmbedFallback({
    waitMs: 60,
    budgetMs: 120,
    // Медленное, но живое зеркало: каждый ответ приходит через полбюджета.
    search: async (query) => { queries.push(query); await new Promise((resolve) => setTimeout(resolve, 80)); return { tracks: [video('BBBBBBBBBBB', 'Singer - Song audio')] }; },
    load: (id) => { loads.push(id); },
    resolve: () => null,
    remember: () => { },
    invalidate: () => { },
    onExhausted: () => { exhausted += 1; },
  });
  fallback.begin({ video_id: 'AAAAAAAAAAA', title: 'Song', artist: 'Singer' });
  fallback.error(101);
  await new Promise((resolve) => setTimeout(resolve, 320));
  assert.equal(loads.length, 1, 'первый же кандидат загружается');
  assert.ok(queries.length <= 2, `поиск не должен тянуться вечно: ${queries.length} запросов`);
  assert.equal(exhausted, 1);
});

test('switching tracks cancels the retry loop before a late answer can hijack the player', async () => {
  const loads: string[] = [];
  let exhausted = 0;
  const fallback = createEmbedFallback({
    waitMs: 60,
    search: async () => { await new Promise((resolve) => setTimeout(resolve, 20)); return { tracks: [video('BBBBBBBBBBB', 'Other Artist - Next song audio')] }; },
    load: (id) => { loads.push(id); },
    resolve: () => null,
    remember: () => { },
    invalidate: () => { },
    onExhausted: () => { exhausted += 1; },
  });
  fallback.begin({ video_id: 'AAAAAAAAAAA', title: 'Next song', artist: 'Other Artist' });
  fallback.error(101);
  fallback.cancel();
  fallback.begin({ video_id: 'ZZZZZZZZZZZ', title: 'Next song', artist: 'Other' });
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.deepEqual(loads, [], 'опоздавший ответ не должен ничего загрузить');
  assert.equal(exhausted, 0);
});
