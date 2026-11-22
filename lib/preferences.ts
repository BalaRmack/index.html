/**
 * Настройки Nocturne: один источник правды для онбординга, панели настроек и темы.
 * Всё валидируется на входе — localStorage и профиль Supabase считаются недоверенными.
 */
export const PREFERENCES_KEY = 'nocturne.preferences.v1';

export type Language = 'ru' | 'en';
export type Accent = 'nocturne' | 'violet' | 'amber' | 'ice';
export type GlassLevel = 'off' | 'soft' | 'full';
export type ParticlesMode = 'full' | 'eco' | 'off';
export type SidebarLayout = 'classic' | 'compact';
export type NowPlayingMode = 'auto' | 'manual' | 'left';
export type PlayerStyle = 'attached' | 'floating';
export type WaveMood = 'energetic' | 'calm' | 'unknown' | 'loved';

export type Preferences = {
  language: Language;
  accent: Accent;
  glass: GlassLevel;
  particles: ParticlesMode;
  sidebar: SidebarLayout;
  nowPlaying: NowPlayingMode;
  playerStyle: PlayerStyle;
  autoplayWave: boolean;
  crossfade: number;
  normalizeVolume: boolean;
  waveMood: WaveMood;
  genres: string[];
  artists: string[];
  onboardingCompleted: boolean;
};

export const DEFAULT_PREFERENCES: Preferences = {
  language: 'ru',
  accent: 'nocturne',
  glass: 'full',
  particles: 'full',
  sidebar: 'classic',
  nowPlaying: 'auto',
  playerStyle: 'floating',
  autoplayWave: false,
  crossfade: 0,
  normalizeVolume: true,
  waveMood: 'unknown',
  genres: [],
  artists: [],
  onboardingCompleted: false,
};

export const ACCENTS: Record<Accent, { label: string; labelEn: string; green: string; hi: string; ink: string; glow: string; deep: string }> = {
  nocturne: { label: 'Изумруд Nocturne', labelEn: 'Nocturne emerald', green: '#b7e49a', hi: '#d8f3c2', ink: '#16241a', glow: 'rgba(183,228,154,.18)', deep: '#12200f' },
  violet: { label: 'Глубокий фиолетовый', labelEn: 'Deep violet', green: '#c9b6ff', hi: '#e2d6ff', ink: '#1b1430', glow: 'rgba(201,182,255,.20)', deep: '#180f2c' },
  amber: { label: 'Тёплый янтарный', labelEn: 'Warm amber', green: '#f7d199', hi: '#ffe7c2', ink: '#2a1b06', glow: 'rgba(247,209,153,.18)', deep: '#261604' },
  ice: { label: 'Ледяной синий', labelEn: 'Ice blue', green: '#a9d8f2', hi: '#d3ecff', ink: '#0d2029', glow: 'rgba(169,216,242,.20)', deep: '#082031' },
};

export const GENRES: { id: string; ru: string; en: string; query: string }[] = [
  { id: 'pop', ru: 'Поп', en: 'Pop', query: 'pop hits' },
  { id: 'hiphop', ru: 'Рэп и хип-хоп', en: 'Rap & hip-hop', query: 'hip hop' },
  { id: 'rock', ru: 'Рок', en: 'Rock', query: 'rock' },
  { id: 'electronic', ru: 'Электроника', en: 'Electronic', query: 'electronic' },
  { id: 'indie', ru: 'Инди', en: 'Indie', query: 'indie' },
  { id: 'phonk', ru: 'Фонк', en: 'Phonk', query: 'phonk' },
  { id: 'lofi', ru: 'Лоу-фай', en: 'Lo-fi', query: 'lofi chill' },
  { id: 'rusianrock', ru: 'Русский рок', en: 'Russian rock', query: 'русский рок' },
  { id: 'russianpop', ru: 'Русская поп-сцена', en: 'Russian pop', query: 'русская поп музыка' },
  { id: 'jazz', ru: 'Джаз', en: 'Jazz', query: 'jazz' },
  { id: 'classical', ru: 'Классика', en: 'Classical', query: 'classical' },
  { id: 'metal', ru: 'Метал', en: 'Metal', query: 'metal' },
  { id: 'rapru', ru: 'Русский рэп', en: 'Russian rap', query: 'русский рэп' },
  { id: 'synthwave', ru: 'Синтвейв', en: 'Synthwave', query: 'synthwave' },
];

