import { afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
type Page = { default: React.ComponentType };
let HomePage: React.ComponentType;
/**
 * framer-motion решает «есть ли браузер» и читает prefers-reduced-motion в момент импорта,
 * поэтому приложение подключается, только когда окно jsdom (matchMedia, requestAnimationFrame)
 * уже установлено: иначе анимации не стартуют вовсе, а закрытые панели остаются в DOM.
 */
before(async () => {
  const boot = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.com/', pretendToBeVisual: true });
  Object.assign(globalThis, { window: boot.window, document: boot.window.document, Element: boot.window.Element, HTMLElement: boot.window.HTMLElement, SVGElement: boot.window.SVGElement });
  boot.window.matchMedia = stubMatchMedia;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => boot.window.requestAnimationFrame(cb)) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => boot.window.cancelAnimationFrame(id)) as typeof cancelAnimationFrame;
  HomePage = (await import('../app/page') as Page).default;
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  boot.window.close();
});

function stubMatchMedia(query: string) {
  return {
    matches: /reduced-motion/.test(query), media: query, addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false,
  };
}
import { DEFAULT_PREFERENCES } from '../lib/preferences';

const tracks = (count: number) => Array.from({ length: count }, (_, i) => ({
  id: `yt:videoid${i}` as const, video_id: `videoid${i}`.padEnd(11, 'x').slice(0, 11), source: 'youtube',
  title: `Трекул ${i + 1}`, artist: `Артикул ${i + 1}`, storage_path: null, duration: 61 + i * 7, album: `Альбом ${i + 1}`,
  created_at: new Date(Date.now() - i * 86_400_000).toISOString(),
}));

const roots: Root[] = [];
let dom: JSDOM | undefined;
afterEach(async () => {
  // Unmount вне act(): при незавершённых exit-анимациях act() может ждать бесконечно.
  for (const root of roots.splice(0)) { try { root.unmount(); } catch { } }
  await settled();
  dom?.window.close();
  dom = undefined;
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).localStorage;
  delete (globalThis as any).requestAnimationFrame;
  delete (globalThis as any).cancelAnimationFrame;
});

const settled = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const guestStore = (likes: unknown[]) => JSON.stringify({ signals: [], likes });
async function renderApp(payload: unknown = { similar: tracks(4), recent: [], daily: [], trending: [] }, guestLikes: unknown[] = [], onboarded = false) {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.com/', pretendToBeVisual: true });
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document, Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement, SVGElement: dom.window.SVGElement, IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  // Кадры framer-motion берут requestAnimationFrame из глобали; в Node его нет, и выходная
  // анимация панели не завершилась бы никогда. Мостим в окно jsdom (с таймером-запасным).
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => (dom ? dom.window.requestAnimationFrame(cb) : setTimeout(() => cb(Date.now()), 16) as unknown as number)) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => { if (dom) dom.window.cancelAnimationFrame(id); else clearTimeout(id as unknown as NodeJS.Timeout); }) as typeof cancelAnimationFrame;
  // В jsdom нет настоящего кадрового цикла: просим reduced motion, чтобы framer-motion
  // не оставлял «вечных» анимаций, и акт-флаш всегда завершался.
  dom.window.matchMedia = stubMatchMedia as unknown as typeof dom.window.matchMedia;
  // Чистый localStorage: каждый тест смотрит приложение «первым визитом».
  // Приложение работает с «голым» localStorage: в Node его надо явно показать из окна.
  Object.assign(globalThis, { localStorage: dom.window.localStorage });
  dom.window.localStorage.clear();
  if (guestLikes.length) dom.window.localStorage.setItem('nocturne.guest.v1', guestStore(guestLikes));
  if (onboarded) dom.window.localStorage.setItem('nocturne.preferences.v1', JSON.stringify({ ...DEFAULT_PREFERENCES, onboardingCompleted: true }));
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify(payload))) as typeof fetch;
  afterEachHook.push(() => { globalThis.fetch = fetchBefore; });
  const root = createRoot(dom.window.document.getElementById('root')!);
  roots.push(root);
  await act(async () => { root.render(React.createElement(HomePage)); });
  // Один тик, чтобы эффекты снимали «загрузку» и мастер успел отрендериться.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
  return dom;
}
const afterEachHook: (() => void)[] = [];
afterEach(() => { while (afterEachHook.length) afterEachHook.pop()!(); });

