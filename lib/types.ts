import type { Preferences } from './preferences';
import type { Translate } from './i18n';

/** Общие типы приложения: страница, полки и панели работают с одними и теми же треками. */
export type Track = {
  id: string;
  title: string;
  artist: string;
  storage_path: string | null;
  owner_id?: string | null;
  source?: 'local' | 'youtube' | 'deezer' | 'jiosaavn';
  video_id?: string | null;
  external_id?: string | null;
  thumbnail?: string | null;
  duration?: number | null;
  album?: string | null;
  created_at?: string | null;
};

export type Playlist = { id: string; name: string; cover_url?: string | null; created_at?: string | null };

export type Shelves = {
  similar: Track[];
  recent: Track[];
  daily: Track[];
  trending: Track[];
  trendingFallback?: boolean;
  similarUnavailable?: boolean;
  editorialFallback?: boolean;
  freshFallback?: boolean;
};

export type ArtistInfoView = {
  name: string;
  picture: string | null;
  genres: string[];
  fans: number | null;
  albums: number | null;
  biography: string;
  wikiUrl: string | null;
  similar: { name: string; picture: string | null }[];
  tracks: Track[];
};

export type LyricLine = { time: number; text: string };

/**
 * Всё, что нужно панелям от плеера. Держим один тип, чтобы компоненты не зависели
 * от реализации страницы, а страница — от деталей реализации панелей.
 */
export type PlayerBindings = {
  t: Translate;
  prefs: Preferences;
  reduced: boolean;
  accent: string;
  current: Track | null;
  playing: boolean;
  loading: boolean;
  elapsed: number;
  duration: number;
  volume: number;
  queue: Track[];
  queueIndex: number;
  likes: string[];
  contextLabel: string;
  waveActive: boolean;
  analyser: AnalyserNode | null;
  onPlay: (track: Track, list?: Track[]) => void;
  onTogglePlay: () => void;
  onSkip: (direction: 1 | -1) => void;
  onSeek: (seconds: number) => void;
  onVolume: (volume: number) => void;
  onToggleLike: (track: Track) => void;
  onBlock: (track: Track) => void;
  onRadio: (track: Track) => void;
  onOpenArtist: (name: string) => void;
  onQueueMove: (from: number, to: number) => void;
  onQueueRemove: (index: number) => void;
  onWave: () => void;
};