/** Быстрый выбор любимых артистов на шаге онбординга: русские и зарубежные сцены. */
export const ONBOARDING_ARTISTS = [
  'Кино', 'Земфира', 'Скриптонит', 'Мумий Тролль', 'Пошлая Молли', 'Zivert', 'АИГЕЛ', 'Макс Корж', 'Матранг', 'Дора',
  'The Weeknd', 'Arctic Monkeys', 'Dua Lipa', 'Tame Impala', 'Billie Eilish', 'Kavinsky', 'Woodkid', 'DVRST', 'Deftones', 'Fleetwood Mac',
] as const;

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

const numberIn = (value: unknown, allowed: readonly number[], fallback: number) =>
  typeof value === 'number' && allowed.includes(value) ? value : fallback;

const listOfStrings = (value: unknown, limit: number, maxLength = 60) =>
  Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim().slice(0, maxLength)))].slice(0, limit)
    : [];

/** Приводит любой внешний JSON к валидным настройкам. */
export function sanitizePreferences(raw: unknown): Preferences {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const genres = listOfStrings(value.genres, GENRES.length, 40).filter((genre) => GENRES.some((item) => item.id === genre));
  return {
    language: oneOf(value.language, ['ru', 'en'] as const, DEFAULT_PREFERENCES.language),
    accent: oneOf(value.accent, ['nocturne', 'violet', 'amber', 'ice'] as const, DEFAULT_PREFERENCES.accent),
    glass: oneOf(value.glass, ['off', 'soft', 'full'] as const, DEFAULT_PREFERENCES.glass),
    particles: oneOf(value.particles, ['full', 'eco', 'off'] as const, DEFAULT_PREFERENCES.particles),
    sidebar: oneOf(value.sidebar, ['classic', 'compact'] as const, DEFAULT_PREFERENCES.sidebar),
    nowPlaying: oneOf(value.nowPlaying, ['auto', 'manual', 'left'] as const, DEFAULT_PREFERENCES.nowPlaying),
    playerStyle: oneOf(value.playerStyle, ['attached', 'floating'] as const, DEFAULT_PREFERENCES.playerStyle),
    autoplayWave: typeof value.autoplayWave === 'boolean' ? value.autoplayWave : DEFAULT_PREFERENCES.autoplayWave,
    crossfade: numberIn(value.crossfade, [0, 3, 6, 12], DEFAULT_PREFERENCES.crossfade),
    normalizeVolume: typeof value.normalizeVolume === 'boolean' ? value.normalizeVolume : DEFAULT_PREFERENCES.normalizeVolume,
    waveMood: oneOf(value.waveMood, ['energetic', 'calm', 'unknown', 'loved'] as const, DEFAULT_PREFERENCES.waveMood),
    genres,
    artists: listOfStrings(value.artists, 12),
    onboardingCompleted: typeof value.onboardingCompleted === 'boolean' ? value.onboardingCompleted : DEFAULT_PREFERENCES.onboardingCompleted,
  };
}

export function readPreferences(): Preferences {
  try {
    const stored = localStorage.getItem(PREFERENCES_KEY);
    return sanitizePreferences(stored ? JSON.parse(stored) : null);
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function writePreferences(next: Preferences): boolean {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

/** Только пользовательские параметры: флаг онбординга и выбор вкуса едут в профиль Supabase. */
export function preferencesToProfile(next: Preferences) {
  return {
    language: next.language, accent: next.accent, glass: next.glass, particles: next.particles,
    sidebar: next.sidebar, nowPlaying: next.nowPlaying, playerStyle: next.playerStyle,
    autoplayWave: next.autoplayWave, crossfade: next.crossfade, normalizeVolume: next.normalizeVolume,
    waveMood: next.waveMood, genres: next.genres, artists: next.artists,
  };
}

/**
 * Тема — только CSS-переменные и data-атрибуты: никаких инлайновых стилей в компонентах,
 * чтобы анимации и media-запросы продолжали работать как раньше.
 */
export function applyPreferences(next: Preferences) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const accent = ACCENTS[next.accent] ?? ACCENTS.nocturne;
  root.style.setProperty('--green', accent.green);
  root.style.setProperty('--green-hi', accent.hi);
  root.style.setProperty('--green-ink', accent.ink);
  root.style.setProperty('--green-glow', accent.glow);
  root.style.setProperty('--green-deep', accent.deep);
  root.dataset.accent = next.accent;
  root.dataset.glass = next.glass;
  root.dataset.particles = next.particles;
  root.dataset.sidebar = next.sidebar;
  root.dataset.player = next.playerStyle;
  root.dataset.nowplaying = next.nowPlaying;
  root.lang = next.language;
}
