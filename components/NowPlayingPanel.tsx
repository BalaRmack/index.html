'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { AudioLines, ExternalLink, Radio, X } from 'lucide-react';
import type { ArtistInfoView, PlayerBindings, Track } from '@/lib/types';
import { formatDuration } from '@/lib/format';
import { BlockButton, LikeButton } from './MotionButtons';

const spring = { type: 'spring' as const, stiffness: 340, damping: 30 };
const imageFor = (track: Track) => track.video_id ? `https://i.ytimg.com/vi/${track.video_id}/mqdefault.jpg` : track.thumbnail || '/images/hero.png';
/** Кэш на модуле: панель открывается часто, а артист тот же. */
const artistCache = new Map<string, ArtistInfoView>();

export function useArtistInfo(name: string | undefined, language: string) {
  const [info, setInfo] = useState<ArtistInfoView | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const artist = (name || '').trim();
    if (artist.length < 2) { setInfo(null); setFailed(false); return; }
    const cacheKey = `${language.startsWith('en') ? 'en' : 'ru'}:${artist.toLowerCase()}`;
    const cached = artistCache.get(cacheKey);
    if (cached) { setInfo(cached); setFailed(false); return; }
    const controller = new AbortController();
    let alive = true;
    setInfo(null);
    setFailed(false);
    // Ответ приходит даже при недоступном Deezer — просто беднее, панель не зависает.
    void fetch(`/api/artist?name=${encodeURIComponent(artist)}&lang=${language.startsWith('en') ? 'en' : 'ru'}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('unavailable');
        const data = await response.json();
        if (!alive) return;
        const view: ArtistInfoView = {
          name: data.name || artist,
          picture: data.picture || null,
          genres: Array.isArray(data.genres) ? data.genres : [],
          fans: Number.isFinite(data.fans) ? data.fans : null,
          albums: Number.isFinite(data.albums) ? data.albums : null,
          biography: typeof data.biography === 'string' ? data.biography.slice(0, 1400) : '',
          wikiUrl: typeof data.wikiUrl === 'string' ? data.wikiUrl : null,
          // Ответ прокси может прийти в другой форме (или вообще не про артиста) — нормализуем.
          similar: (Array.isArray(data.similar) ? data.similar : [])
            .map((row: any) => ({ name: typeof row?.name === 'string' ? row.name.slice(0, 160) : '', picture: typeof row?.picture === 'string' ? row.picture : null }))
            .filter((row: { name: string }) => row.name.length > 1)
            .slice(0, 8),
          tracks: (Array.isArray(data.tracks) ? data.tracks : [])
            .filter((row: any) => typeof row?.id === 'string' && typeof row?.title === 'string' && typeof row?.artist === 'string')
            .slice(0, 6),
        };
        artistCache.set(cacheKey, view);
        setInfo(view);
      })
      .catch((error) => { if (alive && (error as Error)?.name !== 'AbortError') setFailed(true); });
    return () => { alive = false; controller.abort(); };
  }, [name, language]);
  return { info, failed };
}

/**
 * Правая выдвижная панель «Сейчас играет»: обложка, данные трека, похожие клипы
 * и карточка артиста с радиво по исполнителю.
 */
export default function NowPlayingPanel({ player, side = 'right', onClose, onAddToPlaylist }: {
  player: PlayerBindings;
  side?: 'right' | 'left';
  onClose: () => void;
  onAddToPlaylist?: (track: Track) => void;
}) {
  const { current, t } = player;
  const { info, failed } = useArtistInfo(current?.artist, player.prefs.language);
  const upcoming = player.queue.slice(player.queueIndex + 1, player.queueIndex + 4);
  const suggestions = [...upcoming, ...(info?.tracks ?? []).filter((track) => track.id !== current?.id)]
    .filter((track, index, list) => track && list.findIndex((item) => item.id === track.id) === index)
    .slice(0, 3);

  return (
    <motion.aside
      className={`now-playing-panel glass${side === 'left' ? ' is-left' : ''}`}
      role="complementary"
      aria-label={t('nowPlayingPanel')}
      initial={player.reduced ? { opacity: 0 } : { opacity: 0, x: side === 'left' ? -24 : 24, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={player.reduced ? { opacity: 0 } : { opacity: 0, x: side === 'left' ? -20 : 20, scale: 0.985 }}
      transition={player.reduced ? { duration: 0 } : spring}
    >
      <header className="panel-head">
        <div>
          <span className="panel-kicker">{player.contextLabel || t('playingNow')}</span>
          <h2>{t('playingNow')}</h2>
        </div>
        <button className="panel-close" aria-label={t('closePanel')} onClick={onClose}><X size={17} /></button>
      </header>

      {/* Новый трек показывается сразу: анимация выхода старого не блокирует смену. */}
        <motion.div
          key={current?.id ?? 'empty'}
          className="panel-body"
          initial={player.reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}

          transition={{ duration: player.reduced ? 0 : 0.24 }}
        >
          {current ? (
            <>
              <motion.div
                className="panel-art"
                style={{ backgroundImage: `url('${imageFor(current)}')` }}
                animate={player.playing && !player.reduced ? { scale: [1, 1.015, 1] } : { scale: 1 }}
                transition={{ duration: 3.4, repeat: player.playing ? Infinity : 0, ease: 'easeInOut' }}
              />
              <div className="panel-track">
                <b>{current.title}</b>
                <button className="panel-artist" onClick={() => void player.onOpenArtist(current.artist)} title={t('openArtist')}>{current.artist}</button>
                <div className="panel-actions">
                  <LikeButton
                    active={player.likes.includes(current.id)}
                    label={player.likes.includes(current.id) ? t('unlike') : t('like')}
                    reduced={player.reduced}
                    onToggle={() => player.onToggleLike(current)}
                  />
                  <BlockButton label={t('block')} reduced={player.reduced} onBlock={() => player.onBlock(current)} />
                  <button className="panel-icon" aria-label={t('artistRadio')} title={t('artistRadio')} onClick={() => player.onRadio(current)} disabled={!current.video_id}>
                    <Radio size={16} />
                  </button>
                  {onAddToPlaylist && (
                    <button className="panel-icon" aria-label={t('addToPlaylist')} title={t('addToPlaylist')} onClick={() => onAddToPlaylist(current)}>
                      <AudioLines size={16} />
                    </button>
                  )}
                </div>
              </div>

              {suggestions.length > 0 && (
                <section className="panel-block">
                  <h3>{t('moreByArtist')}</h3>
                  <div className="panel-suggestions">
                    {suggestions.map((track, index) => (
                      <motion.button key={`${track.id}-${index}`} className="suggest-card" whileHover={player.reduced ? undefined : { y: -3 }} whileTap={player.reduced ? undefined : { scale: 0.97 }} onClick={() => player.onPlay(track, suggestions)}>
                        <span className="suggest-art" style={{ backgroundImage: `url('${imageFor(track)}')` }} />
                        <span className="suggest-text">
                          <b>{track.title}</b>
                          <small>{track.artist}</small>
                        </span>
                        <span className="suggest-time">{formatDuration(track.duration)}</span>
                      </motion.button>
                    ))}
                  </div>
                </section>
              )}

              <section className="panel-block">
                <h3>{t('aboutArtist')}</h3>
                {info ? (
                  <div className="artist-card">
                    {info.picture && <img src={info.picture} alt="" loading="lazy" width={64} height={64} />}
                    <div className="artist-card-body">
                      {info.genres.length > 0 && (
                        <span className="artist-genres">{info.genres.slice(0, 3).map((genre) => <i key={genre}>{genre}</i>)}</span>
                      )}
                      {info.biography ? <p>{info.biography.length > 220 ? `${info.biography.slice(0, 220).trimEnd()}…` : info.biography}</p> : <p>{t('artistInfoFailed')}</p>}
                      <div className="artist-card-actions">
                        <button className="primary" onClick={() => player.onOpenArtist(info.name)}>{t('artistPage')}</button>
                        <button className="ghost" onClick={() => player.onRadio({ ...current, artist: info.name, title: current.title })} disabled={!current.video_id}>
                          <Radio size={14} /> {t('artistRadio')}
                        </button>
                      </div>
                      {info.wikiUrl && <a className="artist-wiki" href={info.wikiUrl} target="_blank" rel="noreferrer">{t('biography')} <ExternalLink size={12} /></a>}
                    </div>
                  </div>
                ) : (
                  <p className="panel-muted">{failed ? t('artistInfoFailed') : t('lyricsLoading')}</p>
                )}
                {info?.similar.length ? (
                  <div className="artist-similar">
                    {info.similar.slice(0, 6).map((artist, index) => (
                      <button key={`${artist.name}-${index}`} onClick={() => player.onOpenArtist(artist.name)}>{artist.name}</button>
                    ))}
                  </div>
                ) : null}
              </section>
            </>
          ) : (
            <p className="panel-muted">{t('queueEmpty')}</p>
          )}
        </motion.div>
    </motion.aside>
  );
}
