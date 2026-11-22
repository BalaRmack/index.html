'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { AudioLines, GripVertical, X } from 'lucide-react';
import type { PlayerBindings, Track } from '@/lib/types';
import Presence from './Presence';

const spring = { type: 'spring' as const, stiffness: 360, damping: 30 };
const imageFor = (track: Track) => track.video_id ? `https://i.ytimg.com/vi/${track.video_id}/mqdefault.jpg` : track.thumbnail || '/images/hero.png';

/**
 * Панель очереди: «играет сейчас» + «далее», перетаскивание мышью,
 * кнопки-стрелки для клавиатуры и мобильных, удаление лишнего.
 */
export default function QueuePanel({ player, onClose }: { player: PlayerBindings; onClose: () => void }) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [hoverAt, setHoverAt] = useState<number | null>(null);
  const playing = Boolean(player.current);
  // Без играющего трека показываем всю очередь и сдвигаем индексы на 0, а не на 1.
  const offset = playing ? 1 : 0;
  const visible = playing ? player.queue.slice(player.queueIndex) : player.queue;
  const upcoming = playing ? visible.slice(1) : visible;

  const moveUpcoming = (from: number, to: number) => {
    if (from === to) return;
    player.onQueueMove(player.queueIndex + offset + from, player.queueIndex + offset + to);
  };

  return (
    <motion.aside
      className="now-playing-panel queue-panel glass"
      role="complementary"
      aria-label={player.t('queue')}
      initial={player.reduced ? { opacity: 0 } : { opacity: 0, x: 24, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={player.reduced ? { opacity: 0 } : { opacity: 0, x: 20, scale: 0.985 }}
      transition={player.reduced ? { duration: 0 } : spring}
    >
      <header className="panel-head">
        <div>
          <span className="panel-kicker">{player.contextLabel || player.t('queue')}</span>
          <h2>{player.t('queue')}</h2>
        </div>
        <button className="panel-close" aria-label={player.t('closePanel')} onClick={onClose}><X size={17} /></button>
      </header>

      {visible.length === 0 ? (
        <p className="panel-muted">{player.t('queueEmpty')}</p>
      ) : (
        <div className="queue-body">
          {playing && visible.length > 0 && (
          <div className="queue-now">
            <h3>{player.t('queueNow')}</h3>
            <div className="queue-row is-now">
              <span className="queue-art" style={{ backgroundImage: `url('${imageFor(visible[0])}')` }} />
              <span className="queue-text"><b>{visible[0].title}</b><small>{visible[0].artist}</small></span>
              <AudioLines size={15} className="queue-live" />
            </div>
          </div>
          )}

          <div className="queue-next">
            <h3>{player.t('queueNext')} <small>{upcoming.length}</small></h3>
            <p className="queue-hint">{player.t('queueDrag')}</p>
            <Presence reduced={player.reduced} initial={false}>
              {upcoming.map((track, index) => (
                <motion.div
                  key={`${track.id}-${index}`}
                  layout={!player.reduced}
                  className={`queue-row${hoverAt === index && dragFrom !== null && dragFrom !== index ? ' is-drop-target' : ''}`}
                  draggable
                  onDragStart={() => setDragFrom(index)}
                  onDragEnd={() => { setDragFrom(null); setHoverAt(null); }}
                  onDragOver={(event) => { event.preventDefault(); setHoverAt(index); }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragFrom !== null) moveUpcoming(dragFrom, index);
                    setDragFrom(null);
                    setHoverAt(null);
                  }}
                  initial={player.reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={player.reduced ? { opacity: 0 } : { opacity: 0, x: -14 }}
                  transition={player.reduced ? { duration: 0 } : spring}
                >
                  <GripVertical size={14} className="queue-grip" aria-hidden="true" />
                  <button className="queue-art" style={{ backgroundImage: `url('${imageFor(track)}')` }} aria-label={player.t('playTrack')} onClick={() => player.onPlay(track, player.queue)} />
                  <button className="queue-text" onClick={() => player.onPlay(track, player.queue)}>
                    <b>{track.title}</b>
                    <small>{track.artist}</small>
                  </button>
                  <span className="queue-tools">
                    <button aria-label={player.t('moveUp')} disabled={index === 0} onClick={() => moveUpcoming(index, index - 1)}>↑</button>
                    <button aria-label={player.t('moveDown')} disabled={index === upcoming.length - 1} onClick={() => moveUpcoming(index, index + 1)}>↓</button>
                    <button aria-label={player.t('queueRemove')} onClick={() => player.onQueueRemove(player.queueIndex + offset + index)}><X size={13} /></button>
                  </span>
                </motion.div>
              ))}
            </Presence>
          </div>
        </div>
      )}
    </motion.aside>
  );
}
