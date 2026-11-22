import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/**
 * Живой тест поля кода: шесть ячеек, по одной цифре в каждой, вставка из буфера и клавиши
 * перемещения фокуса. Вёрстку (ряд не вылезает за модальное окно) проверяет layout.test.ts
 * через postcss — раскладки в jsdom нет.
 *
 * react-dom определяет «поддерживает ли браузер input-события» в момент импорта, поэтому
 * окно jsdom создаётся до import: иначе React уходит в полиfill для старых IE и onChange
 * не вызывается вовсе (активные тесты молча проходят на residue в DOM).
 */
type Dom = JSDOM & { window: Window & typeof globalThis };
type Handle = { dom: Dom; doc: Document; root: { unmount: () => void }; unmount: () => void };
type Props = {
  length?: number; value: string; onChange: (next: string) => void;
  onComplete?: (digits: string, raw: string) => void; disabled?: boolean;
  invalid?: boolean; autoFocus?: boolean; label?: string; reducedMotion?: boolean;
};

let React: typeof import('react');
let act: (fn: () => unknown) => Promise<void>;
let createRoot: (container: Element) => { render: (element: React.ReactElement) => void; unmount: () => void };
let OtpCodeInput: React.ComponentType<Props>;

const stubWindow = (dom: Dom) => {
  const win = dom.window as unknown as Record<string, unknown> & { requestAnimationFrame: (cb: FrameRequestCallback) => number; cancelAnimationFrame: (id: number) => void };
  Object.assign(globalThis, {
    window: win, document: (win as unknown as { document: Document }).document,
    Element: (win as unknown as { Element: unknown }).Element, HTMLElement: (win as unknown as { HTMLElement: unknown }).HTMLElement,
    SVGElement: (win as unknown as { SVGElement: unknown }).SVGElement, Node: (win as unknown as { Node: unknown }).Node,
    Event: (win as unknown as { Event: unknown }).Event, IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: (cb: FrameRequestCallback) => win.requestAnimationFrame(cb),
    cancelAnimationFrame: (id: number) => win.cancelAnimationFrame(id),
  });
};
const dropWindow = (dom: Dom) => {
  for (const key of ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node', 'Event', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    delete (globalThis as Record<string, unknown>)[key];
  }
  dom.window.close();
};

before(async () => {
  const boot = new JSDOM('<!doctype html>', { url: 'https://example.com/', pretendToBeVisual: true }) as Dom;
  stubWindow(boot);
  React = await import('react');
  act = (React as unknown as { act: typeof act }).act;
  createRoot = (await import('react-dom/client')).createRoot;
  OtpCodeInput = (await import('../components/OtpCodeInput')).default as unknown as React.ComponentType<Props>;
  dropWindow(boot);
});

function mount(element: React.ReactElement): Handle {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.com/', pretendToBeVisual: true }) as Dom;
  stubWindow(dom);
  const root = createRoot(dom.window.document.getElementById('root')!);
  act(() => { root.render(element); });
  return {
    dom,
    doc: dom.window.document,
    root,
    unmount: () => { act(() => { root.unmount(); }); dropWindow(dom); },
  };
}

/** Поле контролируемое, поэтому состояние держит настоящий React-state. */
function controlled(extra: { events?: string[][] } = {}) {
  const events = extra.events ?? [];
  return function Probe() {
    const [value, setValue] = (React as unknown as { useState: <T>(init: T) => [T, (next: T) => void] }).useState('');
    return React.createElement(OtpCodeInput, {
      length: 6,
      value,
      label: 'Код',
      onChange: (next: string) => setValue(next),
      onComplete: (digits: string, raw: string) => { events.push([digits, raw]); },
    });
  };
}

const cellsOf = (handle: Handle) => Array.from(handle.doc.querySelectorAll('.otp-cell input')) as HTMLInputElement[];

const type = async (handle: Handle, input: HTMLInputElement, value: string) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(handle.dom.window.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new handle.dom.window.Event('input', { bubbles: true }));
  });
};

const paste = async (handle: Handle, input: HTMLInputElement, text: string) => {
  await act(async () => {
    const event = new handle.dom.window.Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: { getData: () => string } };
    event.clipboardData = { getData: () => text };
    input.dispatchEvent(event);
  });
};

