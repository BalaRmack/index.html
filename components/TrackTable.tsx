'use client';

import { motion } from 'framer-motion';
import { ListPlus, Music2, Pencil, Play, Radio, Trash2, X } from 'lucide-react';
import type { Playlist, Track } from '@/lib/types';
import type { Translate } from '@/lib/i18n';
import { formatAddedDate, formatDuration } from '@/lib/format';
import { BlockButton, LikeButton } from './MotionButtons';
import Presence from './Presence';

const imageFor = (track: Track) => (track.video_id ? `https://i.ytimg.com/vi/${track.video_id}/mqdefault.jpg` : track.thumbnail || '/images/hero.png');

type Props = {
  t: Translate;
  view: string;
  search: string;
  searchStatus?: string;
  tracks: Track[];
  playlists: Playlist[];
  playlist?: Playlist;
  current: Track | null;
  playing: boolean;
  duration: number;
  likes: string[];
  language: string;
  reduced: boolean;
  onPlay: (track: Track, list: Track[]) => void;
  onRadio: (track: Track) => void;
  onToggleLike: (track: Track) => void;
  onBlock: (track: Track) => void;
  onOpenArtist: (name: string) => void;
  onAddToPlaylist: (track: Track, id: string) => void;
  onQueueAdd: (track: Track) => void;
  onPlaylistRemove?: (track: Track) => void;
  onPlaylistRename?: () => void;
  onPlaylistCover?: () => void;
  onPlaylistDelete?: () => void;
};

/**
 * Таблица медиатеки. «Источник» убран из интерфейса — это техническая деталь;
 * вместо него Альбом и честная дата добавления, у каждой строки есть «Не рекомендовать».
 */
export default function TrackTable({ t, view, search, searchStatus = '', tracks, playlists, playlist, current, playing, duration, likes, language, reduced, onPlay, onRadio, onToggleLike, onBlock, onOpenArtist, onAddToPlaylist, onQueueAdd, onPlaylistRemove, onPlaylistRename, onPlaylistCover, onPlaylistDelete }: Props) {
  const inPlaylist = view.startsWith('playlist:');
  const locale = language === 'en' ? 'en-US' : 'ru-RU';

  return (
    <>
      {playlist && (
        <div className="playlist-tools" aria-label={t('playlistTools')}>
          <span className="playlist-cover-lg" style={playlist.cover_url ? { backgroundImage: `url('${playlist.cover_url.replace(/'/g, '%27')}')` } : undefined}>{!playlist.cover_url && <Music2 size={20} />}</span>
          <div className="playlist-tools-text">
            <b>{playlist.name}</b>
            <small>{t('tracksCount', { count: tracks.length })}{playlist.created_at ? ` · ${formatAddedDate(playlist.created_at, { locale })}` : ''}</small>
          </div>
          <div className="playlist-tools-actions">
            <button onClick={() => tracks[0] && onPlay(tracks[0], tracks)} disabled={!tracks.length}><Play size={14} fill="currentColor" /> {t('listenAll')}</button>
            {onPlaylistRename && <button onClick={onPlaylistRename}><Pencil size={14} /> {t('rename')}</button>}
            {onPlaylistCover && <button onClick={onPlaylistCover}><Music2 size={14} /> {t('playlistCover')}</button>}
            {onPlaylistDelete && <button className="danger" onClick={onPlaylistDelete}><Trash2 size={14} /> {t('playlistDelete')}</button>}
          </div>
        </div>
      )}

      <div className="track-head"><span>#</span><span>{t('colTitle')}</span><span>{t('colAlbum')}</span><span>{t('colAdded')}</span><span><Music2 size={15} /></span><span /></div>
      <div className="track-list">
        {inPlaylist && !tracks.length && <div className="empty">{t('playlistEmpty')}</div>}
        {tracks.map((track, index) => {
          const isCurrent = current?.id === track.id;
          return (
            <motion.div className={`track-row${isCurrent ? ' is-current' : ''}`} layout={!reduced} key={track.id} initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : 0.22, delay: reduced ? 0 : Math.min(index, 12) * 0.012 }}>
              <button className="track-number" onClick={() => onPlay(track, tracks)} aria-label={t('playTrack')}>
                {isCurrent && playing ? <span className="row-eq" aria-hidden="true"><i /><i /><i /></span> : <><span>{String(index + 1).padStart(2, '0')}</span><Play className="row-play" size={15} fill="currentColor" /></>}
              </button>
              <div className="track-title" role="button" tabIndex={0} onClick={() => onPlay(track, tracks)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onPlay(track, tracks); } }}>
                <span className="track-art" style={{ backgroundImage: `url('${imageFor(track)}')` }} />
                <span className="track-names">
                  <b>{track.title}</b>
                  <button type="button" className="track-artist" onClick={(event) => { event.stopPropagation(); onOpenArtist(track.artist); }}>{track.artist}</button>
                </span>
                {track.source && track.source !== 'local' && <span className="track-badge">{track.source === 'youtube' ? t('previewBadge') : t('fromCatalog')}</span>}
              </div>
              <span className="track-album" title={track.album || undefined}>{track.album || t('noAlbum')}</span>
              <span className="track-added">{formatAddedDate(track.created_at, { locale }) || t('recentlyAdded')}</span>
              <span className="track-time">{formatDuration(isCurrent && duration ? duration : track.duration)}</span>
              <div className="track-controls">
                {track.video_id && <button title={t('radio')} aria-label={t('radioFor', { title: track.title })} onClick={() => onRadio(track)}><Radio size={16} /></button>}
                <button title={t('queueAdd')} aria-label={t('queueAdd')} onClick={() => onQueueAdd(track)}><ListPlus size={16} /></button>
                <LikeButton active={likes.includes(track.id)} label={likes.includes(track.id) ? t('unlike') : t('like')} reduced={reduced} size={16} onToggle={() => onToggleLike(track)} />
                <BlockButton label={t('blockFor', { title: track.title })} reduced={reduced} size={16} onBlock={() => onBlock(track)} />
                {playlists.length > 0 && (
                  <select aria-label={t('addToPlaylist')} value="" onChange={(event) => { if (event.target.value) onAddToPlaylist(track, event.target.value); }}>
                    <option value="">＋</option>
                    {playlists.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                )}
                {inPlaylist && onPlaylistRemove && <button title={t('playlistRemoveTrack')} aria-label={t('playlistRemoveTrack')} onClick={() => onPlaylistRemove(track)}><X size={15} /></button>}
              </div>
            </motion.div>
          );
        })}
        <Presence reduced={reduced}>{search && searchStatus && <motion.div key="status" className="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>{searchStatus}</motion.div>}</Presence>
        {!tracks.length && !search && !inPlaylist && <div className="empty">{view === 'liked' ? t('emptyLiked') : t('emptyLibrary')}</div>}
      </div>
    </>
  );
}
