import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlaylist, readGuestPlaylists, removePlaylist, renamePlaylist, sanitizePlaylists, setPlaylistCover, toggleTrackInPlaylist, tracksInPlaylist, MAX_PLAYLISTS, MAX_TRACKS } from '../lib/guest-playlists';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('', { url: 'https://example.com' });
Object.assign(globalThis, { localStorage: dom.window.localStorage });

const list = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `p${index}`, name: `Плейлист ${index}`, created_at: '2026-01-01T00:00:00.000Z', track_ids: ['t1'] }));

test('stored garbage never crashes the sidebar', () => {
  assert.deepEqual(sanitizePlaylists(undefined), []);
  assert.deepEqual(sanitizePlaylists('nope'), []);
  const mixed = sanitizePlaylists([null, 5, { name: 'без id' }, { id: 'a', name: 'A', track_ids: 'x' }, { id: 'a', name: 'дубль' }, { id: 'b', name: 'B', track_ids: [1, 't', 't', null] }]);
  assert.deepEqual(mixed.map((item) => item.id), ['a', 'b']);
  assert.deepEqual(mixed[0].track_ids, []);
  assert.deepEqual(mixed[1].track_ids, ['t']);
  assert.equal(mixed[0].cover_url, null);
  assert.equal(sanitizePlaylists([{ id: 'x', name: 'x', cover_url: 'https://evil.test/a.png' }])[0].cover_url, null);
  assert.equal(sanitizePlaylists([{ id: 'x', name: 'x', cover_url: 'data:image/jpeg;base64,AAAA' }])[0].cover_url, 'data:image/jpeg;base64,AAAA');
});

test('lists are capped so localStorage cannot be flooded', () => {
  const capped = sanitizePlaylists(list(MAX_PLAYLISTS + 30));
  assert.equal(capped.length, MAX_PLAYLISTS);
  const fat = sanitizePlaylists([{ id: 'x', name: 'x', track_ids: Array.from({ length: MAX_TRACKS + 50 }, (_, i) => `t${i}`) }]);
  assert.equal(fat[0].track_ids.length, MAX_TRACKS);
});

test('playlist edits are immutable and guarded', () => {
  const start = list(2);
  const created = createPlaylist(start, '  Волна  ', 'new-1');
  assert.equal(created.playlist?.name, 'Волна');
  assert.equal(created.items.length, 3);
  assert.equal(createPlaylist(start, 'плейлист 0', 'dup').playlist, null);
  assert.equal(createPlaylist(start, '   ', 'blank').playlist, null);
  assert.equal(renamePlaylist(start, 'p0', '  ').find((x) => x.id === 'p0')?.name, 'Плейлист 0');
  assert.equal(renamePlaylist(start, 'p0', 'Новое').find((x) => x.id === 'p0')?.name, 'Новое');
  assert.equal(removePlaylist(start, 'p1').length, 1);
  assert.equal(start.length, 2, 'исходный массив не должен меняться');
});

test('adding a track toggles it and respects the ceiling', () => {
  const base = [{ id: 'p', name: 'p', created_at: '', track_ids: [] }];
  const added = toggleTrackInPlaylist(base, 'p', 't1');
  assert.deepEqual(added.items[0].track_ids, ['t1']);
  assert.equal(added.added, true);
  const again = toggleTrackInPlaylist(added.items, 'p', 't1');
  assert.deepEqual(again.items[0].track_ids, []);
  assert.equal(again.added, false);
  assert.equal(toggleTrackInPlaylist(base, 'p', '  ').added, false);
  const full = [{ id: 'p', name: 'p', created_at: '', track_ids: Array.from({ length: MAX_TRACKS }, (_, i) => `t${i}`) }];
  assert.equal(toggleTrackInPlaylist(full, 'p', 'overflow').added, false);
});

test('guest playlists round-trip through storage', () => {
  localStorage.clear();
  assert.deepEqual(readGuestPlaylists(), []);
  const created = createPlaylist(readGuestPlaylists(), 'Вечер', 'x1');
  created.items[0].track_ids = ['t9'];
  localStorage.setItem('nocturne.playlists.v1', JSON.stringify(created.items));
  assert.deepEqual(tracksInPlaylist(readGuestPlaylists(), 'x1'), ['t9']);
  assert.deepEqual(tracksInPlaylist(readGuestPlaylists(), null), []);
  localStorage.setItem('nocturne.playlists.v1', '{{{');
  assert.deepEqual(readGuestPlaylists(), []);
  // обложка ставится и снимается только у существующего плейлиста
  const withCover = setPlaylistCover(created.items, 'x1', 'data:image/png;base64,BB');
  assert.equal(withCover[0].cover_url, 'data:image/png;base64,BB');
  assert.equal(setPlaylistCover(withCover, 'x1', 'https://evil.test/a.png')[0].cover_url, null);
  assert.equal(setPlaylistCover(withCover, 'other', null)[0].cover_url, 'data:image/png;base64,BB');
  dom.window.close();
});
