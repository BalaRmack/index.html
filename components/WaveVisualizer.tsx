'use client';

import { useEffect, useRef } from 'react';
import { hexToRgb, withAlpha } from '@/lib/palette';
import type { ParticlesMode, WaveMood } from '@/lib/preferences';

/**
 * Живая визуализация «Моей волны» вместо статичной картинки: дышащая сфера,
 * бегущие волны и частицы, которые реагируют на воспроизведение и настроение.
 * Если у нас есть AnalyserNode (локальный файл через Web Audio) — берём уровень из него,
 * для внешних стримов энергия синтетическая, но привязана к тому же такту.
 */
type Props = {
  playing: boolean;
  mood: WaveMood;
  accent: string;
  particles?: ParticlesMode;
  reduced?: boolean;
  analyser?: AnalyserNode | null;
  className?: string;
  /** Дополнительный множитель амплитуды (например, при наведении курсора). */
  boost?: number;
};

const MOODS: Record<WaveMood, { speed: number; amplitude: number; spread: number; hue: number; waves: number }> = {
  energetic: { speed: 1.55, amplitude: 1.45, spread: 1.15, hue: 8, waves: 5 },
  calm: { speed: 0.42, amplitude: 0.6, spread: 0.7, hue: -10, waves: 3 },
  unknown: { speed: 0.9, amplitude: 1.05, spread: 1.35, hue: 22, waves: 4 },
  loved: { speed: 1.05, amplitude: 0.95, spread: 0.85, hue: -4, waves: 4 },
};

const PARTICLE_COUNT: Record<ParticlesMode, number> = { full: 96, eco: 34, off: 0 };

type Particle = { angle: number; radius: number; speed: number; size: number; drift: number; phase: number };