const text = () => dom!.window.document.body.textContent || '';
const find = (selector: string) => dom!.window.document.querySelector(selector) as HTMLElement | null;
const all = (selector: string) => Array.from(dom!.window.document.querySelectorAll(selector)) as HTMLElement[];
const click = async (element: HTMLElement | null) => { assert.ok(element, 'элемент не найден'); await act(async () => { element!.dispatchEvent(new dom!.window.MouseEvent('click', { bubbles: true })); await Promise.resolve(); }); };
/** AnimatePresence mode="wait" монтирует следующий экран только после выхода предыдущего. */
const settle = async (ms = 320) => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); };
const next = async () => { await click(find('.wizard-foot .primary')); await settle(); };

test('onboarding wizard runs on first visit, previews live and never comes back after skip', async () => {
  await renderApp();;
  assert.ok(find('.wizard-shell'), 'мастер должен открыться на первом визите');
  assert.match(text(), /Шаг 1 из 5/);
  assert.ok(find('.wizard-skip'), '«Пропустить» есть на каждом шаге');

  // Шаг 1 переключает язык интерфейса мгновенно.
  await click(all('.pick')[1]);
 ; assert.match(text(), /Your music|Music for you/);;
  assert.equal(dom!.window.document.documentElement.lang, 'en');
  await click(all('.pick')[0]);;
  assert.equal(dom!.window.document.documentElement.lang, 'ru');

  // Тема и раскладка применяются сразу: data-атрибуты на <html> — источник истины для CSS.
  await next();;
  assert.match(text(), /Изумруд Nocturne|Тёплый янтарный/);
  const swatch = all('.accent-swatch')[2];
  assert.ok(swatch, 'палитра состоит из четырёх тем');
  await click(swatch);;
  assert.equal(dom!.window.document.documentElement.dataset.accent, 'amber');
  await next();
  assert.ok(find('.preview-screen'), 'шаг раскладки показывает живой мини-макет экрана');
  const compactPick = all('.pick').find((button) => /Компактное|Compact, icons only/.test(button.textContent || ''));
  assert.ok(compactPick, 'выбор компактной боковой панели');
  await click(compactPick!);;
  assert.equal(dom!.window.document.documentElement.dataset.sidebar, 'compact');
  assert.equal(dom!.window.document.documentElement.dataset.player, 'floating');
  await click(find('.wizard-skip'));;
  await settle();;
  assert.ok(!find('.wizard-shell'), 'после «Пропустить» мастер закрывается');
  assert.equal(JSON.parse(dom!.window.localStorage.getItem('nocturne.preferences.v1') || '{}').onboardingCompleted, true);
  assert.equal(dom!.window.document.documentElement.dataset.accent, 'amber', 'выбранная тема остаётся после пропуска');
});

test('every wizard step offers skip and back, and finishing stores taste for recommendations', async () => {
  await renderApp();
  for (let step = 0; step < 5; step++) {
    assert.ok(find('.wizard-skip'), `шаг ${step + 1}: кнопка «Пропустить» обязательна`);
    const back = find('.wizard-foot .ghost');
    assert.ok(back, `шаг ${step + 1}: кнопка «Назад» обязательна`);
    assert.equal(back!.hasAttribute('disabled'), step === 0, 'на первом шаге «Назад» недоступна');
    await next();
  }
  assert.ok(!find('.wizard-shell'));
  const stored = JSON.parse(dom!.window.localStorage.getItem('nocturne.preferences.v1') || '{}');
  assert.equal(stored.onboardingCompleted, true);
});

test('the now-playing panel shifts content instead of covering it and closes from the player', async () => {
  await renderApp({ similar: [], recent: [], daily: [], trending: [] }, tracks(2), true);
  assert.ok(!find('.now-playing-panel'), 'панель закрыта, пока её не открыли');
  await click(find('.player-right [aria-label="Панель «Сейчас играет»"]'));
  await settle();
  const panel = find('.now-playing-panel');
  assert.ok(panel, 'кнопка в плеере открывает панель «Сейчас играет»');
  assert.ok(panel!.querySelector('.panel-head'), 'у панели есть заголовок с закрытием');
  assert.match(panel!.textContent || '', /пуст|Очередь|включите/, 'без играющего трека панель говорит об этом прямо');
  assert.ok(find('.app-shell.has-panel'), 'контент сдвигается, а не перекрывается');
  assert.ok(panel!.querySelector('.panel-kicker'), 'панель подписана контекстом, а не пустая');
  await click(find('.now-playing-panel .panel-close'));
  await settle();
  assert.ok(!find('.now-playing-panel'));
  assert.ok(!find('.app-shell.has-panel'));
});

