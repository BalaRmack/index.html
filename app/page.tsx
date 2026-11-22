'use client';
import { LayoutGroup } from 'framer-motion';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, MotionConfig, useReducedMotion } from 'framer-motion';
import { blockForTrack, isBlocked, mergeBlocks, readBlocks, validBlocks, writeBlocks, type Block } from '@/lib/blacklist';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import YouTubePlayer, { type YouTubePlayerHandle } from '@/components/YouTubePlayer';
import { SHELF_TIMEOUT_MS, freshPool, freshShelves, shelvesAreEmpty, topUpShelves, withTimeout } from '@/lib/fresh-picks';
import { advanceListening, shouldRecordSkip } from '@/lib/listening';
import { guestLikes, saveGuestSignal, setGuestLike, waveHistory } from '@/lib/guest-history';
import { formatAddedDate, formatDuration, formatRemaining } from '@/lib/format';
import { ACCENTS, DEFAULT_PREFERENCES, applyPreferences, preferencesToProfile, readPreferences, sanitizePreferences, writePreferences, type Preferences } from '@/lib/preferences';
import { makeTranslate, type Translate, type TranslationKey } from '@/lib/i18n';
import { appendQueue, moveInQueue, resolveNextIndex } from '@/lib/queue';
import { createEmbedFallback, embedSubstituteFor, failEmbedSubstitute, readEmbedCache, rememberEmbedSubstitute, type EmbedCache, type EmbedFallback } from '@/lib/embed-fallback';
import { sanitizeSleepTimer, sleepEndOfTrack, sleepExpired, sleepMinutes, sleepMultiplier, secondsLeft, type SleepTimer } from '@/lib/sleep-timer';
import { fadeInGain, fadeOutGain, resolveVolume } from '@/lib/fade';
import { createPlaylist as addGuestPlaylist, readGuestPlaylists, removePlaylist as dropGuestPlaylist, renamePlaylist as renameGuestPlaylist, setPlaylistCover, toggleTrackInPlaylist, tracksInPlaylist, writeGuestPlaylists } from '@/lib/guest-playlists';
import { makeCoverDataUrl } from '@/lib/cover';
import { isTypingTarget, matchHotkey } from '@/lib/hotkeys';
import type { PlayerBindings, Playlist, Shelves, Track } from '@/lib/types';
import EmailOtpForm from '@/components/EmailOtpForm';
import OnboardingWizard from '@/components/OnboardingWizard';
import NowPlayingPanel from '@/components/NowPlayingPanel';
import QueuePanel from '@/components/QueuePanel';
import SettingsPanel from '@/components/SettingsPanel';
import FullscreenPlayer from '@/components/FullscreenPlayer';
import ArtistView from '@/components/ArtistView';
import WaveVisualizer from '@/components/WaveVisualizer';
import TrackTable from '@/components/TrackTable';
import { BlockButton, ImpulseButton, LikeButton, PlayPauseButton, VolumeButton } from '@/components/MotionButtons';
import { ArrowLeft, ArrowRight, AudioLines, Ban, Clock3, Heart, Home, LayoutList, Library, ListMusic, ListVideo, Moon, Music2, Play, Plus, Radio, Repeat2, RotateCcw, Search, Settings, Shuffle, SkipBack, SkipForward, SquarePlay, Timer, Upload, X, PanelRight, Plus as PlusIcon } from 'lucide-react';
import Presence from '../components/Presence';

const spring = { type: 'spring' as const, stiffness: 350, damping: 30 };
const SLEEP_KEY = 'nocturne.sleep.v1';
const format = formatDuration;
const canonical = (id: string) => (/^(yt|dz|js):[A-Za-z0-9_-]+:/.test(id) ? id.split(':').slice(0, 2).join(':') : id);
const imageFor = (t: Track) => (t.video_id ? `https://i.ytimg.com/vi/${t.video_id}/mqdefault.jpg` : t.thumbnail || '/images/hero.png');
const fromDb = (t: Track): Track => (t.video_id ? { ...t, id: `yt:${t.video_id}`, thumbnail: `https://i.ytimg.com/vi/${t.video_id}/mqdefault.jpg` } : t.external_id ? { ...t, id: `${t.source === 'deezer' ? 'dz' : 'js'}:${t.external_id}` } : t);
const unique = (ts: Track[]) => { const seen = new Set<string>(); return ts.filter((t) => !seen.has(t.id) && !!seen.add(t.id)); };
const readSleep = (): SleepTimer => { try { return typeof localStorage === 'undefined' ? { kind: 'off' } : sanitizeSleepTimer(JSON.parse(localStorage.getItem(SLEEP_KEY) || 'null')); } catch { return { kind: 'off' }; } };