export default function WaveVisualizer({ playing, mood, accent, particles = 'full', reduced = false, analyser = null, className, boost = 1 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointer = useRef({ x: 0.5, y: 0.5, active: false });
  const stateRef = useRef({ playing, mood, accent, particles, reduced, analyser, boost });
  stateRef.current = { playing, mood, accent, particles, reduced, analyser, boost };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return;

    let width = 0;
    let height = 0;
    let frame = 0;
    let stopped = false;
    const field: Particle[] = [];
    let energy = 0;
    let level = new Uint8Array(0);

    const resize = () => {
      const mode = stateRef.current.particles;
      const ratio = Math.min(window.devicePixelRatio || 1, mode === 'eco' ? 1.35 : 2);
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const seed = (count: number) => {
      field.length = 0;
      for (let index = 0; index < count; index++) {
        field.push({
          angle: Math.random() * Math.PI * 2,
          radius: 0.28 + Math.random() * 0.72,
          speed: 0.0016 + Math.random() * 0.0042,
          size: 0.7 + Math.random() * 2.1,
          drift: 0.6 + Math.random() * 1.7,
          phase: Math.random() * Math.PI * 2,
        });
      }
    };

    const readLevel = () => {
      const node = stateRef.current.analyser;
      if (!node) return null;
      if (level.length !== node.frequencyBinCount) level = new Uint8Array(node.frequencyBinCount);
      node.getByteFrequencyData(level as Uint8Array<ArrayBuffer>);
      // Бас и нижняя середина — то, по чему волна «дышит» в perceptible way.
      const bins = Math.max(4, Math.floor(level.length * 0.28));
      let sum = 0;
      for (let index = 0; index < bins; index++) sum += level[index];
      return sum / bins / 255;
    };

    resize();
    seed(PARTICLE_COUNT[stateRef.current.particles] ?? 60);

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
      resize();
      const wanted = PARTICLE_COUNT[stateRef.current.particles] ?? 0;
      if (Math.abs(field.length - wanted) > 8) seed(wanted);
    }) : null;
    observer?.observe(canvas);

    let time = 0;
    const draw = (delta: number) => {
      const state = stateRef.current;
      const wantedCount = PARTICLE_COUNT[state.particles] ?? 0;
      if (field.length !== wantedCount) seed(wantedCount);
      const config = MOODS[state.mood] ?? MOODS.unknown;
      const accentRgb = hexToRgb(state.accent || '#b7e49a');
      const shift = config.hue / 100;
      const tint = (value: number, index: number) => Math.max(0, Math.min(255, Math.round(value * (1 + (index === 1 ? shift : -shift)))));
      const color = (alpha: number) => `rgba(${tint(accentRgb[0], 0)},${tint(accentRgb[1], 1)},${tint(accentRgb[2], 2)},${alpha})`;

      const measured = state.playing ? readLevel() : null;
      const idle = 0.34 + 0.16 * Math.sin(time * 0.7) + 0.08 * Math.sin(time * 1.9 + 1.2);
      const target = state.playing ? (measured === null ? 0.45 + 0.3 * Math.abs(Math.sin(time * 1.7)) + 0.12 * Math.sin(time * 4.3) : 0.18 + measured * 1.25) : idle * 0.55;
      energy += (target - energy) * (state.reduced ? 1 : 0.085);
      energy = Math.max(0.02, Math.min(1.8, energy));

      const cx = width * (0.5 + (state.boost > 1 ? (pointer.current.x - 0.5) * 0.05 : 0));
      const cy = height * 0.52;
      const base = Math.min(width, height) * 0.22;
      const amp = base * config.amplitude * energy * (state.boost || 1);

      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = 'lighter';

      // Дышащее ядро: три вложенных кольца с мягким свечением.
      for (let ring = 0; ring < 3; ring++) {
        const radius = base * (0.52 + ring * 0.26) * (1 + energy * 0.16);
        const gradient = context.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius);
        gradient.addColorStop(0, color(0.2 - ring * 0.05));
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        context.fillStyle = gradient;
        context.beginPath();
        context.arc(cx, cy, radius, 0, Math.PI * 2);
        context.fill();
      }

      // Бегущие волны: сумма двух синусоид с разным шагом — «жидкий» силуэт.
      const waves = state.reduced ? 1 : config.waves;
      for (let wave = 0; wave < waves; wave++) {
        const offset = wave * 0.6;
        const amplitude = amp * (0.42 + wave * 0.12);
        const baseline = cy + (wave - (waves - 1) / 2) * (height * 0.06);
        context.beginPath();
        for (let x = 0; x <= width; x += 6) {
          const t = (x / width) * Math.PI * 2;
          const y = baseline
            + Math.sin(t * 1.5 + time * config.speed + offset) * amplitude * 0.55
            + Math.sin(t * 3.1 - time * config.speed * 0.7 + offset) * amplitude * 0.28;
          if (x === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.strokeStyle = color(0.1 + 0.06 * energy);
        context.lineWidth = 1.2 + wave * 0.35;
        context.stroke();
      }

      // Частицы: орбита + параллакс от курсора + лёгкое притяжение к ядру.
      if (!state.reduced) {
        for (const particle of field) {
          particle.angle += particle.speed * (0.4 + energy * 1.6) * config.speed;
          const parallaxX = (pointer.current.x - 0.5) * 42 * particle.drift * (pointer.current.active ? 1 : 0.25);
          const parallaxY = (pointer.current.y - 0.5) * 26 * particle.drift * (pointer.current.active ? 1 : 0.25);
          const radius = base * particle.radius * (1.6 + energy * 0.5) * config.spread;
          const x = cx + Math.cos(particle.angle) * radius + parallaxX;
          const y = cy + Math.sin(particle.angle * 1.35 + particle.phase) * radius * 0.42 + parallaxY + Math.sin(time + particle.phase) * 3;
          const size = particle.size * (0.7 + energy * 0.9);
          context.fillStyle = color(0.16 + 0.3 * energy);
          context.beginPath();
          context.arc(x, y, size, 0, Math.PI * 2);
          context.fill();
        }
      }

      // Пульс-кольца на пиках энергии: волна буквально расходится кругами.
      if (state.playing && !state.reduced && energy > 0.72) {
        const pulse = (time * 0.9) % 1;
        context.strokeStyle = color(0.32 * (1 - pulse));
        context.lineWidth = 1.6;
        context.beginPath();
        context.arc(cx, cy, base * (0.6 + pulse * 2.4), 0, Math.PI * 2);
        context.stroke();
      }

      context.globalCompositeOperation = 'source-over';
      // Мягкая виньетка, чтобы текст поверх баннера читался.
      const vignette = context.createLinearGradient(0, 0, width, 0);
      vignette.addColorStop(0, 'rgba(8,14,10,.92)');
      vignette.addColorStop(0.62, withAlpha('#0d100f', 0.35));
      vignette.addColorStop(1, 'rgba(8,14,10,0)');
      context.fillStyle = vignette;
      context.fillRect(0, 0, width, height);
    };

    let last = performance.now();
    const loop = (now: number) => {
      if (stopped) return;
      const delta = Math.min(64, now - last);
      last = now;
      const state = stateRef.current;
      const wantedCount = PARTICLE_COUNT[state.particles] ?? 0;
      if (field.length !== wantedCount) seed(wantedCount);
      // Пауза на скрытой вкладке и в режиме «только градиент» — не жечь батарею.
      if (state.particles === 'off' && !state.playing) {
        draw(delta);
        frame = requestAnimationFrame(loop);
        time += 0.0006 * delta;
        return;
      }
      if (document.visibilityState !== 'hidden') {
        time += (state.reduced ? 0.0002 : 0.0011) * delta * (MOODS[state.mood]?.speed ?? 1) * (state.playing ? 1 : 0.45);
        draw(delta);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    const onPointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.current = { x: (event.clientX - rect.left) / Math.max(1, rect.width), y: (event.clientY - rect.top) / Math.max(1, rect.height), active: true };
    };
    const onLeave = () => { pointer.current = { ...pointer.current, active: false }; };
    canvas.addEventListener('pointermove', onPointer);
    canvas.addEventListener('pointerleave', onLeave);

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      canvas.removeEventListener('pointermove', onPointer);
      canvas.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  // Смена режима частиц требует пересоздания поля — делаем это мягко через key.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.dataset.particles = particles;
  }, [particles]);

  return <canvas ref={canvasRef} className={`wave-canvas${className ? ` ${className}` : ''}`} aria-hidden="true" data-playing={playing ? '1' : '0'} data-mood={mood} />;
}
