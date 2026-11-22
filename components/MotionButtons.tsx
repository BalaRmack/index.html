'use client';

import { useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Ban, Heart, Volume2, VolumeX } from 'lucide-react';
import Presence from './Presence';

/**
 * «Сочные» микро-анимации плеера. Всё уважает prefers-reduced-motion:
 * при reduced гаснут только всплески частиц, сами нажатия остаются мгновенными.
 */
const spring = { type: 'spring' as const, stiffness: 420, damping: 22 };
const SPARKS = 8;
// Два пути с одинаковым числом команд — так morph между ▶ и ‖ действительно интерполируется.
const PLAY_PATH = ['M8 5 L8 19 L13.4 16.1 L13.4 7.9 Z', 'M13.4 7.9 L13.4 16.1 L19 12 L19 12 Z'];
const PAUSE_PATH = ['M7.6 5.4 L7.6 18.6 L10.6 18.6 L10.6 5.4 Z', 'M13.4 5.4 L13.4 18.6 L16.4 18.6 L16.4 5.4 Z'];

type BaseProps = {
  label: string;
  title?: string;
  className?: string;
  reduced?: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
};

/** Импульс: короткое смещение/поворот иконки в сторону действия. */
export function ImpulseButton({ label, title, className, reduced, onClick, disabled, children, variant = 'right' }: BaseProps & { variant?: 'right' | 'left' | 'shuffle' | 'repeat' | 'mute' }) {
  const [burst, setBurst] = useState(0);
  const gesture = variant === 'left' ? { x: [0, -5, 0] }
    : variant === 'right' ? { x: [0, 5, 0] }
    : variant === 'shuffle' ? { rotate: [-14, 12, 0], y: [0, -3, 0] }
    : variant === 'repeat' ? { rotate: [0, 360] }
    : { x: [0, -2.5, 2.5, -1.5, 1.5, 0] };
  return (
    <motion.button
      type="button"
      className={className}
      aria-label={label}
      title={title || label}
      disabled={disabled}
      onClick={() => { setBurst((value) => value + 1); onClick(); }}
      whileTap={reduced ? undefined : { scale: 0.88 }}
      transition={spring}
    >
      <motion.span
        key={burst}
        className="impulse-icon"
        initial={false}
        animate={reduced ? { rotate: 0, x: 0 } : gesture}
        transition={{ duration: variant === 'repeat' ? 0.5 : 0.32, ease: 'easeOut' }}
      >
        {children}
      </motion.span>
    </motion.button>
  );
}

/** Лайк: пружинный отскок, расходящееся кольцо и разлёт искр акцентного цвета. */
export function LikeButton({ active, onToggle, label, reduced = false, size = 17 }: { active: boolean; onToggle: () => void; label: string; reduced?: boolean; size?: number }) {
  const [burst, setBurst] = useState(0);
  const [direction, setDirection] = useState(1);
  const sparks = useRef(Array.from({ length: SPARKS }, (_, index) => {
    const angle = (Math.PI * 2 * index) / SPARKS + 0.4;
    return { x: Math.cos(angle) * 22, y: Math.sin(angle) * 22 };
  })).current;

  return (
    <motion.button
      type="button"
      className={active ? 'liked icon-burst' : 'icon-burst'}
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={() => { setDirection(active ? -1 : 1); setBurst((value) => value + 1); onToggle(); }}
      initial={false}
      animate={reduced || burst === 0
        ? { scale: 1, rotate: 0 }
        : direction > 0
          ? { scale: [1, 1.45, 0.9, 1.1, 1], rotate: [0, -8, 4, 0, 0] }
          : { scale: [1, 0.8, 1.04, 1], rotate: [0, 6, -3, 0] }}
      transition={{ duration: 0.46, ease: 'easeOut' }}
      whileTap={reduced ? undefined : { scale: 0.9 }}
    >
      <Heart size={size} fill={active ? 'currentColor' : 'none'} />
      <Presence reduced={reduced}>
        {burst > 0 && direction > 0 && !reduced && (
          <motion.span
            key={`ring-${burst}`}
            className="burst-ring"
            aria-hidden="true"
            initial={{ scale: 0.35, opacity: 0.75 }}
            animate={{ scale: 2.1, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.55, ease: 'easeOut' }}
          />
        )}
      </Presence>
      <Presence reduced={reduced}>
        {burst > 0 && direction > 0 && !reduced && (
          <motion.span key={`sparks-${burst}`} className="burst-sparks" aria-hidden="true">
            {sparks.map((spark, index) => (
              <motion.i
                key={index}
                initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
                animate={{ x: spark.x, y: spark.y, scale: [1, 1.3, 0], opacity: [1, 0.9, 0] }}
                transition={{ duration: 0.52 + index * 0.012, ease: [0.2, 0.9, 0.3, 1] }}
              />
            ))}
          </motion.span>
        )}
      </Presence>
    </motion.button>
  );
}

/** Дизлайк: резкий наклон с красным импульсом — «убрать из рекомендаций» должно чувствоваться. */
export function BlockButton({ onBlock, label, reduced = false, size = 17, className }: { onBlock: () => void; label: string; reduced?: boolean; size?: number; className?: string }) {
  const [burst, setBurst] = useState(0);
  return (
    <motion.button
      type="button"
      className={className ? `${className} icon-burst block-action` : 'icon-burst block-action'}
      aria-label={label}
      title={label}
      onClick={() => { setBurst((value) => value + 1); onBlock(); }}
      initial={false}
      animate={burst ? { rotate: reduced ? 0 : [0, -18, 12, 0], scale: [1, 1.16, 0.94, 1] } : { rotate: 0, scale: 1 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      whileTap={reduced ? undefined : { scale: 0.9 }}
    >
      <Ban size={size} />
      <Presence reduced={reduced}>
        {burst > 0 && !reduced && (
          <motion.span
            key={burst}
            className="burst-ring is-danger"
            aria-hidden="true"
            initial={{ scale: 0.4, opacity: 0.85 }}
            animate={{ scale: 2, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        )}
      </Presence>
    </motion.button>
  );
}

/** Play ↔ Pause: плавный морфинг пути и мягкое свечение во время воспроизведения. */
export function PlayPauseButton({ playing, onClick, label, reduced = false, size = 34, disabled }: { playing: boolean; onClick: () => void; label: string; reduced?: boolean; size?: number; disabled?: boolean }) {
  return (
    <motion.button
      type="button"
      className="play-main"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      whileTap={reduced ? undefined : { scale: 0.9 }}
      transition={spring}
      animate={playing && !reduced
        ? { boxShadow: ['0 0 0 0 var(--green-glow)', '0 0 0 7px rgba(0,0,0,0)', '0 0 0 0 rgba(0,0,0,0)'] }
        : { boxShadow: '0 0 0 0 rgba(0,0,0,0)' }}
    >
      <svg className="play-icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
        {PLAY_PATH.map((path, index) => (
          <motion.path
            key={index}
            fill="currentColor"
            initial={false}
            animate={{ d: playing ? PAUSE_PATH[index] : path }}
            transition={{ type: 'spring', stiffness: 380, damping: 26 }}
          />
        ))}
      </svg>
    </motion.button>
  );
}

export function VolumeButton({ muted, onClick, label, reduced = false }: Omit<BaseProps, 'children'> & { muted: boolean }) {
  return (
    <ImpulseButton label={label} title={label} onClick={onClick} reduced={reduced} variant="mute" className={muted ? 'on' : undefined}>
      {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
    </ImpulseButton>
  );
}
