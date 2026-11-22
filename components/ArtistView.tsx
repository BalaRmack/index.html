'use client';

import { motion } from 'framer-motion';
import { Play, Radio } from 'lucide-react';
import type { PlayerBindings, Track } from '@/lib/types';
import { useArtistInfo } from './NowPlayingPanel';
import { BlockButton, LikeButton } from './MotionButtons';
import { formatDuration } from '@/lib/format';

const imageFor = (track: Track) => track.video_id ? `https://i.ytimg.com/vi/${track.video_id}/mqdefault.jpg` : track.thumbnail || '/images/hero.png';
const spring = { type: 'spring' as const, stiffness: 340, damping: 30 };

/** Страница артиста: шапка, популярные треки, похожие исполнители. Открывается кликом по имени. */
export default function ArtistView({ name, player, onBack }: { name: string; player: PlayerBindings; onBack: () => void }) {
  const { info, failed } = useArtistInfo(name, player.prefs.language);
  const tracks = info?.tracks ?? [];
  const artist = info?.name || name;
  const listen = () => {
    const seed = tracks[0];
    if (seed) player.onPlay(seed, tracks);
    else if (tracks[0]) player.onRadio(tracks[0]);
  };

  return (
    <motion.section className="artist-view" initial={player.reduced ? { opacity: 0 } : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
      <button className="artist-back" onClick={onBack}>← {player.t('back')}</button>
      <header className="artist-head">
        <div className="artist-portrait" style={info?.picture ? { backgroundImage: `url('${info.picture}')` } : undefined}>
          {!info?.picture && <span>{(artist[0] || 'N').toUpperCase()}</span>}
        </div>
        <div className="artist-headline">
          <span className="panel-kicker">{player.t('artistPage')}</span>
          <h1>{artist}</h1>
          {info?.genres.length ? <div className="artist-genres">{info.genres.slice(0, 5).map((genre) => <i key={genre}>{genre}</i>)}</div> : null}
          <p className="artist-stats">
            {info?.albums ? <span>{info.albums} albums</span> : null}
            {info?.fans ? <span>{player.t('listeners', { count: info.fans.toLocaleString('ru-RU') })}</span> : null}
          </p>
          <div className="artist-actions">
            <motion.button className="primary" whileTap={player.reduced ? undefined : { scale: 0.95 }} onClick={listen} disabled={!tracks.length}>
              <Play size={15} fill="currentColor" /> {player.t('listenAll')}
            </motion.button>
            <button className="ghost" onClick={() => tracks[0] && player.onRadio(tracks[0])} disabled={!tracks[0]}>
              <Radio size={15} /> {player.t('artistRadio')}
            </button>
          </div>
        </div>
      </header>

      {info?.biography ? (
        <section className="artist-bio">
          <h2>{player.t('biography')}</h2>
          <p>{info.biography}</p>
          {info.wikiUrl && <a href={info.wikiUrl} target="_blank" rel="noreferrer">{player.t('openArtist')} ↗</a>}
        </section>
      ) : null}

      {failed && !info ? <p className="catalog-status">{player.t('artistInfoFailed')}</p> : null}

      <section className="section">
        <div className="section-heading"><div><h2>{player.t('popularTracks')}</h2></div></div>
        {tracks.length ? (
          <div className="track-list">
            {tracks.map((track, index) => (
              <div className="track-row" key={track.id}>
                <button className="track-number" onClick={() => player.onPlay(track, tracks)}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                </button>
                <button className="track-title" onClick={() => player.onPlay(track, tracks)}>
                  <span className="track-art" style={{ backgroundImage: `url('${imageFor(track)}')` }} />
                  <span><b>{track.title}</b><small>{track.artist}</small></span>
                </button>
                <span className="track-album">{track.album || '—'}</span>
                <span className="track-time">{formatDuration(track.duration)}</span>
                <div className="track-controls">
                  <button title={player.t('artistRadio')} aria-label={player.t('radioFor', { title: track.title })} onClick={() => player.onRadio(track)}><Radio size={16} /></button>
                  <LikeButton active={player.likes.includes(track.id)} label={player.likes.includes(track.id) ? player.t('unlike') : player.t('like')} reduced={player.reduced} size={16} onToggle={() => player.onToggleLike(track)} />
                  <BlockButton label={player.t('blockFor', { title: track.title })} reduced={player.reduced} size={16} onBlock={() => player.onBlock(track)} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="catalog-status">{player.t('catalogUnavailable')}</p>
        )}
      </section>

      {info?.similar.length ? (
        <section className="section">
          <div className="section-heading"><div><h2>{player.t('similarArtists')}</h2></div></div>
          <div className="artist-chips">
            {info.similar.map((item) => (
              <motion.button key={item.name} whileHover={player.reduced ? undefined : { y: -3 }} whileTap={player.reduced ? undefined : { scale: 0.97 }} onClick={() => player.onOpenArtist(item.name)}>
                {item.picture ? <img src={item.picture} alt="" loading="lazy" /> : <span>{(item.name[0] || '?').toUpperCase()}</span>}
                <b>{item.name}</b>
              </motion.button>
            ))}
          </div>
        </section>
      ) : null}
    </motion.section>
  );
}
