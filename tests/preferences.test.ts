import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PREFERENCES, GENRES, ONBOARDING_ARTISTS, preferencesToProfile, readPreferences, sanitizePreferences, writePreferences, applyPreferences } from '../lib/preferences';
import { deezerRelatedUrl, parseDeezerArtist, parseDeezerSimilar, parseWikipedia, pickDeezerArtist, safePicture, wikipediaUrl } from '../lib/artist-info';
import { JSDOM } from 'jsdom';

test('untrusted settings JSON is clamped to legal values', () => {
  assert.deepEqual(sanitizePreferences(null), DEFAULT_PREFERENCES);
  const junk = sanitizePreferences({
    language: 'klingon', accent: 'violet', glass: 'nope', particles: 'eco',
    crossfade: 99, autoplayWave: 'yes', genres: ['pop', 'pop', 'nope', 5],
    artists: [' Кино ', '', 'Земфира', 42], onboardingCompleted: true,
  });
  assert.equal(junk.language, 'ru');
  assert.equal(junk.accent, 'violet');
  assert.equal(junk.glass, 'full');
  assert.equal(junk.particles, 'eco');
  assert.equal(junk.crossfade, 0);
  assert.equal(junk.autoplayWave, false);
  assert.deepEqual(junk.genres, ['pop']);
  assert.deepEqual(junk.artists, ['Кино', 'Земфира']);
  assert.equal(junk.onboardingCompleted, true);
  assert.equal(sanitizePreferences({ genres: GENRES.map((g) => g.id) }).genres.length, GENRES.length);
  assert.ok(ONBOARDING_ARTISTS.length >= 12);
});

test('preferences round-trip through localStorage and only user settings sync to the profile', () => {
  const dom = new JSDOM('', { url: 'https://example.com' });
  Object.assign(globalThis, { localStorage: dom.window.localStorage });
  assert.equal(readPreferences().accent, 'nocturne');
  assert.equal(writePreferences({ ...DEFAULT_PREFERENCES, accent: 'ice', crossfade: 6 }), true);
  assert.equal(readPreferences().accent, 'ice');
  assert.equal(readPreferences().crossfade, 6);
  localStorage.setItem('nocturne.preferences.v1', '{{{');
  assert.deepEqual(readPreferences(), DEFAULT_PREFERENCES);
  const payload = preferencesToProfile({ ...DEFAULT_PREFERENCES, onboardingCompleted: true, genres: ['lofi'] });
  assert.equal('onboardingCompleted' in payload, false);
  assert.deepEqual(payload.genres, ['lofi']);
  dom.window.close();
});

test('theme is applied through CSS variables and data attributes only', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.com' });
  Object.assign(globalThis, { document: dom.window.document });
  applyPreferences({ ...DEFAULT_PREFERENCES, accent: 'amber', sidebar: 'compact', playerStyle: 'floating', language: 'en' });
  const root = dom.window.document.documentElement;
  assert.equal(root.style.getPropertyValue('--green'), '#f7d199');
  assert.equal(root.dataset.accent, 'amber');
  assert.equal(root.dataset.sidebar, 'compact');
  assert.equal(root.dataset.player, 'floating');
  assert.equal(root.lang, 'en');
  dom.window.close();
});

test('deezer payloads are parsed defensively and only trusted images survive', () => {
  assert.equal(safePicture('https://cdn-images.dzcdn.net/images/artist/a/400x400.jpg', ['cdn-images.dzcdn.net']), 'https://cdn-images.dzcdn.net/images/artist/a/400x400.jpg');
  assert.equal(safePicture('https://evil.test/a.jpg', ['cdn-images.dzcdn.net']), null);
  assert.equal(safePicture('http://cdn-images.dzcdn.net/a.jpg', ['cdn-images.dzcdn.net']), null);
  assert.equal(safePicture("javascript:alert(1)", ['cdn-images.dzcdn.net']), null);

  assert.deepEqual(parseDeezerArtist({}), null);
  const artist = parseDeezerArtist({ id: 7, name: 'Kino', picture_xl: 'https://cdn-images.dzcdn.net/x.jpg', nb_fan: '1 234 567', nb_album: 12, genre: { name: 'Rock' } });
  assert.equal(artist?.fans, 1234567);
  assert.deepEqual(artist?.genres, ['Rock']);

  // Точное имя с нефункциональным id отбрасывается, берётся первое совпадение с числовым id.
  const picked = pickDeezerArtist({ data: [{ id: 1, name: 'Other' }, { id: 2, name: 'Kino - Topic' }, { id: 'bad', name: 'Kino' }] }, 'Kino');
  assert.equal(picked?.id, 2);
  assert.equal(pickDeezerArtist({ data: [] }, 'Kino'), null);

  const similar = parseDeezerSimilar({ data: [{ id: 5, name: 'Solnearis', picture_medium: 'https://cdn-images.dzcdn.net/s.jpg' }, { id: 5, name: 'Solnearis' }, { name: 'no id' }] });
  assert.deepEqual(similar.map((row) => row.name), ['Solnearis']);
  assert.equal(deezerRelatedUrl(5), 'https://api.deezer.com/artist/5/related?limit=8');
});

test('wikipedia search picks the closest page and keeps https links only', () => {
  const payload = { query: { pages: { 1: { pageid: 1, index: 2, title: 'Something else', extract: 'intro' }, 2: { pageid: 42, index: 1, title: 'Kino (band)', extract: '  Советская   рок-группа.  ', url: 'https://en.wikipedia.org/wiki/Kino_(band)', thumbnail: { source: 'https://upload.wikimedia.org/a.png' } } } } };
  const parsed = parseWikipedia(payload, 'Kino', 'en');
  assert.equal(parsed.biography, 'Советская рок-группа.');
  assert.equal(parsed.url, 'https://en.wikipedia.org/wiki/Kino_(band)');
  assert.equal(parsed.thumbnail, 'https://upload.wikimedia.org/a.png');
  assert.deepEqual(parseWikipedia({}, 'Kino'), { biography: '', url: null, thumbnail: null });
  const url = new URL(wikipediaUrl('Кино', 'ru'));
  assert.equal(url.host, 'ru.wikipedia.org');
  assert.equal(url.searchParams.get('explaintext'), '1');
  assert.equal(url.searchParams.get('gsrsearch')?.startsWith('Кино'), true);
});
