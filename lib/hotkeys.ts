/** Горячие клавиши плеера. Чистый сопоставитель — можно тестировать без браузера. */
export type Hotkey = 'play' | 'next' | 'previous' | 'mute' | 'like' | 'search' | 'close' | 'queue' | 'expand';

export type HotkeyEvent = {
  key: string;
  code?: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  target?: unknown;
  repeat?: boolean;
};

/** Поле ввода, в котором клавиши не должны перехватываться (Space в строке поиска — пробел, а не пауза). */
export function isTypingTarget(target: unknown): boolean {
  const element = target as { tagName?: string; isContentEditable?: boolean; closest?: (selector: string) => unknown } | null;
  if (!element || typeof element !== 'object') return false;
  const tag = String(element.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (element.isContentEditable) return true;
  return typeof element.closest === 'function' && Boolean(element.closest('[contenteditable="true"],[role="textbox"],.modal,[aria-modal="true"]'));
}

/** Возвращает действие, только если никто не держит Ctrl/Alt/Meta (кроме поиска) и клавиша не автоповторяется. */
export function matchHotkey(event: HotkeyEvent, options: { typing?: boolean } = {}): Hotkey | null {
  if (event.repeat) return null;
  const key = event.key;
  const typing = options.typing ?? isTypingTarget(event.target);
  const modifierFree = !event.ctrlKey && !event.metaKey && !event.altKey;

  if ((event.ctrlKey || event.metaKey) && !event.altKey && key.toLowerCase() === 'k') return 'search';
  if (key === 'Escape') return 'close';
  if (typing || !modifierFree) return null;

  switch (key) {
    case '/':
      return 'search';
    case ' ':
    case 'Spacebar':
      return 'play';
    case 'ArrowRight':
      return event.shiftKey ? 'next' : null;
    case 'ArrowLeft':
      return event.shiftKey ? 'previous' : null;
    default:
      break;
  }
  const letter = key.length === 1 ? key.toLowerCase() : '';
  if (letter === 'm') return 'mute';
  if (letter === 'l') return 'like';
  if (letter === 'q') return 'queue';
  if (letter === 'f') return 'expand';
  return null;
}

export const HOTKEY_LABELS: { keys: string; action: 'play' | 'next' | 'previous' | 'mute' | 'like' | 'search' | 'close' }[] = [
  { keys: 'Space', action: 'play' },
  { keys: 'Shift + ←/→', action: 'next' },
  { keys: 'M', action: 'mute' },
  { keys: 'L', action: 'like' },
  { keys: 'Ctrl/⌘ + K', action: 'search' },
  { keys: '/', action: 'search' },
  { keys: 'Esc', action: 'close' },
];
