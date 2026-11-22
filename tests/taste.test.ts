import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../app/api/recommendations/route';

const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });

const piped = (id: string, artist: string, title: string) => ({ url: `/watch?v=${id}`, title, uploaderName: artist, uploaderUrl: `/@${artist.replace(/\s/g, '')}`, duration: 214, thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, isVideo: true });
const searchPayload = { items: [piped('abcdefghijk', 'Земфира', 'Искала'), piped('bcdefghijkl', 'Сплин', 'Выхода нет')] };
const request = (body: unknown, mode = 'wave') => new Request(`https://app.test/api/recommendations?mode=${mode}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('wave is seeded from onboarding artists when there is no listening history', async () => {
  const queries: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    const url = new URL(String(input));
    if (url.pathname === '/search' || url.pathname === '/api/v1/search') { queries.push(url.searchParams.get('q') || ''); return new Response(JSON.stringify(searchPayload)); }
    throw Error('зеркало недоступно');
  }) as typeof fetch;
  const response = await POST(request({ seeds: [], played: [], seen: [], taste: { artists: ['Земфира', 'Земфира', '  '], genres: ['pop'] }, blocks: [] }));
  assert.equal(response.status, 200);
  const data = await response.json();
  // Посев взят из выбранного артиста, а не из истории: ответ честно помечен как неперсональный.
  assert.equal(data.tasteSeeded, true);
  assert.equal(data.personalized, false);
  assert.deepEqual(data.providers, ['taste-search']);
  assert.ok(data.tracks.length >= 1);
  assert.ok(queries.some((q) => q.includes('Земфира')), `запрос по любимому артисту должен уйти в каталог: ${JSON.stringify(queries)}`);
  assert.ok(queries.some((q) => q.includes('pop')), `жанр должен уйти в каталог: ${JSON.stringify(queries)}`);
});

test('garbage taste payload is ignored instead of breaking recommendations', async () => {
  globalThis.fetch = (async () => { throw Error('все зеркала недоступны'); }) as typeof fetch;
  const response = await POST(request({ seeds: [], played: [], seen: [], blocks: [], taste: { artists: [42, '', {}, 'x'.repeat(400)], genres: 'pop' } }));
  assert.equal(response.status, 200);
  const data = await response.json();
  // Ни вкуса, ни сети: отдаём редакционный резерв и честно это подписываем.
  assert.equal(data.editorialFallback, true);
  assert.equal(data.tasteSeeded, undefined);
});

test('blocked tracks never come back through the taste seed', async () => {
  globalThis.fetch = (async (input: unknown) => new Response(JSON.stringify(searchPayload))) as typeof fetch;
  const blocks = [{ kind: 'track', track_id: 'yt:abcdefghijk', video_id: 'abcdefghijk', title: 'Искала', artist: 'Земфира' }];
  const response = await POST(request({ seeds: [], played: [], seen: [], taste: { artists: ['Земфира'], genres: [] }, blocks }));
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.ok(!data.tracks.some((t: { video_id: string }) => t.video_id === 'abcdefghijk'));
});

test('home mixes taste artists into the daily shelf on a cold account', async () => {
  const queries: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    const url = new URL(String(input));
    if (url.pathname === '/search' || url.pathname === '/api/v1/search') { queries.push(url.searchParams.get('q') || ''); return new Response(JSON.stringify(searchPayload)); }
    throw Error('зеркало недоступно');
  }) as typeof fetch;
  const response = await POST(request({ seeds: [], played: [], seen: [], blocks: [], taste: { artists: ['Земфира'], genres: ['русский рок'] } }, 'home'));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.ok(queries.some((q) => q.includes('Земфира')), `артист из онбординга должен попасть в запрос: ${JSON.stringify(queries)}`);
  assert.ok(queries.some((q) => q.includes('русский рок')), `жанр из онбординга должен попасть в запрос: ${JSON.stringify(queries)}`);
  assert.ok(Array.isArray(data.daily));
});