export default function HomePage() {
  const reducedMotion = !!useReducedMotion();
  /**
   * Настройки читаются синхронно: тема должна быть применена до первой отрисовки,
   * иначе между серверным HTML и React видна смена палитры.
   */
  const [prefs, setPrefs] = useState<Preferences>(() => (typeof window === 'undefined' ? DEFAULT_PREFERENCES : readPreferences()));
  const t = useMemo(() => makeTranslate(prefs.language), [prefs.language]);
  const prefsRef = useRef(prefs); prefsRef.current = prefs;
  const tRef = useRef(t); tRef.current = t;
  const say = useCallback((key: TranslationKey, vars?: Record<string, string | number>) => setNotice(tRef.current(key, vars)), []);

  const [user, setUser] = useState<User | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [likes, setLikes] = useState<string[]>([]);
  const [playlistIds, setPlaylistIds] = useState<string[]>([]);
  const [view, setView] = useState('home');
  const [artist, setArtist] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchSource, setSearchSource] = useState<'youtube' | 'deezer' | 'jiosaavn'>('youtube');
  const [soundcloudUrl, setSoundcloudUrl] = useState<string | null>(null);
  const [results, setResults] = useState<Track[]>([]);
  const [searchStatus, setSearchStatus] = useState('');
  const [shelves, setShelves] = useState<Shelves>({ similar: [], recent: [], daily: [], trending: [] });
  const [shelvesLoading, setShelvesLoading] = useState(true);
  const [shelfNote, setShelfNote] = useState('');
  const shelfFilled = useRef(false);
  const [shelfLive, setShelfLive] = useState(false);
  const [refreshShelves, setRefreshShelves] = useState(0);
  const [current, setCurrent] = useState<Track | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(70);
  useEffect(() => { try { const raw = localStorage.getItem('nocturne.volume.v1'); if (raw !== null) { const v = Number(raw); if (Number.isFinite(v) && v >= 0 && v <= 100) { volumeRef.current = v; mutedRef.current = v === 0; setVolume(v); setMuted(v === 0); applyLevel(); } } } catch {} }, []);
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [waveLoading, setWaveLoading] = useState(false);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [blocksReady, setBlocksReady] = useState(false);
  const blocksRef = useRef<Block[]>([]);
  const [lastBlocked, setLastBlocked] = useState<Block | null>(null);
  const blockWrite = useRef<Promise<unknown> | null>(null);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [playlistName, setPlaylistName] = useState('');
  const [playlistEdit, setPlaylistEdit] = useState<Playlist | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [panel, setPanel] = useState<'now' | 'queue' | 'settings' | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [expandOrigin, setExpandOrigin] = useState<{ x: number; y: number } | null>(null);
  const [wizard, setWizard] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [sleep, setSleep] = useState<SleepTimer>(() => readSleep());
  const [sleepLeft, setSleepLeft] = useState<number | null>(null);
  const [installPrompt, setInstallPrompt] = useState<{ prompt: () => Promise<void> } | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const yt = useRef<YouTubePlayerHandle | null>(null);
  const [youtubeActive, setYoutubeActive] = useState(false);
  const [ytMiniWindow, setYtMiniWindow] = useState(false);
  /**
   * Обход запрета на встраивание. У официального клипа правообладатель часто закрывает embed,
   * и YouTube отдаёт 101/150 (или 100). Тогда не показываем ошибку и не останавливаем очередь,
   * а молча пробуем разрешённую версию того же трека — до MAX_EMBED_ATTEMPTS штук. Тот, который
   * реально заиграл, запоминается в localStorage, так что повторный старт идёт без проб.
   */
  const embedCache = useRef<EmbedCache | null>(null);
  if (embedCache.current === null) embedCache.current = readEmbedCache(typeof window === 'undefined' ? null : window.localStorage);
  const embedStore = () => (typeof window === 'undefined' ? null : window.localStorage);
  /** Колбэк машины живёт в ref: на каждый рендер он должен видеть свежие skip/say, а не первый. */
  const embedGiveUp = useRef<{ onExhausted: () => void }>({ onExhausted: () => { } });
  const embed: EmbedFallback = useMemo(() => createEmbedFallback({
    search: async (query) => {
      // Потолок на один запрос: зависшее зеркало не должно удерживать загрузку дольше общего бюджета проб.
      const response = await fetch(`/api/catalog/search?q=${encodeURIComponent(query)}`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('catalog unavailable');
      return response.json();
    },
    load: (videoId) => { yt.current?.load(videoId); },
    resolve: (videoId) => embedSubstituteFor(embedCache.current || {}, videoId),
    remember: (blocked, candidate) => { embedCache.current = rememberEmbedSubstitute(embedCache.current || {}, blocked, candidate, embedStore()); },
    invalidate: (blocked) => { embedCache.current = failEmbedSubstitute(embedCache.current || {}, blocked, embedStore()); },
    onExhausted: () => embedGiveUp.current.onExhausted(),
  }), []);
  const ctx = useRef<AudioContext | null>(null);
  const gain = useRef<GainNode | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const coverInput = useRef<HTMLInputElement | null>(null);
  const currentRef = useRef<Track | null>(null);
  const volumeRef = useRef(volume); volumeRef.current = volume;
  const mutedRef = useRef(muted); mutedRef.current = muted;
  const restoreVolume = useRef(70);
  const remoteRef = useRef(false);
  const sleepRef = useRef(1);
  const fadeRef = useRef(1);
  const queue = useRef<Track[]>([]);
  const queueIndex = useRef(0);
  const [queueList, setQueueList] = useState<Track[]>([]);
  const [queueAt, setQueueAt] = useState(0);
  const playedIds = useRef<string[]>([]);
  const requestSeq = useRef(0);
  const radioRequest = useRef(false);
  const waveMode = useRef(false);
  const playback = useRef({ seconds: 0, last: 0, completed: false, started: false });
  const listenRecorded = useRef(false);
  const panelRef = useRef(panel); panelRef.current = panel;
  const wizardRef = useRef(wizard); wizardRef.current = wizard;
  const sleepStopRef = useRef(false);
  const sleepTrackRemaining = useRef(0);

  const setQueue = useCallback((list: Track[], index: number) => {
    queue.current = list;
    queueIndex.current = index;
    setQueueList(list);
    setQueueAt(index);
  }, []);

  /** Громкость = пользователь × нормализация × фейд-ин/out × таймер сна. Один источник правды. */
  const applyLevel = useCallback(() => {
    const level = resolveVolume({
      volume: mutedRef.current ? 0 : volumeRef.current,
      normalize: prefsRef.current.normalizeVolume,
      remote: remoteRef.current,
      fade: sleepRef.current * fadeRef.current,
    });
    if (gain.current) gain.current.gain.value = level;
    if (audio.current) audio.current.volume = level;
    yt.current?.volume(Math.round(level * 100));
  }, []);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => {
    const stored = readPreferences();
    setPrefs((prev) => (prev === stored ? prev : stored));
  }, []);
  /** Тема и раскладка применяются из одного места — все компоненты читают CSS-переменные. */
  useEffect(() => {
    applyPreferences(prefs);
    writePreferences(prefs);
  }, [prefs]);
  useEffect(() => {
    if (!supabase || !user) return;
    let alive = true;
    void (async () => {
      const outcome = await withTimeout(supabase.from('profiles').select('display_name,preferences,onboarding_completed').eq('user_id', user.id).maybeSingle(), 2600, null);
      if (!alive) return;
      const row = outcome?.data as { display_name: string | null; preferences: unknown; onboarding_completed: boolean } | null;
      if (row) {
        const source = row.preferences && typeof row.preferences === 'object' ? row.preferences : {};
        const remote = sanitizePreferences({ ...source, onboardingCompleted: Boolean(row.onboarding_completed) });
        setPrefs((prev) => ({ ...remote, genres: prev.genres.length ? prev.genres : remote.genres, artists: prev.artists.length ? prev.artists : remote.artists, onboardingCompleted: prev.onboardingCompleted || remote.onboardingCompleted }));
        setProfileName(typeof row.display_name === 'string' ? row.display_name : '');
      } else {
        await withTimeout(supabase.from('profiles').upsert({ user_id: user.id, display_name: user.email?.split('@')[0] ?? null, preferences: preferencesToProfile(prefsRef.current), onboarding_completed: prefsRef.current.onboardingCompleted }, { onConflict: 'user_id' }), 2600, null);
      }
    })();
    return () => { alive = false; };
  }, [user]);
  // Изменения настроек уходят в профиль пачкой, а не на каждый клик.
  useEffect(() => {
    if (!supabase || !user) return;
    const db = supabase;
    const id = setTimeout(() => { void db.from('profiles').update({ preferences: preferencesToProfile(prefs), onboarding_completed: prefs.onboardingCompleted, updated_at: new Date().toISOString() }).eq('user_id', user.id); }, 700);
    return () => clearTimeout(id);
  }, [prefs, user]);
  // Мастер показывается один раз: флаг живёт и в localStorage, и в профиле.
  useEffect(() => { if (!prefs.onboardingCompleted) setWizard(true); }, [prefs.onboardingCompleted]);
  useEffect(() => {
    let cancelled = false; const local = readBlocks(); blocksRef.current = local; setBlocks(local); setBlocksReady(!user);
    if (!user || !supabase) return;
    // Чёрный список не имеет права закрывать блок подборок: через 4 секунды работаем с блокировками этого браузера.
    const deadline = setTimeout(() => { if (cancelled) return; cancelled = true; setBlocksReady(true); setShelfNote(t('blocksTimeoutNote')); }, SHELF_TIMEOUT_MS);
    async function loadBlocks() {
      const rows: Block[] = [];
      for (let start = 0; ; start += 1000) {
        const result = await supabase!.from('recommendation_blocks').select('kind,track_id,video_id,title,artist').eq('user_id', user!.id).order('kind').order('track_id').range(start, start + 999);
        if (cancelled) return;
        // Ошибка не должна оставлять блокировку загрузки включённой навсегда: переходим на локальные блокировки.
        if (result.error) { say('noticeBlocksFailed'); break; }
        const batch = validBlocks(result.data); if (batch.length !== result.data.length) { say('noticeBlocksFailed'); break; }
        rows.push(...batch); if (result.data.length < 1000) break;
      }
      if (cancelled) return;
      const merged = mergeBlocks(blocksRef.current, rows); blocksRef.current = merged; setBlocks(merged); setBlocksReady(true);
    }
    void loadBlocks().finally(() => clearTimeout(deadline)); return () => { cancelled = true; clearTimeout(deadline); };
  }, [user, say]);
  /**
   * Горячие клавиши: сопоставлением занимается чистый lib/hotkeys,
   * здесь только действие. В полях ввода и модальных окнах клавиши не перехватываются.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = matchHotkey(event, { typing: isTypingTarget(event.target) });
      if (!action) return;
      if (action === 'search') { event.preventDefault(); setSearchOpen(true); return; }
      if (action === 'close') { setSearchOpen(false); setPlaylistOpen(false); setPlaylistEdit(null); if (!wizardRef.current) { setAuthOpen(false); setFullscreen(false); setPanel(null); } return; }
      if (wizardRef.current || authRef.current || searchRef.current) return;
      event.preventDefault();
      switch (action) {
        case 'play': void playRef.current(); break;
        case 'next': void skipRef.current(1); break;
        case 'previous': void skipRef.current(-1); break;
        case 'mute': toggleMute(); break;
        case 'like': if (currentRef.current) void toggleLikeRef.current(currentRef.current); break;
        case 'queue': setPanel((prev) => (prev === 'queue' ? null : 'queue')); break;
        case 'expand': if (currentRef.current) setFullscreen((prev) => !prev); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const authRef = useRef(authOpen); authRef.current = authOpen;
  const searchRef = useRef(searchOpen); searchRef.current = searchOpen;
  const playRef = useRef<() => void>(() => { });
  const skipRef = useRef<(direction: 1 | -1) => Promise<void>>(async () => { });
  const toggleLikeRef = useRef<(track: Track) => Promise<void>>(async () => { });
  useEffect(() => {
    const onPrompt = (event: Event) => { event.preventDefault(); setInstallPrompt(event as unknown as { prompt: () => Promise<void> }); };
    const onInstalled = () => setInstallPrompt(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, []);
  useEffect(() => {
    if (!supabase || !user) {
      const saved = guestLikes();
      setTracks(saved); setPlaylists(readGuestPlaylists()); setLikes(saved.map((x) => x.id)); setPlaylistIds([]);
      return;
    }
    const db = supabase;
    Promise.all([
      db.from('tracks').select('*').order('created_at', { ascending: false }),
      db.from('playlists').select('id,name,cover_url,created_at').order('created_at', { ascending: false }),
      db.from('likes').select('track_id'),
    ]).then(([tr, pl, lk]) => {
      if (tr.data) setTracks((tr.data as Track[]).map(fromDb));
      if (pl.data) setPlaylists(pl.data as Playlist[]);
      if (lk.data) setLikes(lk.data.map((x: { track_id: string }) => canonical(x.track_id)));
      if (tr.error || pl.error || lk.error) say('noticeLibraryFailed');
    });
  }, [user, say]);
  useEffect(() => {
    if (!supabase || !user || !view.startsWith('playlist:')) { setPlaylistIds(tracksInPlaylist(readGuestPlaylists(), view.startsWith('playlist:') ? view.slice(9) : null)); return; }
    supabase.from('playlist_tracks').select('track_id').eq('playlist_id', view.slice(9)).then(({ data, error }) => { if (data) setPlaylistIds(data.map((x: { track_id: string }) => canonical(x.track_id))); if (error) say(error.message as TranslationKey); });
  }, [view, user, say]);
  useEffect(() => {
    const query = search.trim();
    if (query.length < 2) { setResults([]); setSearchStatus(query ? t('searchMin') : ''); return; }
    const controller = new AbortController(); setSearchStatus(t('searching'));
    const path = searchSource === 'youtube' ? `/api/catalog/search?q=${encodeURIComponent(query)}` : `/api/catalog/alternative/search?source=${searchSource}&q=${encodeURIComponent(query)}`;
    const timer = setTimeout(() => {
      void fetch(path, { signal: controller.signal }).then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); setResults(d.tracks); setSearchStatus(d.tracks.length ? '' : t('nothingFound')); }).catch((e) => { if (e.name !== 'AbortError') { setResults([]); setSearchStatus(t('catalogUnavailable')); } });
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search, searchSource, t]);
  useEffect(() => { shelfFilled.current = false; setShelves({ similar: [], recent: [], daily: [], trending: [] }); }, [user?.id]);
  /**
   * Блок «Откройте что-то новое» обязан показаться.
   * 1) Один AbortController на весь запрос; жёсткий дедлайн 4 секунды.
   * 2) Таймаут не полагается на то, что fetch поддержит abort — он сам подставляет свежие миксы.
   * 3) Пустой ответ (все полки пустые) = тот же путь, что и таймаут.
   * 4) Состояние загрузки снимается в finally при любом исходе, включая ошибку.
   */
  useEffect(() => {
    let disposed = false, settled = false;
    const controller = new AbortController();
    const commit = (next: Shelves, note = '') => { if (disposed || settled) return; settled = true; shelfFilled.current = [next.similar, next.recent, next.daily, next.trending].some((list) => list.length > 0); setShelves(next); setShelfNote(note); };
    const timer = setTimeout(() => {
      controller.abort();
      setShelfLive(false);
      commit(freshShelves(), t('freshTimeoutNote'));
    }, SHELF_TIMEOUT_MS);
    setShelvesLoading(true);
    async function load() {
      try {
        // getSession() тоже может зависнуть (заблокированное хранилище браузера), поэтому он под тем же лимитом.
        const session = await withTimeout(supabase?.auth.getSession(), SHELF_TIMEOUT_MS, null);
        const token = session?.data.session?.access_token;
        const taste = { artists: prefsRef.current.artists, genres: prefsRef.current.genres };
        const r = await fetch('/api/recommendations?mode=home', { method: 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify({ blocks: blocksRef.current, taste }), signal: controller.signal });
        const data = await r.json(); if (!r.ok) throw new Error(data?.error);
        if (![data.similar, data.recent, data.daily, data.trending].some(Array.isArray)) throw new Error('Invalid shelves');
        const next: Shelves = { similar: Array.isArray(data.similar) ? data.similar : [], recent: Array.isArray(data.recent) ? data.recent : [], daily: Array.isArray(data.daily) ? data.daily : [], trending: Array.isArray(data.trending) ? data.trending : [] , trendingFallback: Boolean(data.trendingFallback), editorialFallback: Boolean(data.editorialFallback), freshFallback: Boolean(data.freshFallback), similarUnavailable: Boolean(data.similarUnavailable) };
        // API ответил пустыми массивами — мгновенно подставляем свежие подборки вместо пустого блока.
        if (shelvesAreEmpty(next)) throw new Error('empty shelves');
        topUpShelves(next, freshPool(), 4);
        setShelfLive(true);
        commit(next, data.freshFallback || data.editorialFallback ? t('freshPartialNote') : '');
      } catch {
        setShelfLive(false);
        commit(freshShelves(), t('freshNote'));
      } finally {
        clearTimeout(timer);
        if (!disposed) setShelvesLoading(false);
      }
    }
    void load(); return () => { disposed = true; clearTimeout(timer); controller.abort(); };
  }, [user, refreshShelves, prefs.artists.join('|'), prefs.genres.join('|'), t]);
  useEffect(() => { yt.current?.cue(!shuffle ? embed.playbackId(queue.current[queueIndex.current + 1]?.video_id) || null : null); }, [shuffle, youtubeActive, embed]);
  useEffect(() => { applyLevel(); try { localStorage.setItem('nocturne.volume.v1', String(volume)); } catch {} }, [volume, muted, applyLevel]);
  useEffect(() => { applyLevel(); }, [prefs.normalizeVolume, applyLevel]);
  // Кроссфейд: трек плавно вступает, а перед концом так же плавно уходит в тишину.
  useEffect(() => {
    const seconds = prefs.crossfade;
    if (!seconds || !playing || !current) { fadeRef.current = 1; return; }
    const startedAt = performance.now();
    const id = setInterval(() => {
      const value = fadeInGain((performance.now() - startedAt) / 1000, seconds);
      fadeRef.current = value; applyLevel();
      if (value >= 1) clearInterval(id);
    }, 60);
    return () => clearInterval(id);
  }, [current?.id, playing, prefs.crossfade, applyLevel]);
  useEffect(() => {
    if (sleep.kind === 'off') { sleepRef.current = 1; setSleepLeft(null); applyLevel(); return; }
    const tick = () => {
      if (sleep.kind !== 'minutes') return;
      const left = secondsLeft(sleep) ?? 0;
      setSleepLeft(left);
      const factor = sleepMultiplier(sleep);
      if (Math.abs(factor - sleepRef.current) > 0.001) { sleepRef.current = factor; applyLevel(); }
      if (sleepExpired(sleep)) {
        sleepRef.current = 1; applyLevel(); setSleep({ kind: 'off' }); setSleepLeft(null);
        mediaActions.current.pause(); say('sleepFading');
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sleep, applyLevel, say]);
  useEffect(() => {
    try { localStorage.setItem(SLEEP_KEY, JSON.stringify(sleep)); } catch { /* приватный режим */ }
  }, [sleep]);
  // «Сейчас играет» раскрывается сам, если это выбрано в настройках и экран достаточно широкий.
  useEffect(() => {
    if (!playing || prefs.nowPlaying === 'manual' || panelRef.current) return;
    if (typeof window !== 'undefined' && window.innerWidth <= 980) return;
    setPanel('now');
  }, [current?.id, playing, prefs.nowPlaying]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => { setNotice(''); setLastBlocked(null); }, 4500);
    return () => clearTimeout(id);
  }, [notice]);
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get('view');
    if (v === 'liked') setView('liked');
    else if (v === 'wave') void startWave();
  }, []);
  useEffect(() => () => { ++requestSeq.current; audio.current?.pause(); void ctx.current?.close(); }, []);

  async function authHeaders() { const session = await supabase?.auth.getSession(); const token = session?.data.session?.access_token; return token ? { Authorization: `Bearer ${token}` } : undefined; }
  async function logSignal(track: Track, event_type: 'like' | 'playlist_add' | 'complete' | 'skip' | 'listen', seconds = 0) {
    if (!user || !supabase) { if (!saveGuestSignal(track, event_type)) say('noticeGuestHistory'); return; }
    const { error } = await supabase.from('listening_history').insert({ user_id: user.id, track_id: track.id, video_id: track.video_id || null, title: track.title.slice(0, 300), artist: track.artist.slice(0, 200), event_type, listened_seconds: Math.max(0, Math.floor(seconds)) });
    if (error) say('noticeHistoryFailed');
    else if (event_type !== 'skip' && event_type !== 'listen') setRefreshShelves((x) => x + 1);
  }
  function recordSwitch() { const p = playback.current; if (shouldRecordSkip(p) && currentRef.current) void logSignal(currentRef.current, 'skip', p.seconds); }
  function recordListen() { if (!listenRecorded.current && playback.current.seconds >= 5 && currentRef.current) { listenRecorded.current = true; void logSignal(currentRef.current, 'listen', playback.current.seconds); } }
  function onTime(time: number) {
    const p = playback.current; const player = audio.current; setElapsed(time);
    const total = Number(player?.duration) || durationRef.current;
    if (prefsRef.current.crossfade > 0 && total > 0) {
      const remaining = total - time;
      fadeRef.current = remaining > 0 && remaining <= prefsRef.current.crossfade ? fadeOutGain(remaining, prefsRef.current.crossfade) : 1;
      applyLevel();
    }
    if (advanceListening(p, time, total, !!player && !player.paused, !!player?.seeking) && currentRef.current) void logSignal(currentRef.current, 'complete', p.seconds);
    recordListen();
  }
  const durationRef = useRef(0); durationRef.current = duration;
  function initAudio(remote: boolean) {
    const existing = audio.current;
    // A cross-origin media source routed through Web Audio is silent without CORS.
    // Remote media therefore uses native HTMLAudio; local audio keeps the Web Audio gain path.
    if (existing && Boolean(existing.dataset.remote) === remote) return existing;
    if (existing) { existing.pause(); existing.removeAttribute('src'); existing.load(); }
    const player = new Audio(); player.preload = 'auto';
    if (remote) { player.dataset.remote = '1'; player.volume = volumeRef.current / 100; gain.current = null; analyser.current = null; }
    else {
      if (!ctx.current) ctx.current = new AudioContext();
      const source = ctx.current.createMediaElementSource(player);
      gain.current = ctx.current.createGain(); gain.current.gain.value = volumeRef.current / 100;
      // Анализатор нужен визуализации: он только читает данные, звук не меняет.
      const meter = ctx.current.createAnalyser(); meter.fftSize = 256; meter.smoothingTimeConstant = 0.72;
      source.connect(gain.current).connect(meter).connect(ctx.current.destination);
      analyser.current = meter;
    }
    audio.current = player; return player;
  }
  async function playTrack(track: Track, list?: Track[], force = false) {
    let seq = requestSeq.current;
    try {
      if (track.video_id && currentRef.current?.id === track.id && youtubeActive && !force && !soundcloudUrl) { if (playing) yt.current?.pause(); else yt.current?.play(); return; }
      const same = !soundcloudUrl && !track.video_id && currentRef.current?.id === track.id && audio.current?.src;
      if (same && !force && !loading) {
        if (audio.current!.paused) { if (ctx.current && !track.video_id) await ctx.current.resume(); await audio.current!.play(); playback.current.started = true; setPlaying(true); } else { audio.current!.pause(); setPlaying(false); } return;
      }
      if (playback.current.started && currentRef.current?.id !== track.id) recordSwitch();
      seq = ++requestSeq.current; setYtMiniWindow(false); if (!track.video_id) { embed.cancel(); yt.current?.stop(); } audio.current?.pause(); setSoundcloudUrl(null);
      if (list && list.length) { waveMode.current = false; setQueue(list, Math.max(0, list.findIndex((x) => x.id === track.id))); }
      if (track.video_id && !playedIds.current.includes(track.video_id)) playedIds.current.push(track.video_id);
      playback.current = { seconds: 0, last: 0, completed: false, started: false }; listenRecorded.current = false;
      remoteRef.current = Boolean(track.video_id || track.external_id);
      sleepStopRef.current = sleep.kind === 'track';
      setCurrent(track); currentRef.current = track; setElapsed(0); setDuration(0); setPlaying(false); setLoading(true);
      fadeRef.current = 1; applyLevel();
      if (track.video_id) {
        // begin() возвращает id, которым надо играть: оригинал или уже проверенную замену из кэша.
        setYoutubeActive(true);
        yt.current?.load(embed.begin(track) || track.video_id);
        yt.current?.cue(!shuffle ? embed.playbackId(queue.current[queueIndex.current + 1]?.video_id) || null : null);
        return;
      }
      setYoutubeActive(false);
      const remote = Boolean(track.external_id); const player = initAudio(remote); player.pause(); player.removeAttribute('src'); player.load();
      {
        let url: string | null = null;
        if (track.external_id && (track.source === 'deezer' || track.source === 'jiosaavn')) { const response = await fetch(`/api/catalog/alternative/stream?source=${track.source}&id=${encodeURIComponent(track.external_id)}`); const data = await response.json(); if (!response.ok) throw new Error(data.error || tRef.current('noticeTrackUnavailable')); url = data.url; }
        if (track.storage_path) { if (!supabase) throw new Error(tRef.current('authSupabaseMissing')); const { data, error } = await supabase.storage.from('audio').createSignedUrl(track.storage_path, 3600); if (error || !data) throw new Error(error?.message || tRef.current('noticeAudioFailed')); url = data.signedUrl; }
        // Без источника играть нечего: демо-файл в плеере больше не звучит никогда.
        if (!url) throw new Error(tRef.current('noticeTrackUnavailable'));
        if (seq !== requestSeq.current) return; player.src = url; if (!remote) await ctx.current?.resume(); await player.play(); if (seq !== requestSeq.current) return; playback.current.started = true; setPlaying(true); setLoading(false); applyLevel();
      }
    } catch (e) { if (seq === requestSeq.current) { audio.current?.removeAttribute('src'); setPlaying(false); setLoading(false); setNotice(e instanceof Error ? e.message : tRef.current('noticePlaybackError')); } }
  }
  async function moreRadio(seed: Track) {
    if (!seed.video_id) { say('noticeRadioOnlyCatalog'); return []; }
    const headers = await authHeaders();
    const p = new URLSearchParams({ mode: 'radio', seed: seed.video_id, artist: seed.artist, seen: playedIds.current.slice(-100).join(',') });
    const r = await fetch(`/api/recommendations?${p}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ blocks: blocksRef.current, taste: { artists: prefsRef.current.artists, genres: prefsRef.current.genres } }) });
    const data = await r.json(); if (!r.ok) throw new Error(data.error || tRef.current('noticeRadioUnavailable'));
    return (data.tracks as Track[]).filter((x) => !isBlocked(x, blocksRef.current));
  }
  async function moreWave() {
    const headers = await authHeaders();
    const body = { ...waveHistory(), blocks: blocksRef.current, seen: playedIds.current.slice(-100), taste: { artists: prefsRef.current.artists, genres: prefsRef.current.genres } };
    const response = await fetch('/api/recommendations?mode=wave', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || tRef.current('noticeSourcesDown'));
    if (!Array.isArray(data.tracks)) throw new Error(tRef.current('noticeSourcesDown'));
    return { ...data, tracks: data.tracks.filter((x: Track) => !isBlocked(x, blocksRef.current)) } as { tracks: Track[]; editorialFallback?: boolean; emptyReason?: string };
  }
  async function startWave() {
    if (waveLoading) return;
    if (!blocksReady) { say('noticeBlocksLoading'); return; }
    const seq = ++requestSeq.current; setWaveLoading(true); say('noticePreparingWave');
    try {
      const result = await moreWave();
      if (seq !== requestSeq.current) return;
      if (!result.tracks.length) throw new Error(result.emptyReason || tRef.current('noticeNoSimilar'));
      waveMode.current = true;
      void playTrack(result.tracks[0], result.tracks, true);
      setNotice(result.editorialFallback ? tRef.current('noticeWaveFallback') : tRef.current('noticeWave'));
    } catch (e) { if (seq === requestSeq.current) setNotice(e instanceof Error ? e.message : tRef.current('noticeWave')); } finally { setWaveLoading(false); }
  }
  async function skip(direction: number, automatic = false) {
    if (!automatic) recordSwitch();
    const list0 = queue.current;
    const currentItem = list0[queueIndex.current] || currentRef.current;
    const list = list0.filter((x) => x === currentItem || !isBlocked(x, blocksRef.current));
    const at = Math.max(0, list.indexOf(currentItem as Track));
    setQueue(list, at);
    const picked = shuffle && !waveMode.current && direction > 0 && list.length > 1
      ? resolveNextIndex({ length: list.length, index: at, direction: direction > 0 ? 1 : -1, shuffle: true }).index
      : at + direction;
    let next = picked < 0 ? 0 : picked;
    if (next === at && currentItem && isBlocked(currentItem, blocksRef.current)) next = list.length;
    if (next < list.length) { setQueue(list, next); playback.current.started = false; void playTrack(list[next], undefined, true); return; }
    if (currentRef.current?.video_id) {
      if (!blocksReady) { say('noticeBlocksLoading'); return; }
      if (radioRequest.current) return; radioRequest.current = true; const seq = requestSeq.current; audio.current?.pause(); yt.current?.pause(); playback.current.started = false; setPlaying(false); setLoading(true);
      try {
        const result = waveMode.current ? await moreWave() : { tracks: await moreRadio(currentRef.current) };
        const more = result.tracks.filter((x) => x.id !== currentRef.current?.id);
        if (seq !== requestSeq.current) return;
        if (!more.length) { setLoading(false); setPlaying(false); say('noticeNoSimilar'); return; }
        const merged = appendQueue(list, more);
        setQueue(merged.items, list.length);
        playback.current.started = false; void playTrack(more[0], undefined, true);
      } catch (e) { if (seq === requestSeq.current) { setLoading(false); setPlaying(false); setNotice(e instanceof Error ? e.message : tRef.current('noticeRadioUnavailable')); } } finally { radioRequest.current = false; }
      return;
    }
    // «Моя волна» из настроек: очередь без конца, пока пользователь не поставил паузу.
    if (direction > 0 && prefsRef.current.autoplayWave && currentRef.current) { void startWave(); return; }
    setPlaying(false); say('noticeQueueEnd');
  }
  // Все варианты тоже закрыты: одна короткая строка вместо ошибки и уходим на следующий трек.
  embedGiveUp.current.onExhausted = async () => {
    const failed = currentRef.current;
    if (!failed) { say('noticeEmbedFallback'); void skip(1, true); return; }
    try {
      const q = encodeURIComponent(`${failed.artist || ''} ${failed.title}`.trim());
      const res = await fetch(`/api/catalog/alternative/search?source=deezer&q=${q}`);
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data?.tracks) ? data.tracks : [];
        const tLow = failed.title.toLowerCase();
        const aLow = (failed.artist || '').toLowerCase();
        const dz = list.find((c: Track) => c.external_id && c.title.toLowerCase().includes(tLow) && (!aLow || c.artist.toLowerCase().includes(aLow)));
        if (dz?.external_id && currentRef.current) {
          void playTrack({ ...currentRef.current, video_id: null, source: 'deezer', external_id: dz.external_id, duration: dz.duration || 30 }, undefined, true);
          return;
        }
      }
    } catch {}
    say('noticeEmbedFallback');
    void skip(1, true);
  };
  const mediaActions = useRef({ play: () => { }, pause: () => { }, nexttrack: () => { }, previoustrack: () => { } });
  mediaActions.current = {
    play: () => { if (soundcloudUrl) return; const track = currentRef.current; if (!track) return; if (track.video_id && youtubeActive) yt.current?.play(); else if (!playing) void playTrack(track); },
    pause: () => { if (soundcloudUrl) return; if (currentRef.current?.video_id && youtubeActive) yt.current?.pause(); else { audio.current?.pause(); setPlaying(false); } },
    nexttrack: () => { if (!soundcloudUrl) void skip(1); },
    previoustrack: () => { if (!soundcloudUrl) void skip(-1); },
  };
  playRef.current = () => { const track = currentRef.current; if (track) void playTrack(track); };
  skipRef.current = async (direction: 1 | -1) => { await skip(direction); };
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    const actions = ['play', 'pause', 'nexttrack', 'previoustrack'] as const;
    for (const action of actions) { try { session.setActionHandler(action, () => mediaActions.current[action]()); } catch { /* Not every browser supports every action. */ } }
    return () => { for (const action of actions) try { session.setActionHandler(action, null); } catch { } session.metadata = null; try { session.playbackState = 'none'; } catch { } };
  }, []);
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    if (soundcloudUrl || !current) { session.metadata = null; try { session.playbackState = 'none'; } catch { } return; }
    if (typeof MediaMetadata !== 'undefined') session.metadata = new MediaMetadata({ title: current.title, artist: current.artist, artwork: [{ src: imageFor(current) }] });
    try { session.playbackState = playing ? 'playing' : 'paused'; } catch { }
  }, [current, playing, soundcloudUrl]);
  async function startRadio(track: Track | null) {
    if (!track?.video_id) { say('noticeRadioOnlyCatalog'); return; }
    // The seed starts immediately; its related tracks are fetched when the queue ends.
    if (isBlocked(track, blocksRef.current)) { say('noticeBlocked'); return; }
    waveMode.current = false;
    void playTrack(track, [track], true); say('noticeRadioStarted');
  }
  async function blockTrack(track: Track | null) {
    if (!track) return;
    if (!blocksReady) { say('noticeBlocksLoading'); return; }
    const entry = blockForTrack(track); if (isBlocked(track, blocksRef.current)) return;
    const next = mergeBlocks(blocksRef.current, [entry]); blocksRef.current = next; setBlocks(next);
    const localSaved = writeBlocks(mergeBlocks(readBlocks(), [entry])); setLastBlocked(entry);
    setNotice(localSaved ? tRef.current('noticeBlocked') : tRef.current('noticeBlockedLocal'));
    if (currentRef.current?.id === track.id && (playing || loading)) void skip(1);
    if (user && supabase) { const write = Promise.resolve(supabase.from('recommendation_blocks').upsert({ ...entry, user_id: user.id }, { onConflict: 'user_id,kind,track_id' })); blockWrite.current = write; const { error } = await write; if (blockWrite.current === write) blockWrite.current = null; if (error) say('noticeBlockedAccountFailed'); }
  }
  async function undoBlock() {
    const entry = lastBlocked; if (!entry) return;
    if (blockWrite.current) await blockWrite.current;
    if (user && supabase) { const { error } = await supabase.from('recommendation_blocks').delete().eq('user_id', user.id).eq('kind', entry.kind).eq('track_id', entry.track_id); if (error) { say('noticeBlockUndoFailed'); return; } }
    const remaining = blocksRef.current.filter((x) => !(x.kind === entry.kind && x.track_id === entry.track_id));
    blocksRef.current = remaining; setBlocks(remaining); writeBlocks(readBlocks().filter((x) => !(x.kind === entry.kind && x.track_id === entry.track_id)));
    setLastBlocked(null); say('noticeBlockUndo'); setRefreshShelves((x) => x + 1);
  }
  async function resetHistory() {
    if (user && supabase) {
      const { error } = await supabase.from('listening_history').delete().eq('user_id', user.id);
      if (error) { say('resetHistoryFailed'); return; }
    } else {
      try { localStorage.removeItem('nocturne.guest.v1'); } catch { }
    }
    playedIds.current = []; listenRecorded.current = false; playback.current = { seconds: 0, last: 0, completed: false, started: false };
    say('resetHistoryDone'); setRefreshShelves((x) => x + 1);
  }
  async function ensureSaved(track: Track) {
    if (!user || !supabase) throw new Error(tRef.current('noticeSignInFirst'));
    if (!track.video_id && !track.external_id) return track.id;
    const prefix = track.video_id ? 'yt' : track.source === 'deezer' ? 'dz' : 'js';
    const id = `${prefix}:${track.video_id || track.external_id}:${user.id}`;
    const { error } = await supabase.from('tracks').upsert({ id, owner_id: user.id, title: track.title.slice(0, 300), artist: track.artist.slice(0, 200), storage_path: null, source: track.video_id ? 'youtube' : track.source, video_id: track.video_id || null, external_id: track.external_id || null, duration: track.duration || null, album: track.album || null, artwork: track.thumbnail || null }, { onConflict: 'id' });
    if (error) throw error;
    setTracks((prev) => unique([track, ...prev])); return id;
  }
  const toggleLike = useCallback(async (track: Track) => {
    const exists = likesRef.current.includes(track.id);
    if (!user || !supabase) {
      if (!setGuestLike(track, !exists)) { say('noticeGuestLike'); return; }
      setLikes((prev) => (exists ? prev.filter((x) => x !== track.id) : [...prev, track.id]));
      setTracks((prev) => (exists ? prev.filter((x) => x.id !== track.id) : unique([track, ...prev])));
      return;
    }
    try {
      const id = await ensureSaved(track);
      const { error } = exists ? await supabase.from('likes').delete().eq('user_id', user.id).eq('track_id', id) : await supabase.from('likes').insert({ user_id: user.id, track_id: id });
      if (error) throw error;
      setLikes((prev) => (exists ? prev.filter((x) => x !== track.id) : [...prev, track.id]));
      if (exists && !track.storage_path) setTracks((prev) => prev.filter((x) => x.id !== track.id));
      if (!exists) void logSignal(track, 'like');
    } catch (e) { setNotice(e instanceof Error ? e.message : tRef.current('noticeLikeFailed')); }
  }, [user, say]);
  const likesRef = useRef(likes); likesRef.current = likes;
  toggleLikeRef.current = (track) => toggleLike(track);
  function createPlaylist() { if (!user || !supabase) { setPlaylistName(''); setPlaylistOpen(true); return; } setPlaylistName(''); setPlaylistOpen(true); }
  async function savePlaylist(e: React.FormEvent) {
    e.preventDefault();
    const name = playlistName.trim().slice(0, 100);
    if (!name) return;
    if (!user || !supabase) {
      const created = addGuestPlaylist(readGuestPlaylists(), name, crypto.randomUUID());
      if (!created.playlist) { say('noticePlaylistName'); return; }
      writeGuestPlaylists(created.items); setPlaylists(created.items); setPlaylistOpen(false); setView(`playlist:${created.playlist.id}`);
      return;
    }
    const { data, error } = await supabase.from('playlists').insert({ name, owner_id: user.id }).select('id,name,cover_url,created_at').single();
    if (error) setNotice(error.message); else { setPlaylists((prev) => [data as Playlist, ...prev]); setPlaylistOpen(false); setView(`playlist:${data.id}`); }
  }
  async function patchPlaylist(id: string, patch: { name?: string; cover_url?: string | null }) {
    if (!user || !supabase) {
      let items = readGuestPlaylists();
      if (patch.name) items = renameGuestPlaylist(items, id, patch.name);
      if ('cover_url' in patch) items = setPlaylistCover(items, id, patch.cover_url ?? null);
      writeGuestPlaylists(items); setPlaylists(items);
      say('savedLocally');
      return;
    }
    const { error } = await supabase.from('playlists').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) setNotice(error.message);
    else setPlaylists((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }
  async function deletePlaylist(id: string) {
    if (!user || !supabase) { const items = dropGuestPlaylist(readGuestPlaylists(), id); writeGuestPlaylists(items); setPlaylists(items); say('playlistDeleted'); if (view === `playlist:${id}`) setView('library'); return; }
    const { error } = await supabase.from('playlists').delete().eq('id', id).eq('owner_id', user.id);
    if (error) setNotice(error.message);
    else { setPlaylists((prev) => prev.filter((x) => x.id !== id)); if (view === `playlist:${id}`) setView('library'); say('playlistDeleted'); }
  }
  async function pickCover(file: File | null) {
    const target = playlistEdit?.id || (view.startsWith('playlist:') ? view.slice(9) : null);
    if (!file || !target) return;
    try {
      const dataUrl = await makeCoverDataUrl(file);
      await patchPlaylist(target, { cover_url: dataUrl });
      say('playlistCoverSaved');
    } catch (e) { setNotice(e instanceof Error ? e.message : tRef.current('playlistCoverHint')); }
  }
  async function addToPlaylist(track: Track, id: string) {
    if (!id) return;
    if (!user || !supabase) {
      const result = toggleTrackInPlaylist(readGuestPlaylists(), id, track.id);
      if (!writeGuestPlaylists(result.items)) { say('noticeGuestHistory'); return; }
      setPlaylists(result.items);
      if (view === `playlist:${id}`) setPlaylistIds(tracksInPlaylist(result.items, id));
      say(result.added ? 'noticeAdded' : 'playlistRemoveTrack');
      void logSignal(track, 'playlist_add');
      return;
    }
    try {
      const saved = await ensureSaved(track);
      const known = playlistIds.includes(track.id);
      const { error } = known
        ? await supabase.from('playlist_tracks').delete().eq('playlist_id', id).eq('track_id', saved)
        : await supabase.from('playlist_tracks').upsert({ playlist_id: id, track_id: saved });
      if (error) throw error;
      setPlaylistIds((prev) => (known ? prev.filter((x) => x !== track.id) : [...prev, track.id]));
      setNotice(known ? tRef.current('playlistTrackRemoved') : tRef.current('noticeAdded'));
      if (!known) void logSignal(track, 'playlist_add');
    } catch (e) { setNotice(e instanceof Error ? e.message : tRef.current('noticePlaylistFailed')); }
  }
  async function upload(file: File) {
    if (!user || !supabase) { setAuthOpen(true); return; }
    if (file.size > 50 * 1024 * 1024) { say('noticeTooLarge'); return; }
    setBusy(true);
    const id = crypto.randomUUID(); const path = `${user.id}/${id}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const { error: storageError } = await supabase.storage.from('audio').upload(path, file);
    if (storageError) { setNotice(storageError.message); setBusy(false); return; }
    const track: Track = { id, owner_id: user.id, title: file.name.replace(/\.[^.]+$/, ''), artist: t('yourUpload'), storage_path: path, duration: 0 };
    const { error } = await supabase.from('tracks').insert(track);
    if (error) { await supabase.storage.from('audio').remove([path]); setNotice(error.message); } else { setTracks((prev) => [track, ...prev]); say('noticeAdded'); setView('library'); }
    setBusy(false);
  }
  function toggleMute() {
    if (mutedRef.current) { setMuted(false); setVolume(restoreVolume.current || 70); }
    else { restoreVolume.current = volumeRef.current || 70; setMuted(true); }
  }
  function seek(seconds: number) {
    const track = currentRef.current;
    if (track?.video_id && youtubeActive) yt.current?.seek(seconds);
    else if (audio.current) audio.current.currentTime = seconds;
    playback.current.last = seconds; setElapsed(seconds);
  }
  function openArtist(name: string) {
    const value = (name || '').trim();
    if (value.length < 1) return;
    setArtist(value); setView('artist'); setSearch(''); setFullscreen(false);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
  }
  function openSoundcloud() {
    const input = window.prompt(tRef.current('soundcloudPrompt')); if (!input) return;
    try {
      const u = new URL(input);
      if (u.protocol !== 'https:' || !['soundcloud.com', 'www.soundcloud.com'].includes(u.hostname) || u.username || u.password || u.pathname.split('/').filter(Boolean).length < 2) throw new Error();
      if (playback.current.started) recordSwitch();
      ++requestSeq.current; embed.cancel(); yt.current?.stop(); audio.current?.pause(); setYoutubeActive(false); setPlaying(false); setLoading(false); setSoundcloudUrl(`https://soundcloud.com${u.pathname}`);
    } catch { setNotice('https://soundcloud.com/artist/track'); }
  }
  function setPref<K extends keyof Preferences>(key: K, value: Preferences[K]) { setPrefs((prev) => ({ ...prev, [key]: value })); }
  function finishOnboarding() { setPrefs((prev) => ({ ...prev, onboardingCompleted: true })); setWizard(false); setPanel(null); say('onboardingFinishTitle'); if (prefs.genres.length || prefs.artists.length) setRefreshShelves((x) => x + 1); }
  function skipOnboarding() { setPrefs((prev) => ({ ...prev, onboardingCompleted: true })); setWizard(false); say('onboardingSkipped'); }

  const artistLabel = (name: string) => (name === 'Unknown artist' || name === 'Неизвестный исполнитель' ? t('unknownArtist') : name === 'Your upload' || name === 'Ваша загрузка' ? t('yourUpload') : name);
  const localVisible = tracks.filter((x) => (view === 'liked' ? likes.includes(x.id) : view.startsWith('playlist:') ? playlistIds.includes(x.id) : (likes.includes(x.id) || Boolean(x.storage_path))) && `${x.title} ${x.artist}`.toLowerCase().includes(search.toLowerCase()));
  const visible = search.trim().length >= 2 ? unique([...localVisible, ...results]) : localVisible;
  const isHome = view === 'home' && !search;
  const shelfItems = (items: Track[]) => items.filter((x) => !isBlocked(x, blocks));
  // Локальные блокировки применяются сразу, а серверный ответ уже отфильтрован — блок не ждёт готовности чёрного списка.
  const shelfCards = shelfItems(shelves.similar).concat(shelfItems(shelves.recent), shelfItems(shelves.daily), shelfItems(shelves.trending));
  // Индикатор загрузки производный: он исчезает, как только хоть одна карточка отрендерилась, и зависнуть не может.
  const shelfStatus = shelvesLoading && shelfCards.length === 0 ? t('loadingShelves') : shelfNote;
  const navView = search || view === 'search' ? 'search' : view === 'home' ? 'home' : view === 'library' ? 'library' : view === 'artist' ? '' : '';
  const currentPlaylist = view.startsWith('playlist:') ? playlists.find((x) => x.id === view.slice(9)) : undefined;
  const title = search ? t('searchResults') : view === 'liked' ? t('liked') : currentPlaylist ? currentPlaylist.name : view === 'library' ? t('yourLibraryTitle') : view === 'artist' ? artist || t('artistPage') : t('yourMusic');
  const contextLabel = waveMode.current && view === 'home' ? t('myWave') : currentPlaylist ? currentPlaylist.name : view === 'liked' ? t('liked') : artist && view === 'artist' ? artist : t('playingNow');
  const accent = (ACCENTS[prefs.accent] ?? ACCENTS.nocturne).green;

  const player: PlayerBindings = {
    t, prefs, reduced: reducedMotion, accent,
    current, playing, loading, elapsed, duration, volume,
    queue: queueList, queueIndex: queueAt, likes, contextLabel,
    waveActive: waveMode.current, analyser: analyser.current,
    onPlay: (track, list) => {
      if (list && list.length) { void playTrack(track, list); return; }
      const known = queue.current.findIndex((x) => x.id === track.id);
      void playTrack(track, known >= 0 ? queue.current : [track, ...queue.current]);
    },
    onTogglePlay: () => { const track = currentRef.current; if (track) void playTrack(track); },
    onSkip: (direction) => void skip(direction),
    onSeek: seek,
    onVolume: (value) => { setVolume(value); setMuted(value === 0); if (value > 0) restoreVolume.current = value; },
    onToggleLike: (track) => void toggleLike(track),
    onBlock: (track) => void blockTrack(track),
    onRadio: (track) => void startRadio(track),
    onOpenArtist: openArtist,
    onQueueMove: (from, to) => {
      const playing0 = queue.current[queueIndex.current];
      const next = moveInQueue(queue.current, from, to);
      setQueue(next, Math.max(0, next.indexOf(playing0 as Track)));
      if (playing0?.video_id) yt.current?.cue(!shuffle ? embed.playbackId(next[next.indexOf(playing0 as Track) + 1]?.video_id) || null : null);
    },
    onQueueRemove: (index) => {
      const list = [...queue.current];
      const removed = list[index];
      if (!removed) return;
      const rest = list.filter((_, i) => i !== index);
      if (index < queueIndex.current) { setQueue(rest, queueIndex.current - 1); return; }
      if (index === queueIndex.current) {
        if (!rest.length) { setQueue([], 0); audio.current?.pause(); yt.current?.pause(); setPlaying(false); setCurrent(null); return; }
        const follow = Math.min(index, rest.length - 1);
        setQueue(rest, follow); playback.current.started = false; void playTrack(rest[follow], undefined, true);
        return;
      }
      setQueue(rest, queueIndex.current);
    },
    onWave: () => void startWave(),
  };
  const panelSide = prefs.nowPlaying === 'left' ? 'left' : 'right';
  const sleepActive = sleep.kind !== 'off';

  return <MotionConfig reducedMotion="user" transition={spring}>
    <div className={`app-shell${panel ? ' has-panel' : ''}${panel === 'now' && prefs.nowPlaying === 'left' ? ' panel-left' : ''}`} data-player-style={prefs.playerStyle} data-sidebar={prefs.sidebar}>
      <aside className="sidebar">
        <button className="brand" onClick={() => { setView('home'); setSearch(''); setArtist(null); }}><span className="brand-icon"><AudioLines size={20} /></span><span>nocturne<span className="brand-dot">.</span></span></button>
        <div className="side-label">{t('navigation')}</div>
        <nav className="nav">{([
          { id: 'home', label: t('home'), Icon: Home, action: () => { setView('home'); setSearch(''); setArtist(null); } },
          { id: 'search', label: t('search'), Icon: Search, action: () => { setView('search'); document.getElementById('search')?.focus(); } },
          { id: 'library', label: t('library'), Icon: Library, action: () => { setView('library'); setSearch(''); setArtist(null); } },
          { id: 'wave', label: t('myWave'), Icon: LayoutList, action: () => void startWave() },
          { id: 'queue', label: t('queue'), Icon: ListVideo, action: () => setPanel(panel === 'queue' ? null : 'queue') },
        ] as const).map(({ id, label, Icon, action }) => <button key={id} aria-label={label} title={label} className={navView === id ? 'active' : ''} onClick={action}>{navView === id && <motion.span layoutId="activeNavIndicator" className="nav-indicator" transition={spring} />}<Icon size={19} /><span className="nav-text">{label}</span></button>)}</nav>
        <div className="side-label library-label">{t('myLibrary')} <button title={t('createPlaylist')} aria-label={t('createPlaylist')} onClick={createPlaylist}><Plus size={17} /></button></div>
        <div className="library-links">
          <button onClick={() => { setView('liked'); setSearch(''); }}><span className="side-cover liked-cover"><Heart size={17} fill="currentColor" /></span><span><b>{t('liked')}</b><small>{t('tracksCount', { count: likes.length })}</small></span></button>
          {playlists.map((p) => <button key={p.id} onClick={() => { setView(`playlist:${p.id}`); setSearch(''); }}>
            <span className="side-cover playlist-cover" style={p.cover_url ? { backgroundImage: `url('${p.cover_url}')`, backgroundSize: 'cover' } : undefined}>{!p.cover_url && <Music2 size={17} />}</span>
            <span><b>{p.name}</b><small>{t('tracksCount', { count: tracksInPlaylist(readGuestPlaylists(), user ? null : p.id).length || 0 })}</small></span>
          </button>)}
        </div>
        <button className="create-playlist" onClick={createPlaylist}><span><Plus size={19} /></span> {t('createPlaylist')}</button>
        <div className="side-bottom">
          <button className="side-settings" onClick={() => setPanel(panel === 'settings' ? null : 'settings')}><Settings size={16} /> {t('settings')}</button>
          <span className="side-footer">{t('appTagline')}</span>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="history"><button aria-label={t('back')} onClick={() => history.back()}><ArrowLeft size={18} /></button><button aria-label={t('forward')} onClick={() => history.forward()}><ArrowRight size={18} /></button></div>
          <div className="search-wrap"><Search size={17} /><input id="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('searchPlaceholder')} aria-label={t('searchPlaceholder')} /></div>
          <div className="top-actions">
            {installPrompt && <button className="upload-button" onClick={() => void installPrompt!.prompt()}><Plus size={16} /><span>{t('pwaHint')}</span></button>}
            <button className="upload-button" onClick={() => fileInput.current?.click()} title={t('uploadMusic')}><Upload size={16} /><span>{busy ? t('uploading') : t('uploadMusic')}</span></button>
            <input ref={fileInput} type="file" accept="audio/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
            <input ref={coverInput} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0] || null; void pickCover(f); e.target.value = ''; }} />
            <button className={panel === 'settings' ? 'icon-action on' : 'icon-action'} aria-label={t('settings')} title={t('settings')} onClick={() => setPanel(panel === 'settings' ? null : 'settings')}><Settings size={18} /></button>
            <button className="profile" aria-label={user ? t('signOut') : t('signIn')} onClick={() => user ? void supabase?.auth.signOut() : setAuthOpen(true)}>
              <span className="avatar">{(profileName || user?.email || 'N')[0]?.toUpperCase() || 'N'}</span>
              <span>{user ? profileName || user.email?.split('@')[0] : t('guest')}</span>
            </button>
          </div>
        </header>
        <YouTubePlayer ref={yt} miniWindow={ytMiniWindow} onCloseMini={() => setYtMiniWindow(false)} volume={muted ? 0 : Math.round(volume * resolveVolume({ volume, normalize: prefs.normalizeVolume, remote: true, fade: sleepRef.current * fadeRef.current }))} onProgress={(time, d) => { setElapsed(time); setDuration(d); if (advanceListening(playback.current, time, d, true, false) && currentRef.current) void logSignal(currentRef.current, 'complete', playback.current.seconds); recordListen(); if (prefs.crossfade > 0 && d > 0) { const remaining = d - time; fadeRef.current = remaining > 0 && remaining <= prefs.crossfade ? fadeOutGain(remaining, prefs.crossfade) : 1; applyLevel(); } }} onState={(state) => { if (state === 'playing') { embed.playing(); playback.current.started = true; setPlaying(true); setLoading(false); } else if (state === 'paused') { setPlaying(false); setLoading(false); } else { setPlaying(false); if (sleepStopRef.current) { sleepStopRef.current = false; setSleep(sleepOff()); say('sleepFading'); return; } if (repeat) { playback.current = { seconds: 0, last: 0, completed: false, started: true }; listenRecorded.current = false; yt.current?.seek(0); yt.current?.play(); } else void skip(1, true); } }} onError={(message, code) => { /* 101/150/100 забирает обход: пока он идёт, крутится загрузка, а не ошибка. */ if (embed.error(code)) { setYtMiniWindow(true); setLoading(true); return; } setLoading(false); setPlaying(false); setNotice(message); }} />
        <Presence reduced={reducedMotion} mode="wait" initial={false}>
          <motion.div className="content" key={navView === 'search' ? 'search' : view} initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 12, filter: 'blur(6px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -6, filter: 'blur(4px)' }} transition={spring}>
            {artist && view === 'artist' ? <>
              <ArtistView name={artist} player={player} onBack={() => { setArtist(null); setView('home'); }} />
            </> : <>
              {isHome && <>
                <div className="greeting"><div><h1>{t('greeting')}</h1><p>{t('greetingSub')}</p></div><span className="date-label"><Clock3 size={14} />{new Intl.DateTimeFormat(prefs.language === 'en' ? 'en-US' : 'ru-RU', { day: 'numeric', month: 'long' }).format(new Date())}</span></div>
                <section className="hero">
                  <WaveVisualizer playing={playing} mood={prefs.waveMood} accent={accent} particles={prefs.particles} reduced={reducedMotion} analyser={analyser.current} />
                  <div className="hero-content">
                    <div className="hero-kicker">{t('radioKicker')}{shelfStatus && <span>{shelfStatus}</span>}</div>
                    <h2>{t('heroTitle')}<br /><em>{t('heroTitleTail')}</em></h2>
                    <p>{t('heroText')}</p>
                    <div className="hero-actions">
                      <motion.button className="primary wave-button" whileTap={reducedMotion ? undefined : { scale: 0.96 }} onClick={() => void startWave()} disabled={waveLoading}><Play size={15} fill="currentColor" /> {waveLoading ? t('noticePreparingWave') : t('myWave')}</motion.button>
                      <button className="hero-link" onClick={() => setView('library')}>{t('openLibrary')} <ArrowRight size={16} /></button>
                    </div>
                    <LayoutGroup id="hero-moods-group">
                      <div className="hero-moods" role="group" aria-label={t('waveMoodLabel')}>
                        {([['energetic', t('waveMoodEnergetic')], ['calm', t('waveMoodCalm')], ['unknown', t('waveMoodUnknown')], ['loved', t('waveMoodLoved')]] as const).map(([id, label]) => (
                          <button key={id} type="button" className={prefs.waveMood === id ? 'on' : undefined} onClick={() => setPref('waveMood', id)}>
                            {prefs.waveMood === id && <motion.span layoutId="hero-mood-pill" className="fp-tab-pill" transition={{ type: 'spring', stiffness: 380, damping: 30 }} />}
                            <span className="fp-tab-label">{label}</span>
                          </button>
                        ))}
                      </div>
                    </LayoutGroup>
                  </div>
                </section>
                <div className="recommendations">
                  <div className="recommendations-heading"><div><h2>{t('discover')}</h2></div><button onClick={() => setRefreshShelves((x) => x + 1)}>{t('refresh')} <ArrowRight size={15} /></button></div>
                  {shelfStatus && <p className="catalog-status">{shelfStatus}</p>}
                  {shelves.similarUnavailable && <p className="catalog-status">{t('similarUnavailable')}</p>}
                  <Shelf t={t} reduced={reducedMotion} title={t('shelfSimilar')} subtitle={t('shelfSimilarSub')} items={shelfItems(shelves.similar)} onBlock={(x) => void blockTrack(x)} onPlay={(x, list) => void playTrack(x, list)} onRadio={(x) => void startRadio(x)} onOpenArtist={openArtist} />
                  <Shelf t={t} reduced={reducedMotion} title={t('shelfRecent')} subtitle={t('shelfRecentSub')} items={shelfItems(shelves.recent)} onBlock={(x) => void blockTrack(x)} onPlay={(x, list) => void playTrack(x, list)} onRadio={(x) => void startRadio(x)} onOpenArtist={openArtist} />
                  <Shelf t={t} reduced={reducedMotion} title={t('shelfDaily')} subtitle={t('shelfDailySub')} items={shelfItems(shelves.daily)} onBlock={(x) => void blockTrack(x)} onPlay={(x, list) => void playTrack(x, list)} onRadio={(x) => void startRadio(x)} onOpenArtist={openArtist} />
                  <Shelf t={t} reduced={reducedMotion} title={t('shelfTrending')} subtitle={shelves.editorialFallback && !shelfLive ? t('shelfTrendingEditorial') : shelves.freshFallback ? t('shelfTrendingFresh') : shelves.trendingFallback ? t('shelfTrendingSearch') : t('shelfTrendingMirrors')} items={shelfItems(shelves.trending)} onBlock={(x) => void blockTrack(x)} onPlay={(x, list) => void playTrack(x, list)} onRadio={(x) => void startRadio(x)} onOpenArtist={openArtist} />
                  {!user && <p className="catalog-status">{t('guestNote')}</p>}
                </div>
              </>}
              <section className="section tracks-section">
                <div className="section-heading"><div><h2>{title}</h2><p>{search ? t('catalogSub') : isHome ? t('librarySub') : t('collectionSub')}</p></div>{isHome && <button onClick={() => setView('library')}>{t('showAll')} <ArrowRight size={15} /></button>}</div>
                {search && <div className="source-tabs" aria-label={t('search')}>
                  {([['youtube', t('sourceYoutube')], ['deezer', t('sourceDeezer')], ['jiosaavn', t('sourceJiosaavn')]] as const).map(([id, label]) => <button key={id} className={searchSource === id ? 'selected' : ''} onClick={() => setSearchSource(id)}>{label}</button>)}
                  <a href={`https://soundcloud.com/search/sounds?q=${encodeURIComponent(search)}`} target="_blank" rel="noreferrer">SoundCloud ↗</a>
                  <button onClick={openSoundcloud}>{t('soundcloudLink')}</button>
                </div>}
                <TrackTable
                  t={t} view={view} search={search} tracks={visible} playlists={playlists} playlist={currentPlaylist} current={current} playing={playing} duration={duration}
                  likes={likes} language={prefs.language} reduced={reducedMotion}
                  onPlay={(track, list) => void playTrack(track, list)} onRadio={(track) => void startRadio(track)} onToggleLike={(track) => void toggleLike(track)} onBlock={(track) => void blockTrack(track)}
                  onOpenArtist={openArtist} onAddToPlaylist={(track, id) => void addToPlaylist(track, id)}
                  onQueueAdd={(track) => { const merged = appendQueue(queue.current, [track]); setQueue(merged.items, queueIndex.current); if (merged.added) say('noticeAdded'); }}
                  onPlaylistRemove={track => currentPlaylist && void addToPlaylist(track, currentPlaylist.id)}
                  onPlaylistRename={() => currentPlaylist && setPlaylistEdit(currentPlaylist)}
                  onPlaylistCover={() => coverInput.current?.click()}
                  onPlaylistDelete={() => currentPlaylist && void deletePlaylist(currentPlaylist.id)}
                />
              </section>
            </>}
            <footer>{t('footerNote')}</footer>
          </motion.div>
        </Presence>
      </main>

      <Presence reduced={reducedMotion}>
        {panel === 'now' && <NowPlayingPanel key="now" player={player} side={panelSide} onClose={() => setPanel(null)} onAddToPlaylist={(track) => { const target = playlists[0]; if (target) void addToPlaylist(track, target.id); else setPlaylistOpen(true); }} />}
        {panel === 'queue' && <QueuePanel key="queue" player={player} onClose={() => setPanel(null)} />}
        {panel === 'settings' && <SettingsPanel key="settings" player={player} prefs={prefs} setPref={setPref} blocks={blocks} onUnblock={(block) => void unblock(block)} onResetHistory={() => void resetHistory()} displayName={profileName} onDisplayName={(value) => void saveProfileName(value)} signedIn={!!user} onRestartOnboarding={() => { setPanel(null); setPrefs((prev) => ({ ...prev, onboardingCompleted: false })); setWizard(true); }} onClose={() => setPanel(null)} sleep={sleep} sleepLeft={sleepLeft} onSleep={setSleep} muted={muted} onMute={toggleMute} />}
      </Presence>
      <Presence reduced={reducedMotion}>{fullscreen && current && <FullscreenPlayer player={player} origin={expandOrigin} mood={prefs.waveMood} onMood={(mood) => setPref('waveMood', mood)} onClose={() => setFullscreen(false)} />}</Presence>
      {/* Мастер — блокирующий оверлей: снимаем его с дерева сразу, без exit-анимации. */}
      {wizard && <OnboardingWizard prefs={prefs} setPref={setPref} t={t} reduced={reducedMotion} onDone={finishOnboarding} onSkip={skipOnboarding} />}

      <footer className={`player${prefs.playerStyle === 'floating' ? ' is-floating' : ''}${playing ? ' is-playing' : ''}`}>
        <div className="now-playing">
          <Presence reduced={reducedMotion} mode="wait" initial={false}>
            <motion.div key={current?.id || 'idle'} className="now-meta" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0 : 0.18 }}>
              <div className="player-art" style={{ backgroundImage: current ? `url('${imageFor(current)}')` : undefined }} />
              <div className="now-text">
                <b>{current?.title || t('queueEmpty')}</b>
                {current ? <button className="now-artist" onClick={() => openArtist(current.artist)}>{artistLabel(current.artist)}</button> : <small>{t('appTagline')}</small>}
              </div>
            </motion.div>
          </Presence>
          <span className="equalizer" aria-hidden="true">{[0, 1, 2, 3].map((i) => <motion.i key={i} animate={playing && !reducedMotion ? { scaleY: [0.3, 1, 0.45, 0.85, 0.3] } : { scaleY: 0.25 }} transition={playing && !reducedMotion ? { duration: 0.9 + i * 0.13, repeat: Infinity, ease: 'easeInOut', delay: i * 0.11 } : spring} />)}</span>
          {current && <>
            <LikeButton active={likes.includes(current.id)} label={likes.includes(current.id) ? t('unlike') : t('like')} reduced={reducedMotion} onToggle={() => void toggleLike(current)} />
            <BlockButton label={t('block')} reduced={reducedMotion} onBlock={() => void blockTrack(current)} />
          </>}
        </div>
        <div className="player-center">
          <div className="player-buttons">
            <ImpulseButton label={t('shuffle')} className={shuffle ? 'on' : ''} reduced={reducedMotion} variant="shuffle" onClick={() => setShuffle(!shuffle)}><Shuffle size={16} /></ImpulseButton>
            <ImpulseButton label={t('previousTrack')} reduced={reducedMotion} variant="left" onClick={() => void skip(-1)}><SkipBack size={18} fill="currentColor" /></ImpulseButton>
            <PlayPauseButton playing={playing} disabled={!current} reduced={reducedMotion} label={playing ? t('pauseTrack') : t('playTrack')} onClick={() => { const track = currentRef.current; if (track) void playTrack(track); else say('noticeNeedTrack'); }} />
            <ImpulseButton label={t('nextTrack')} reduced={reducedMotion} variant="right" onClick={() => void skip(1)}><SkipForward size={18} fill="currentColor" /></ImpulseButton>
            <ImpulseButton label={t('repeat')} className={repeat ? 'on' : ''} reduced={reducedMotion} variant="repeat" onClick={() => setRepeat(!repeat)}><Repeat2 size={17} /></ImpulseButton>
          </div>
          <div className="progress"><span>{format(elapsed)}</span><div className="glass-range-wrap"><span className="glass-track" aria-hidden="true"><span className="glass-fill" style={{ width: `calc(14px + (100% - 28px) * ${duration ? Math.min(1, Math.max(0, elapsed / duration)) : 0})` }} /></span><input aria-label={t('seek')} type="range" step="0.05" min="0" max={duration || 0} value={Math.min(elapsed, duration || 0)} onChange={(e) => seek(Number(e.target.value))} /><span className="glass-thumb" aria-hidden="true" style={{ left: `calc(14px + (100% - 28px) * ${duration ? Math.min(1, Math.max(0, elapsed / duration)) : 0})` }} /></div><span>{format(duration)}</span></div>
        </div>
        <div className="player-right">
          <button className={sleepActive ? 'on' : ''} aria-label={t('sleepTimer')} title={sleepActive ? t('sleepSet', { time: sleep.kind === 'track' ? t('sleepEndOfTrack') : formatRemaining(sleepLeft ?? 0) }) : t('sleepTimer')} onClick={() => setSleep(sleep.kind === 'off' ? sleepMinutes(SLEEP_MINUTES_DEFAULT) : sleepOff())}><Timer size={17} /></button>
          <button className={panel === 'queue' ? 'on' : ''} aria-label={t('queue')} title={t('queue')} onClick={() => setPanel(panel === 'queue' ? null : 'queue')}><ListMusic size={18} /></button>
          <button className={panel === 'now' ? 'on' : ''} aria-label={t('nowPlayingPanel')} title={t('nowPlayingPanel')} onClick={() => setPanel(panel === 'now' ? null : 'now')}><PanelRight size={18} /></button>
          <button aria-label={current ? t('expandPlayer') : t('queueEmpty')} title={t('expandPlayer')} disabled={!current} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setExpandOrigin({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }); setFullscreen(true); }}><SquarePlay size={18} /></button>
          <div className="volume-control" onWheel={(e) => { e.preventDefault(); const next = Math.max(0, Math.min(100, (muted ? 0 : volume) + (e.deltaY < 0 ? 5 : -5))); setMuted(next === 0); setVolume(next); }}>
            <VolumeButton muted={muted || volume === 0} label={muted || volume === 0 ? t('unmute') : t('mute')} reduced={reducedMotion} onClick={toggleMute} />
            <div className="glass-range-wrap volume-wrap">
              <span className="glass-track" aria-hidden="true"><span className="glass-fill" style={{ width: `calc(14px + (100% - 28px) * ${(muted ? 0 : volume) / 100})` }} /></span>
              <input className="volume-slider" aria-label={t('volume')} type="range" min="0" max="100" value={muted ? 0 : volume} onChange={(e) => { const v = Number(e.target.value); setMuted(v === 0); setVolume(v); }} />
              <span className="glass-thumb" aria-hidden="true" style={{ left: `calc(14px + (100% - 28px) * ${(muted ? 0 : volume) / 100})` }} />
            </div>
            <span className="volume-pct">{muted ? 0 : volume}%</span>
          </div>
        </div>
      </footer>
      <nav className="mobile-nav" aria-label={t('navigation')}>
        {([['home', t('home'), Home], ['search', t('search'), Search], ['wave', t('myWave'), LayoutList], ['library', t('library'), Library]] as const).map(([id, label, Icon]) => (
          <button key={id} className={navView === id ? 'active' : ''} aria-label={label} onClick={() => (id === 'wave' ? startWave() : (setView(id), setSearch(''), setArtist(null)))}><Icon size={19} /><span>{label}</span></button>
        ))}
      </nav>
      {soundcloudUrl && <aside className="soundcloud-panel"><div className="youtube-header"><span>{t('soundcloudWidget')}</span><button onClick={() => setSoundcloudUrl(null)} aria-label={t('close')}>×</button></div><iframe title="SoundCloud player" width="100%" height="166" allow="autoplay" src={`https://w.soundcloud.com/player/?url=${encodeURIComponent(soundcloudUrl)}&auto_play=false`} /><small>{t('soundcloudHelp')}</small></aside>}
      {/* Local audio events. */}
      <AudioEvents audio={audio} playing={playing} trackId={current?.id || ''} onTime={onTime} onDuration={(value) => { setDuration(value); if (sleep.kind === 'track' && value > 0) sleepTrackRemaining.current = value; }} onEnded={() => { setPlaying(false); if (sleepStopRef.current) { sleepStopRef.current = false; setSleep(sleepOff()); say('sleepFading'); return; } if (repeat && audio.current) { playback.current = { seconds: 0, last: 0, completed: false, started: true }; listenRecorded.current = false; audio.current.currentTime = 0; void audio.current.play().then(() => setPlaying(true)).catch(() => say('noticePlaybackError')); } else void skip(1, true); }} onError={() => { if (!currentRef.current?.video_id) { setPlaying(false); say('noticeAudioFailed'); } }} />
      <Presence reduced={reducedMotion}>{notice && <motion.div key="toast" className="toast" role="status" initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: reducedMotion ? 0 : 8 }} transition={spring}>{notice}{lastBlocked && <button className="undo-block" onClick={() => void undoBlock()}>{t('unblock')}</button>}<button aria-label={t('close')} onClick={() => { setNotice(''); setLastBlocked(null); }}><X size={16} /></button></motion.div>}</Presence>
      <Presence reduced={reducedMotion}>{authOpen && <motion.div key="auth" className="modal-backdrop" onClick={() => setAuthOpen(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><motion.div role="dialog" aria-modal="true" aria-label={t('signIn')} className="modal" onClick={(e) => e.stopPropagation()} initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: reducedMotion ? 0 : 8 }} transition={spring}><button className="modal-close" aria-label={t('close')} onClick={() => setAuthOpen(false)}><X size={19} /></button><span className="brand-icon"><Moon size={20} /></span><h2>{t('authTitle')}</h2><p>{t('authSub')}</p><EmailOtpForm t={t} reducedMotion={reducedMotion} onSignedIn={() => { setAuthOpen(false); setWizard(false); setPrefs((prev) => ({ ...prev, onboardingCompleted: true })); }} /></motion.div></motion.div>}</Presence>
      <Presence reduced={reducedMotion}>{playlistOpen && <motion.div key="playlist" className="modal-backdrop" onClick={() => setPlaylistOpen(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><motion.div role="dialog" aria-modal="true" aria-label={t('newPlaylist')} className="modal" onClick={(e) => e.stopPropagation()} initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: reducedMotion ? 0 : 8 }} transition={spring}><button className="modal-close" aria-label={t('close')} onClick={() => setPlaylistOpen(false)}><X size={19} /></button><h2>{t('newPlaylist')}</h2><p>{t('playlistCoverHint')}</p><form onSubmit={(e) => void savePlaylist(e)}><label htmlFor="playlist-name">{t('displayName')}</label><input autoFocus id="playlist-name" value={playlistName} onChange={(e) => setPlaylistName(e.target.value)} required maxLength={100} /><button className="primary">{t('createPlaylist')}</button></form></motion.div></motion.div>}</Presence>
      <Presence reduced={reducedMotion}>{playlistEdit && <motion.div key="playlist-edit" className="modal-backdrop" onClick={() => setPlaylistEdit(null)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><motion.div role="dialog" aria-modal="true" aria-label={t('playlistRename')} className="modal" onClick={(e) => e.stopPropagation()} initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: reducedMotion ? 0 : 8 }} transition={spring}><button className="modal-close" aria-label={t('close')} onClick={() => setPlaylistEdit(null)}><X size={19} /></button><h2>{t('playlistRename')}</h2><form onSubmit={(e) => { e.preventDefault(); const name = playlistEdit.name.trim().slice(0, 100); if (!name) return; void patchPlaylist(playlistEdit.id, { name }); setPlaylistEdit(null); }}><label htmlFor="rename-playlist">{t('displayName')}</label><input autoFocus id="rename-playlist" value={playlistEdit.name} onChange={(e) => setPlaylistEdit({ ...playlistEdit, name: e.target.value })} maxLength={100} /><div className="cover-preview" style={playlistEdit.cover_url ? { backgroundImage: `url('${playlistEdit.cover_url}')` } : undefined} onClick={() => coverInput.current?.click()}><span>{t('playlistCover')}</span></div><p>{t('playlistCoverHint')}</p><button className="primary">{t('save')}</button></form></motion.div></motion.div>}</Presence>
      <Presence reduced={reducedMotion}>{searchOpen && <motion.div key="search" className="modal-backdrop" onClick={() => setSearchOpen(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><motion.div role="dialog" aria-modal="true" aria-label={t('search')} className="modal" onClick={(e) => e.stopPropagation()} initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: reducedMotion ? 0 : 8 }} transition={spring}><button className="modal-close" aria-label={t('close')} onClick={() => setSearchOpen(false)}><X size={19} /></button><h2>{t('search')}</h2><form onSubmit={(e) => { e.preventDefault(); setView('search'); setSearchOpen(false); }}><label htmlFor="search-dialog">{t('searchPlaceholder')}</label><input autoFocus id="search-dialog" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('searchPlaceholder')} /><button className="primary">{t('search')}</button></form></motion.div></motion.div>}</Presence>
    </div>
  </MotionConfig>;

  function unblock(block: Block) {
    const remaining = blocksRef.current.filter((x) => !(x.kind === block.kind && x.track_id === block.track_id));
    blocksRef.current = remaining; setBlocks(remaining); writeBlocks(remaining);
    if (user && supabase) void supabase.from('recommendation_blocks').delete().eq('user_id', user.id).eq('kind', block.kind).eq('track_id', block.track_id);
    say('noticeBlockUndo'); setRefreshShelves((x) => x + 1);
  }
  async function saveProfileName(value: string) {
    setProfileName(value);
    if (!user || !supabase) { say('noticeSignInFirst'); return; }
    const { error } = await supabase.from('profiles').update({ display_name: value.slice(0, 60) || null, updated_at: new Date().toISOString() }).eq('user_id', user.id);
    say(error ? 'profileFailed' : 'profileSaved');
  }
}