test('queue panel reorders, removes and never invents a now-playing row', async () => {
  await renderApp({ similar: [], recent: [], daily: [], trending: [] }, tracks(3), true);
  const add = all('.track-controls [aria-label="В очередь"]');
  assert.equal(add.length, 3, 'у каждой строки есть «В очередь»');
  await click(add[0]);
  await click(add[1]);
  await click(add[2]);
  await click(find('.player-right [aria-label="Очередь"]'));
  await settle();
  const rows = () => all('.queue-panel .queue-row');
  const tools = (label: RegExp) => all('.queue-panel .queue-tools button').filter((button) => label.test(button.getAttribute('aria-label') || ''));
  assert.ok(find('.queue-panel'), 'панель очереди открывается');
  assert.equal(rows().length, 3, 'в очереди ровно добавленные строки');
  assert.match(text(), /Далее в очереди/, 'без играющего трека очередь начинается сразу со «Далее»');
  assert.ok(!find('.queue-panel .queue-now'), 'строка «Играет сейчас» не выдумывается');
  const moveUp = tools(/Поднять выше|Move up/);
  assert.equal(moveUp.length, 3, 'каждую строку можно переместить');
  assert.ok((moveUp[0] as HTMLButtonElement).disabled, 'первая строка уже наверху');
  await click(tools(/Убрать из очереди|Remove from queue/).pop()!);
  await settle();
  assert.equal(rows().length, 2, 'строка удаляется из очереди');
  await click(find('.queue-panel .panel-close'));
  await settle();
  assert.ok(!find('.queue-panel'), 'панель очереди закрывается');
});

test('settings mirror the wizard, manage blocks and hotkeys, and restart onboarding', async () => {
  await renderApp({ similar: [], recent: [], daily: [], trending: [] }, tracks(2), true);
  await click(find('.topbar [aria-label="Настройки"]'));
  await settle();
  assert.ok(find('.settings-panel'), 'шестерня в шапке открывает настройки');
  assert.ok(find('.settings-body .segmented'), 'настройки показывают группы переключателей');
  const secondAccent = all('.accent-dot')[1];
  assert.ok(secondAccent, 'в настройках есть палитра');
  await click(secondAccent!);
  assert.equal(dom!.window.document.documentElement.dataset.accent, 'violet');
  const body = () => (find('.settings-body')?.textContent || '');
  const tab = (label: RegExp) => all('.settings-tabs button').find((button) => label.test(button.textContent || '')) || null;
  await click(tab(/чёрный список|Blacklist|blocks/i));
  await settle(60);
  assert.match(body(), /никого не исключили|no one/i, 'пустой чёрный список объясняется честно');
  await click(tab(/горячие клавиши|Hotkeys/i));
  await settle(60);
  assert.match(body(), /Space/, 'шпаргалка по горячим клавишам в настройках');
  await click(tab(/Воспроизведение|Playback/i));
  await settle(60);
  const sleepChip = all('.chip').find((button) => /30/.test(button.textContent || ''));
  assert.ok(sleepChip, 'таймер сна предлагает 15/30/45/60 минут');
  await click(sleepChip!);
  assert.match(find('.player-right [aria-label="Таймер сна"]')!.className, /on/, 'иконка таймера горит, пока он активен');
  await click(find('.settings-panel [aria-label="Закрыть панель"]'));
  await settle();
  assert.ok(!find('.settings-panel'));
  // «Пройти заново» возвращает онбординг.
  assert.match(text(), /Nocturne/);
});