test('поле кода: шесть ячеек, в каждой ровно один input с maxLength=1', () => {
  const handle = mount(React.createElement(OtpCodeInput, { length: 6, value: '', onChange: () => {}, label: 'Код' }));
  const cells = Array.from(handle.doc.querySelectorAll('.otp-cell'));
  assert.equal(cells.length, 6, 'ячеек ровно шесть — столько же, сколько цифр в письме');
  for (const [index, cell] of cells.entries()) {
    const inputs = cell.querySelectorAll('input');
    assert.equal(inputs.length, 1, `в ячейке ${index + 1} один input: он обязан быть ограничен ячейкой, а не висеть поверх неё`);
    assert.equal(inputs[0].getAttribute('maxlength'), '1', 'одна ячейка — одна цифра');
    assert.equal(inputs[0].getAttribute('aria-label'), `Цифра ${index + 1}`);
    assert.equal(inputs[0].getAttribute('inputmode'), 'numeric');
  }
  const inputs = cellsOf(handle);
  assert.equal(inputs[0].getAttribute('autocomplete'), 'one-time-code', 'менеджер паролей подставит код в первую ячейку');
  assert.equal(inputs[1].getAttribute('autocomplete'), 'off');
  handle.unmount();
});

test('набор цифр раскладывается по ячейкам и разово завершает ввод', async () => {
  const events: string[][] = [];
  const handle = mount(React.createElement(controlled({ events })));
  for (const [index, digit] of ['4', '8', '1', '9'].entries()) {
    await type(handle, cellsOf(handle)[index], digit);
  }
  assert.deepEqual(cellsOf(handle).map((input) => input.value), ['4', '8', '1', '9', '', ''], 'каждая цифра села в свою ячейку');
  assert.deepEqual(events, [], 'пока код неполный, автоотправки нет');
  await type(handle, cellsOf(handle)[4], '0');
  await type(handle, cellsOf(handle)[5], '2');
  assert.deepEqual(cellsOf(handle).map((input) => input.value), ['4', '8', '1', '9', '0', '2']);
  assert.deepEqual(events, [['481902', '481902']], 'полный код уходит на проверку один раз');
  handle.unmount();
});

test('вставка из буфера: код из письма раскладывается, лишние цифры не теряются', async () => {
  const events: string[][] = [];
  const handle = mount(React.createElement(controlled({ events })));
  await paste(handle, cellsOf(handle)[0], 'Твой код входа в Nocturne: 481902 — он действует десять минут.');
  assert.deepEqual(cellsOf(handle).map((input) => input.value), ['4', '8', '1', '9', '0', '2'], 'цифры достаются из surrounding-текста письма');
  assert.deepEqual(events, [['481902', '481902']], 'raw = только цифры письма, без цифр из текста вокруг');
  handle.unmount();

  // Пока в Supabase стоит mailer_otp_length=8, письмо несёт 8 цифр: ячейки показывают 6,
  // а полным значением проверяет форма — иначе пользователь уперётся в «код не подошёл».
  const wide: string[][] = [];
  const second = mount(React.createElement(controlled({ events: wide })));
  await paste(second, cellsOf(second)[0], '12345678');
  assert.deepEqual(cellsOf(second).map((input) => input.value), ['1', '2', '3', '4', '5', '6']);
  assert.deepEqual(wide, [['123456', '12345678']], 'длинный код не режется молча — raw уходит наружу');
  second.unmount();

  // Одно окно jsdom на монтирование: mont/unmount меняют глобали, поэтому разбираем предыдущее
  // дерево до следующего.
  // Цифры из текста письма не должны подменять код: берётся непрерывная группа цифр.
  const order: string[][] = [];
  const third = mount(React.createElement(controlled({ events: order })));
  await paste(third, cellsOf(third)[0], 'Код действует 10 минут, ваш код 481902. Не передавайте его никому.');
  assert.deepEqual(cellsOf(third).map((input) => input.value), ['4', '8', '1', '9', '0', '2'], 'цифра из «10 минут» не влезла в код');
  assert.deepEqual(order, [['481902', '481902']]);
  third.unmount();
});

test('стрелки и Backspace двигают фокус по ячейкам', async () => {
  const handle = mount(React.createElement(OtpCodeInput, { length: 6, value: '48', onChange: () => {} }));
  const inputs = cellsOf(handle);
  const pressed: number[] = [];
  handle.doc.addEventListener('focusin', (event) => { pressed.push(inputs.indexOf(event.target as HTMLInputElement) + 1); });
  const key = async (input: HTMLInputElement, keyName: string) => {
    await act(async () => { input.dispatchEvent(new handle.dom.window.KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true })); });
  };
  await key(inputs[1], 'ArrowRight');
  assert.equal(pressed.at(-1), 3, 'стрелка вправо переводит фокус на следующую ячейку');
  await key(inputs[2], 'ArrowLeft');
  assert.equal(pressed.at(-1), 2, 'стрелка влево возвращается в предыдущую');
  // Пустая ячейка: Backspace уводит фокус влево и не трогает заполненные соседи.
  await key(inputs[2], 'Backspace');
  assert.equal(inputs[0].value, '4', 'в незаполненной ячейке Backspace не стирает чужую цифру');
  assert.equal(pressed.at(-1), 2, 'фокус уехал на ячейку слева');
  handle.unmount();
});
