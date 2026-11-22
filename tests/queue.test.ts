import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendQueue, indexAfterRemove, moveInQueue, removeInQueue, resolveNextIndex } from '../lib/queue';
import { SLEEP_FADE_SECONDS, sanitizeSleepTimer, sleepExpired, sleepMinutes, sleepMultiplier } from '../lib/sleep-timer';
import { fadeInGain, fadeOutGain, resolveVolume, shouldFadeOut } from '../lib/fade';
import { formatAddedDate, formatDuration, formatMinutes } from '../lib/format';

const tracks = (ids: string[]) => ids.map((id) => ({ id, video_id: id, title: `t-${id}`, artist: 'a' }));

test('queue reorder keeps the playing row and clamps out-of-range drops', () => {
  assert.deepEqual(moveInQueue(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveInQueue(['a', 'b', 'c'], 2, -5), ['c', 'a', 'b']);
  assert.deepEqual(moveInQueue(['a', 'b', 'c'], 9, 0), ['a', 'b', 'c']);
  assert.equal(indexAfterRemove(2, 1), 1);
  assert.equal(indexAfterRemove(2, 2), 2);
  assert.deepEqual(removeInQueue(tracks(['a', 'b', 'c']), 1).map((t) => t.id), ['a', 'c']);
});

test('appending to the queue skips duplicates and bounds the length', () => {
  const first = appendQueue(tracks(['a']), tracks(['a', 'b', 'b', 'c']));
  assert.deepEqual(first.items.map((t) => t.id), ['a', 'b', 'c']);
  assert.equal(first.added, 2);
  const capped = appendQueue(tracks(['1', '2', '3']), tracks(['4', '5']), 4);
  assert.deepEqual(capped.items.map((t) => t.id), ['2', '3', '4', '5']);
});

test('next index honours shuffle, repeat and the end of the queue', () => {
  assert.deepEqual(resolveNextIndex({ length: 3, index: 0, direction: -1 }), { index: 0, end: false });
  assert.deepEqual(resolveNextIndex({ length: 3, index: 2, direction: 1 }), { index: 2, end: true });
  assert.deepEqual(resolveNextIndex({ length: 3, index: 2, direction: 1, repeat: true }), { index: 0, end: false });
  const random = Math.random;
  Math.random = () => 0.5;
  try {
    const result = resolveNextIndex({ length: 4, index: 1, direction: 1, shuffle: true });
    assert.notEqual(result.index, 1);
    assert.ok(result.index >= 0 && result.index < 4);
  } finally { Math.random = random; }
  assert.deepEqual(resolveNextIndex({ length: 0, index: 0 }), { index: 0, end: true });
});

test('sleep timer fades only inside the last window and expires once', () => {
  const endsAt = 10_000;
  const timer = { kind: 'minutes' as const, endsAt };
  assert.equal(sleepMultiplier(timer, endsAt - 60_000), 1);
  assert.equal(sleepMultiplier(timer, endsAt - SLEEP_FADE_SECONDS / 2 * 1000), 0.5);
  assert.equal(sleepMultiplier(timer, endsAt + 1000), 0);
  assert.equal(sleepExpired(timer, endsAt - 1), false);
  assert.equal(sleepExpired(timer, endsAt + 1), true);
  assert.equal(sleepMultiplier({ kind: 'track' }, 0), 1);
  assert.equal(sanitizeSleepTimer({ kind: 'minutes', endsAt: 'oops' }).kind, 'off');
  assert.equal(sanitizeSleepTimer({ kind: 'minutes', endsAt: Date.now() + 60_000 }).kind, 'minutes');
  assert.equal(sanitizeSleepTimer('junk').kind, 'off');
  const scheduled = sleepMinutes(15);
  assert.equal(scheduled.kind, 'minutes');
  if (scheduled.kind === 'minutes') assert.ok(scheduled.endsAt - Date.now() > 14 * 60_000);
});

test('fades and normalisation never leave the legal volume range', () => {
  assert.equal(fadeInGain(0, 3), 0.02);
  assert.equal(fadeInGain(1.5, 3), 0.5);
  assert.equal(fadeInGain(30, 0), 1);
  assert.equal(fadeOutGain(1, 4), 0.25);
  assert.equal(fadeOutGain(9, 4), 1);
  assert.equal(shouldFadeOut(3.9, 4), true);
  assert.equal(shouldFadeOut(4.1, 4), false);
  assert.equal(resolveVolume({ volume: 100 }), 1);
  assert.equal(resolveVolume({ volume: 100, normalize: true, remote: true }), 0.86 + 0.14 * 0.35);
  assert.equal(resolveVolume({ volume: 50, normalize: true, remote: true }), 0.5);
  assert.equal(resolveVolume({ volume: 100, fade: 0.5, normalize: false }), 0.5);
  assert.equal(resolveVolume({ volume: -20 }), 0);
  assert.equal(resolveVolume({ volume: NaN }), 0);
});

test('dates read like a person, not a database', () => {
  const now = Date.parse('2026-11-22T09:00:00Z');
  assert.equal(formatAddedDate('2026-11-22T06:00:00Z', { now }), 'Сегодня');
  assert.equal(formatAddedDate('2026-11-21T23:00:00Z', { now }), 'Вчера');
  assert.equal(formatAddedDate('2026-11-19T23:00:00Z', { now }), '3 дн. назад');
  assert.equal(formatAddedDate('2026-09-01T10:00:00Z', { now }), '1 сент. 2026 г.');
  assert.equal(formatAddedDate('2026-09-01T10:00:00Z', { now, locale: 'en-US' }), 'Sep 1, 2026');
  assert.equal(formatAddedDate(null), '');
  assert.equal(formatAddedDate('не дата'), '');
  assert.equal(formatDuration(75), '1:15');
  assert.equal(formatDuration(600), '10:00');
  assert.equal(formatDuration(null), '');
  assert.equal(formatDuration(-5), '');
  assert.equal(formatMinutes(45), '45 мин');
  assert.equal(formatMinutes(90), '1 ч 30 мин');
  assert.equal(formatMinutes(90, 'en'), '1 h 30 min');
});
