'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ListMusic, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react';
import type { LyricLine, PlayerBindings, Track } from '@/lib/types';
import { activeLyricLine, lyricsCacheKey } from '@/lib/lyrics';
import { extractPalette, type Palette } from '@/lib/palette';
import { formatDuration } from '@/lib/format';
import { BlockButton, LikeButton } from './MotionButtons';
import WaveVisualizer from './WaveVisualizer';

const spring = { type: 'spring' as const, stiffness: 340, damping: 30 };
const imageFor = (track: Track) => track.video_id ? `https://i.ytimg.com/vi/${track.video_id}/mqdefault.jpg` : track.thumbnail || '/images/hero.png';
type LoadedLyrics = { synced: LyricLine[]; plain: string };
const lyricsCache = new Map<string, LoadedLyrics>();

export function useLyrics(track: Track | null): { lyrics: LoadedLyrics | null; loading: boolean } {
  const [lyrics, setLyrics] = useState<LoadedLyrics | null>(null);
  const [loading, setLoading] = useState(false);
  const key = track ? lyricsCacheKey({ title: track.title, artist: track.artist, duration: track.duration ?? 0 }) : '';
  useEffect(() => {
    if (!track) { setLyrics(null); return; }
    const hit = lyricsCache.get(key);
    if (hit) { setLyrics(hit.synced.length || hit.plain ? hit : null); setLoading(false); return; }
    const controller = new AbortController();
    let alive = true;
    setLyrics(null);
    setLoading(true);
    const params = new URLSearchParams({ title: track.title, artist: track.artist, duration: String(Math.round(track.duration || 0)) });
    void fetch(`/api/lyrics?${params}`, { signal: controller.signal })
      .then(async (response) => (response.ok ? response.json() : { synced: [], plain: '' }))
      .then((data) => {
        if (!alive) return;
        const value: LoadedLyrics = {
          synced: Array.isArray(data?.synced) ? data.synced.filter((line: LyricLine) => Number.isFinite(line?.time) && typeof line?.text === 'string') : [],
          plain: typeof data?.plain === 'string' ? data.plain : '',
        };
        lyricsCache.set(key, value);
        setLyrics(value.synced.length || value.plain ? value : null);
      })
      .catch(() => { if (alive) setLyrics(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; controller.abort(); };
  }, [key, track?.title, track?.artist]);
  return { lyrics, loading };
}

/** Полноэкранный «Сейчас играет» с живым фоном из обложки и синхронным текстом. */
export default function FullscreenPlayer({ player, onClose, mood, onMood }: {
  player: PlayerBindings;
  onClose: () => void;
  mood: PlayerBindings['prefs']['waveMood'];
  onMood: (mood: PlayerBindings['prefs']['waveMood']) => void;
}) {
  const { current, t } = player;
  const { lyrics, loading } = useLyrics(current);
  const [palette, setPalette] = useState<Palette | null>(null);
  const [tab, setTab] = useState<'lyrics' | 'wave'>('lyrics');
  const scroller = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const active = useMemo(() => (lyrics?.synced ? activeLyricLine(lyrics.synced, player.elapsed) : -1), [lyrics, player.elapsed]);
  const synced = lyrics?.synced ?? [];

  useEffect(() => {
    let alive = true;
    if (!current) { setPalette(null); return; }
    void extractPalette(imageFor(current), player.accent).then((value) => { if (alive) setPalette(value); });
    return () => { alive = false; };
  }, [current?.id, current?.video_id, current?.thumbnail, player.accent]);

  // Автопрокрутка: держим активную строку примерно по центру, без рывков.
  useEffect(() => {
    if (active < 0 || tab !== 'lyrics') return;
    const container = scroller.current;
    const element = lineRefs.current[active];
    if (!container || !element) return;
    const target = element.offsetTop - container.clientHeight / 2 + element.clientHeight / 2;
    container.scrollTo({ top: Math.max(0, target), behavior: player.reduced ? 'auto' : 'smooth' });
  }, [active, tab, player.reduced]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const base = palette?.base ?? player.accent;
  const progress = player.duration ? Math.min(100, (player.elapsed / player.duration) * 100) : 0;

  return (
    <motion.div
      className="fullscreen-player"
      role="dialog"
      aria-modal="true"
      aria-label={t('playingNow')}
      initial={player.reduced ? { opacity: 0 } : { opacity: 0, scale: 1.02 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={player.reduced ? { opacity: 0 } : { opacity: 0, scale: 0.99 }}
      transition={player.reduced ? { duration: 0 } : spring}
      style={{ ['--fp-base' as string]: base, ['--fp-glow' as string]: palette?.glow ?? base, ['--fp-deep' as string]: palette?.deep ?? base } as React.CSSProperties}
    >
      <div className="fp-backdrop" aria-hidden="true">
        <motion.span
          className="fp-blob fp-blob-a"
          animate={player.reduced ? {} : { rotate: 360, scale: player.playing ? [1, 1.08, 1] : [1, 1.02, 1] }}
          transition={{ rotate: { duration: 90, repeat: Infinity, ease: 'linear' }, scale: { duration: 6, repeat: Infinity, ease: 'easeInOut' } }}
        />
        <motion.span
          className="fp-blob fp-blob-b"
          animate={player.reduced ? {} : { rotate: -360 }}
          transition={{ duration: 120, repeat: Infinity, ease: 'linear' }}
        />
        {player.prefs.particles !== 'off' && <WaveVisualizer playing={player.playing} mood={mood} accent={base} particles={player.prefs.particles} reduced={player.reduced} analyser={player.analyser} className="fp-canvas" />}
      </div>

      <header className="fp-head">
        <span className="panel-kicker">{player.contextLabel || t('playingNow')}</span>
        <div className="fp-head-actions">
          <button className="fp-mood" aria-label={t('waveMoodLabel')} onClick={() => setTab(tab === 'wave' ? 'lyrics' : 'wave')}>{tab === 'wave' ? t('lyrics') : t('waveMoodLabel')}</button>
          <button className="panel-close" aria-label={t('collapsePlayer')} title={t('collapsePlayer')} onClick={onClose}><X size={18} /></button>
        </div>
      </header>

      <div className="fp-grid">
        <section className="fp-left">
          <motion.div
            className="fp-art"
            style={{ backgroundImage: current ? `url('${imageFor(current)}')` : undefined }}
            animate={player.playing && !player.reduced ? { scale: [1, 1.012, 1], y: [0, -4, 0] } : { scale: 1, y: 0 }}
            transition={{ duration: 7, repeat: player.playing && !player.reduced ? Infinity : 0, ease: 'easeInOut' }}
          />
          <div className="fp-meta">
            <h2>{current?.title || t('queueEmpty')}</h2>
            {current && (
              <button className="fp-artist" onClick={() => { onClose(); player.onOpenArtist(current.artist); }}>{current.artist}</button>
            )}
          </div>
          <div className="fp-progress">
            <span>{formatDuration(player.elapsed)}</span>
            <input
              type="range"
              aria-label={t('seek')}
              min={0}
              max={player.duration || 0}
              step={0.5}
              value={Math.min(player.elapsed, player.duration || 0)}
              onChange={(event) => player.onSeek(Number(event.target.value))}
              style={{ ['--progress' as string]: `${progress}%` } as React.CSSProperties}
            />
            <span>{formatDuration(player.duration)}</span>
          </div>
          <div className="fp-controls">
            <button className="ghost" aria-label={t('previousTrack')} onClick={() => player.onSkip(-1)}><SkipBack size={18} /></button>
            <button className="primary" aria-label={player.playing ? t('pauseTrack') : t('playTrack')} onClick={player.onTogglePlay}>{player.playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button>
            <button className="ghost" aria-label={t('nextTrack')} onClick={() => player.onSkip(1)}><SkipForward size={18} /></button>
            {current && (
              <>
                <LikeButton active={player.likes.includes(current.id)} label={player.likes.includes(current.id) ? t('unlike') : t('like')} reduced={player.reduced} size={20} onToggle={() => player.onToggleLike(current)} />
                <BlockButton label={t('block')} reduced={player.reduced} size={20} onBlock={() => player.onBlock(current)} />
              </>
            )}
            <span className="fp-moods" role="group" aria-label={t('waveMoodLabel')}>
              {([['energetic', t('waveMoodEnergetic')], ['calm', t('waveMoodCalm')], ['unknown', t('waveMoodUnknown')], ['loved', t('waveMoodLoved')]] as const).map(([id, label]) => (
                <button key={id} className={mood === id ? 'on' : undefined} onClick={() => onMood(id)}>{label}</button>
              ))}
            </span>
          </div>
          <p className="fp-hint">{t('waveMoodHint')}</p>
        </section>

        <section className="fp-right">
          <LayoutGroup id="fp-tabs-group">
            <div className="fp-tabs" role="tablist">
              {([['lyrics', t('lyrics')], ['mood', t('waveMoodTitle')]] as const).map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={rightTab === id} className={rightTab === id ? 'on' : undefined} onClick={() => setRightTab(id)}>
                  {rightTab === id && <motion.span layoutId="fp-tab-pill" className="fp-tab-pill" transition={{ type: 'spring', stiffness: 380, damping: 30 }} />}
                  <span className="fp-tab-label">{label}</span>
                </button>
              ))}
            </div>
          </LayoutGroup>
          {tab === 'lyrics' ? (
            <div className="fp-lyrics" ref={scroller}>
              {loading && <p className="panel-muted">{t('lyricsLoading')}</p>}
              {!loading && !lyrics && <p className="panel-muted">{t('lyricsEmpty')}</p>}
              {lyrics && synced.length > 0 && (
                <>
                  <p className="fp-lyrics-hint">{t('lyricsSeekHint')}</p>
                  {synced.map((line, index) => (
                    <motion.button
                      key={`${line.time}-${index}`}
                      ref={(element) => { lineRefs.current[index] = element; }}
                      className={`lyric-line${index === active ? ' is-active' : ''}`}
                      onClick={() => player.onSeek(line.time)}
                      animate={index === active && !player.reduced ? { scale: 1.02 } : { scale: 1 }}
                      transition={{ duration: 0.25 }}
                    >
                      {line.text}
                    </motion.button>
                  ))}
                </>
              )}
              {lyrics && !synced.length && lyrics.plain && (
                <>
                  <p className="fp-lyrics-hint">{t('lyricsPlain')}</p>
                  <pre className="lyric-plain">{lyrics.plain}</pre>
                </>
              )}
            </div>
          ) : (
            <div className="fp-wave">
              <WaveVisualizer playing={player.playing} mood={mood} accent={base} particles={player.prefs.particles} reduced={player.reduced} analyser={player.analyser} className="fp-wave-canvas" />
              <div className="fp-wave-moods">
                {([['energetic', t('waveMoodEnergetic')], ['calm', t('waveMoodCalm')], ['unknown', t('waveMoodUnknown')], ['loved', t('waveMoodLoved')]] as const).map(([id, label]) => (
                  <button key={id} className={mood === id ? 'on' : undefined} onClick={() => onMood(id)}>{label}</button>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
      
    </motion.div>
  );
}