const SLEEP_MINUTES_DEFAULT = 30;
const sleepOff = () => ({ kind: 'off' } as const);

function AudioEvents({ audio, playing, trackId, onTime, onDuration, onEnded, onError }: { audio: React.RefObject<HTMLAudioElement | null>; playing: boolean; trackId: string; onTime: (v: number) => void; onDuration: (v: number) => void; onEnded: () => void; onError: () => void }) {
  useEffect(() => {
    const a = audio.current; if (!a) return;
    const time = () => onTime(a.currentTime); const durationChange = () => onDuration(Number.isFinite(a.duration) ? a.duration : 0);
    a.addEventListener('timeupdate', time); a.addEventListener('durationchange', durationChange); a.addEventListener('ended', onEnded); a.addEventListener('error', onError);
    return () => { a.removeEventListener('timeupdate', time); a.removeEventListener('durationchange', durationChange); a.removeEventListener('ended', onEnded); a.removeEventListener('error', onError); };
  }, [audio, playing, trackId, onTime, onDuration, onEnded, onError]);
  return null;
}

function Shelf({ t, reduced, title, subtitle, items, onPlay, onRadio, onBlock, onOpenArtist }: { t: Translate; reduced: boolean; title: string; subtitle: string; items: Track[]; onPlay: (track: Track, list: Track[]) => void; onRadio: (track: Track) => void; onBlock: (track: Track) => void; onOpenArtist: (name: string) => void }) {
  const [visible, setVisible] = useState(items.length > 0);
  useEffect(() => { if (items.length) setVisible(true); }, [items.length]);
  if (!visible && !items.length) return null;
  const container = { show: { transition: { staggerChildren: reduced ? 0 : 0.04 } } };
  const card = { hidden: reduced ? { opacity: 0 } : { opacity: 0, y: 12 }, show: (i: number) => ({ opacity: 1, y: 0, transition: { ...spring, delay: reduced ? 0 : i * 0.04 } }) };
  return <section className="shelf"><div className="section-heading"><div><h2>{title}</h2><p>{subtitle}</p></div></div><motion.div className="shelf-scroll" variants={container} initial="hidden" animate="show"><Presence reduced={reduced} onExitComplete={() => { if (!items.length) setVisible(false); }}>{items.map((x, i) => <motion.div layout key={x.id} className="catalog-card" variants={card} initial="hidden" animate="show" custom={i} exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.88, flexBasis: 0, marginRight: -16, transition: spring }}><motion.button className="catalog-card-main" whileHover={reduced ? undefined : { y: -4 }} whileTap={reduced ? undefined : { scale: 0.96 }} transition={spring} onClick={() => onPlay(x, items)}><span className="catalog-art" style={{ backgroundImage: `url('${imageFor(x)}')` }}><span className="catalog-play"><Play size={17} fill="currentColor" /></span></span><b>{x.title}</b></motion.button><button className="artist-link" onClick={() => onOpenArtist(x.artist)} title={t('openArtist')}>{x.artist}</button><BlockButton label={t('blockFor', { title: x.title })} reduced={reduced} size={15} className="block-card" onBlock={() => onBlock(x)} /><button className="radio-card" title={t('radio')} aria-label={t('radioFor', { title: x.title })} onClick={() => onRadio(x)}><Radio size={15} /></button></motion.div>)}</Presence></motion.div></section>;
}
