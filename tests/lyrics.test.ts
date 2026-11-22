import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeLyricLine, chooseLyrics, lyricsCacheKey, lyricsUrl, parseLrc, searchArtist, searchTitle } from '../lib/lyrics';

test('parseLrc reads timestamps, multiple stamps per line and offset metadata', () => {
  const lines = parseLrc(['[offset:500]', '[00:10.00]Первая строка', '[00:20.50]Вторая', '[00:30.25][01:30.25]Припев'].join('\n'));
  assert.deepEqual(lines.map((line) => line.time.toFixed(2)), ['9.50', '20.00', '29.75', '89.75']);
  assert.equal(lines[0].text, 'Первая строка');
  assert.deepEqual(parseLrc(''), []);
  assert.deepEqual(parseLrc(null), []);
});

test('active line follows playback and ignores lines before the first timestamp', () => {
  const lines = parseLrc('[00:05.00]a\n[00:10.00]b\n[00:15.00]c');
  assert.equal(activeLyricLine(lines, 4.9), -1);
  assert.equal(activeLyricLine(lines, 5), 0);
  assert.equal(activeLyricLine(lines, 12.4), 1);
  assert.equal(activeLyricLine(lines, 999), 2);
});

test('query helpers strip official-video noise and build a bounded LRCLIB request', () => {
  assert.equal(searchTitle('Кукла (Official Music Video)'), 'Кукла');
  assert.equal(searchArtist('Kino - Topic'), 'Kino');
  const url = new URL(lyricsUrl({ title: 'Группа крови (live)', artist: 'Кино - Topic', duration: 285.7, album: 'Ночь' }));
  assert.equal(url.host, 'lrclib.net');
  assert.equal(url.pathname, '/api/search');
  assert.equal(url.searchParams.get('track_name'), 'Группа крови');
  assert.equal(url.searchParams.get('artist_name'), 'Кино');
  assert.equal(url.searchParams.get('duration'), '286');
  assert.equal(url.searchParams.get('album_name'), 'Ночь');
});

test('search results prefer an exact artist+title match with synced lyrics', () => {
  const payload = [
    { trackName: 'Другая песня', artistName: 'Кино', plainLyrics: 'не то', syncedLyrics: null },
    { trackName: 'Группа крови', artistName: 'Кино', syncedLyrics: '[00:01.00]tring', plainLyrics: 'plain text', language: 'ru' },
  ];
  const result = chooseLyrics(payload, { title: 'Группа крови', artist: 'Кино' });
  assert.equal(result.source, 'lrclib');
  assert.equal(result.synced.length, 1);
  assert.equal(result.plain, 'plain text');
  assert.equal(result.language, 'ru');
});

test('missing lyrics resolve to an empty result instead of throwing', () => {
  assert.equal(chooseLyrics({ message: 'not found' }, { title: 'X', artist: 'Y' }).source, 'none');
  assert.equal(chooseLyrics([{ trackName: 'X', artistName: 'Y' }], { title: 'X', artist: 'Y' }).source, 'none');
  assert.equal(lyricsCacheKey({ title: 'A (Live)', artist: 'B - Topic', duration: 12.4 }), 'b|a|12');
});