test('library table shows album and human dates, hides technical source, and blocks per row', async () => {
  await renderApp({ similar: tracks(2), recent: [], daily: [], trending: [] }, tracks(3), true);
  const head = all('.track-head span').map((span) => (span.textContent || '').trim());
  assert.ok(head.some((label) => /Альбом/.test(label)), `колонка «Альбом» должна быть: ${head.join(', ')}`);
  assert.ok(head.some((label) => /Добавлено/.test(label)), 'колонка «Добавлено» должна быть');
  assert.ok(!head.some((label) => /Источник|Стриминг|YouTube|Локальный/.test(label)), 'технический «Источник» из интерфейса убран');
  const rows = all('.track-row');
  assert.equal(rows.length, 3, 'в «Любимых треках» — лайки гостя');
  assert.match(rows[0].querySelector('.track-album')!.textContent || '', /Альбом/, 'колонка альбома не пустая');
  assert.match(rows[0].querySelector('.track-added')!.textContent || '', /Сегодня|Вчера|\d{1,2}\s\S+\s\d{4}/);
  assert.match(rows[1].querySelector('.track-time')!.textContent || '', /^\d:\d\d$/, 'длительность в формате М:СС');
  assert.ok(rows[0].querySelector('.track-art'), 'у строки есть обложка трека');
  assert.equal(rows[0].querySelectorAll('.track-controls [aria-label^="Не рекомендовать"]').length, 1, 'в каждой строке есть «Не рекомендовать»');
  // Блокировка убирает карточку с полки сразу, не дожидаясь ответа сервера, и предлагает отменить.
  const shelf = find('.shelf')!;
  const shelfTitles = () => Array.from(shelf.querySelectorAll('.catalog-card b')).map((b) => (b.textContent || '').trim());
  const blockedTitle = shelfTitles()[0];
  assert.ok(blockedTitle, 'на полке есть карточка');
  await click(shelf.querySelector('[aria-label^="Не рекомендовать"]'));
  await settle();
  assert.ok(!shelfTitles().includes(blockedTitle), `заблокированный трек уходит с полки: ${shelfTitles().join(', ')}`);
  assert.ok((dom!.window.localStorage.getItem('nocturne.recommendation-blocks.v1') || '').includes(blockedTitle), 'блокировка сохранена в браузере');
  const toast = find('.toast');
  assert.ok(toast, 'сразу после блокировки появляется подсказка');
  assert.ok(find('.toast .undo-block'), 'блокировку можно отменить');
  await click(find('.toast .undo-block'));
  await settle();
  assert.ok(shelfTitles().includes(blockedTitle), 'после «Вернуть» трек снова на полке');
  assert.ok(!(dom!.window.localStorage.getItem('nocturne.recommendation-blocks.v1') || '').includes(blockedTitle), 'отмена убирает блокировку из браузера');
  // Имя артиста на карточке ведёт на страницу артиста.
  const artistLink = find('.shelf .artist-link');
  assert.ok(artistLink, 'у карточки есть ссылка на артиста');
  const artistName = (artistLink!.textContent || '').trim();
  await click(artistLink);
  await settle();
  assert.ok(find('.artist-view') || find('.artist-hero'), 'страница артиста открывается по клику на имя');
  assert.match(text(), new RegExp(artistName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'на странице показан именно этот артист');
});

test('demo recommendations are gone: the library starts empty for a fresh guest', async () => {
  await renderApp({ similar: [], recent: [], daily: [], trending: [] });
  await click(find('.wizard-skip'));
  assert.doesNotMatch(text(), /Outfoxing the Fox|Kevin MacLeod|Incompetech/);
  assert.doesNotMatch(text(), /Демо-|Демо /);
  assert.match(text(), /Треков: 0|Пока пусто/, 'пустая медиатека выглядит пустой');
});

test('hotkeys drive the interface and are ignored while typing', async () => {
  await renderApp({ similar: [], recent: [], daily: [], trending: [] }, tracks(1), true);
  const key = async (init: KeyboardEventInit) => { await act(async () => { dom!.window.dispatchEvent(new dom!.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })); await Promise.resolve(); }); };
  assert.match(find('.player-right')!.textContent || '', /\d+%/, 'громкость подписана процентами');
  await key({ key: 'm' });
  assert.match(find('.player-right')!.textContent || '', /0%/, 'M выключает звук');
  await key({ key: 'm' });
  await key({ key: 'q' });
  await settle(60);
  assert.ok(find('.queue-panel'), 'Q открывает очередь');
  await key({ key: '/' });
  await settle(60);
  const dialog = find('.modal[role="dialog"]');
  assert.ok(dialog, 'Slash открывает поиск');
  const input = dialog!.querySelector('input')! as HTMLInputElement;
  await act(async () => { input.focus(); await Promise.resolve(); });
  await key({ key: 'm' });
  await key({ key: 'q' });
  await settle(60);
  assert.ok(find('.modal[role="dialog"]'), 'в поле ввода клавиши не перехватываются');
  await key({ key: 'Escape' });
  await settle();
  assert.ok(!find('.modal[role="dialog"]'), 'Esc закрывает поиск');
});
