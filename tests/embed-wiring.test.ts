import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Поведение обхода закрыто в lib/embed-fallback.ts (там же и тесты), а здесь — страховка
 * от «аккуратно» отключённой проводки: плеер обязан отдавать код, страница — не показывать
 * ошибку во время проб, а сдаваться одной короткой строкой со следующим треком в очереди.
 */
const page = readFileSync('app/page.tsx', 'utf8');
const player = readFileSync('components/YouTubePlayer.tsx', 'utf8');
const i18n = readFileSync('lib/i18n.ts', 'utf8');

test('the player hands the raw YouTube code to the page instead of deciding alone', () => {
  assert.match(player, /onError:\(message:string,code:number\)=>void/);
  assert.match(player, /callbacks\.current\.onError\(embedErrorMessage\(code\),code\)/);
  // Чужой (уже не выбранный) ролик не должен приносить ложную ошибку.
  assert.match(player, /if\(!selected\.current \|\| \(failed && failed!==selected\.current\)\)return;/);
});

test('a blocked embed keeps loading, never shows a notice, and confirms the substitute on playing', () => {
  const line = page.split('\n').find((x) => x.includes('<YouTubePlayer ref={yt}'));
  assert.ok(line, 'YouTubePlayer должен остаться на странице');
  assert.match(line, /onError=\{\(message, code\) => \{[\s\S]*?if \(embed\.error\(code\)\) \{ setLoading\(true\); return; \}/);
  assert.match(line, /onState=\{\(state\) => \{ if \(state === 'playing'\) \{ embed\.playing\(\);/);
  // Очередь не встает: сообщение показываем только когда обход сам сдался.
  assert.match(line, /\} setLoading\(false\); setPlaying\(false\); setNotice\(message\); \}\} \/>/);
});

test('the fallback plays through the cache and asks the catalog mirror for alternates', () => {
  assert.match(page, /const embed: EmbedFallback = useMemo\(\(\) => createEmbedFallback\(\{/);
  assert.match(page, /fetch\(`\/api\/catalog\/search\?q=\$\{encodeURIComponent\(query\)\}`/);
  assert.match(page, /yt\.current\?\.load\(embed\.begin\(track\) \|\| track\.video_id\)/);
  // Предзагрузка следующего трека тоже идёт через кэш: повторный старт не должен искать заново.
  assert.equal(page.match(/embed\.playbackId\(/g)?.length, 3);
  assert.match(page, /remember: \(blocked, candidate\) => \{ embedCache\.current = rememberEmbedSubstitute\(/);
  assert.match(page, /invalidate: \(blocked\) => \{ embedCache\.current = failEmbedSubstitute\(/);
  assert.match(page, /embedCache\.current = readEmbedCache\(typeof window === 'undefined' \? null : window\.localStorage\)/);
  // Локальный файл и SoundCloud не имеют отношения к YouTube — цикл пробов закрываем.
  assert.match(page, /if \(!track\.video_id\) \{ embed\.cancel\(\); yt\.current\?\.stop\(\); \}/);
});

test('exhausted alternatives mean one short notice and the next track in the queue', () => {
  assert.match(page, /embedGiveUp\.current\.onExhausted = \(\) => \{ say\('noticeEmbedFallback'\); void skip\(1, true\); \};/);
  assert.match(i18n, /noticeEmbedFallback: 'Трек недоступен для стриминга, переключаем дальше\.',/);
  assert.match(i18n, /noticeEmbedFallback: 'Track is not embeddable, moving to the next one\.',/);
});
