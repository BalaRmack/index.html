'use client';
import { useEffect, useRef } from 'react';
import { hexToRgb } from '@/lib/palette';
import type { ParticlesMode, WaveMood } from '@/lib/preferences';

type Props = { playing: boolean; mood: WaveMood; accent: string; particles?: ParticlesMode; reduced?: boolean; analyser?: AnalyserNode | null; className?: string; boost?: number };
type RGB = readonly [number, number, number];

const SPEED: Record<WaveMood, number> = { energetic: 1.5, calm: 0.5, unknown: 0.9, loved: 1.05 };

function getColors(mood: WaveMood, accent: string): readonly [RGB, RGB, RGB, RGB] {
  const [r, g, b] = hexToRgb(accent || '#b7e49a');
  const acc: RGB = [r, g, b];
  if (Math.abs(r - g) < 12 && Math.abs(g - b) < 12 && r > 180) {
    return [[255, 255, 255], [200, 200, 200], [130, 130, 130], [235, 235, 235]];
  }
  if (mood === 'energetic') return [[255, 110, 150], [255, 165, 70], [190, 60, 220], acc];
  if (mood === 'calm') return [[90, 210, 255], [70, 130, 255], acc, [160, 240, 220]];
  if (mood === 'loved') return [[255, 95, 175], [235, 70, 110], [255, 175, 110], acc];
  return [[215, 95, 255], [255, 85, 155], acc, [95, 225, 210]];
}

export default function WaveVisualizer({ playing, mood, accent, particles = 'full', reduced = false, analyser = null, className, boost = 1 }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const st = useRef({ playing, mood, accent, particles, reduced, analyser, boost });
  st.current = { playing, mood, accent, particles, reduced, analyser, boost };

  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d', { alpha: true });
    if (!c || !ctx) return;
    let w = 1, h = 1, raf = 0, stop = false, energy = 0.3, bass = 0.25, time = 0, last = performance.now();
    let bins = new Uint8Array(0);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const rect = (c.parentElement || c).getBoundingClientRect();
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    ro?.observe(c.parentElement || c);

    const rgba = (col: RGB, a: number) => `rgba(${col.at(0)},${col.at(1)},${col.at(2)},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

    const draw = (dt: number) => {
      const s = st.current;
      const spd = SPEED[s.mood] ?? 1;
      const [core, mid, outer, spark] = getColors(s.mood, s.accent);
      let low = 0, hi = 0, hasAudio = false;
      if (s.playing && s.analyser) {
        if (bins.length !== s.analyser.frequencyBinCount) bins = new Uint8Array(s.analyser.frequencyBinCount);
        s.analyser.getByteFrequencyData(bins as Uint8Array<ArrayBuffer>);
        const n1 = Math.max(4, Math.floor(bins.length * 0.14)), n2 = Math.max(8, Math.floor(bins.length * 0.42));
        for (let i = 0; i < n1; i++) low += bins.at(i) ?? 0;
        for (let i = n1; i < n2; i++) hi += bins.at(i) ?? 0;
        low = low / n1 / 255; hi = hi / Math.max(1, n2 - n1) / 255; hasAudio = true;
      }

      const idle = 0.32 + 0.08 * Math.sin(time * 0.8);
      const tE = s.playing ? (hasAudio ? 0.3 + hi * 1.1 : 0.52 + 0.22 * Math.abs(Math.sin(time * 1.6))) : idle;
      const tB = s.playing ? (hasAudio ? 0.25 + low * 1.4 : 0.45 + 0.32 * Math.pow(Math.abs(Math.sin(time * 1.8)), 2)) : idle * 0.75;
      const k = s.reduced ? 1 : 0.08;
      energy += (tE - energy) * k; bass += (tB - bass) * k;

      const isWide = w > h * 1.5;
      const cx = w * (isWide ? 0.72 : 0.5);
      const cy = h * 0.5;
      const R = Math.max(h * 0.68, Math.min(w, h) * 0.55) * (s.boost || 1);

      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';

      const clouds: readonly [number, number, number, number, RGB, number][] = [
        [time * 0.32 * spd, 0.22, 1.45 + bass * 0.25, 1.15 + energy * 0.2, mid, 0.38 + energy * 0.14],
        [-time * 0.25 * spd + 2.1, 0.28, 1.3 + energy * 0.22, 1.4 + bass * 0.22, outer, 0.32 + bass * 0.14],
        [time * 0.38 * spd + 4.2, 0.16, 1.1 + bass * 0.26, 1.1 + energy * 0.22, core, 0.45 + energy * 0.16],
        [-time * 0.45 * spd + 1.1, 0.32, 0.95, 1.2, spark, 0.22 + energy * 0.1],
      ];

      for (const [ang, dist, rx, ry, col, alpha] of clouds) {
        const bx = cx + Math.cos(ang) * dist * R;
        const by = cy + Math.sin(ang * 1.15) * dist * R * 0.75;
        const RX = rx * R, RY = ry * R;
        ctx.save();
        ctx.translate(bx, by);
        ctx.rotate(ang * 0.5);
        ctx.scale(1, RY / Math.max(1, RX));
        const g = ctx.createRadialGradient(0, 0, RX * 0.05, 0, 0, RX);
        g.addColorStop(0, rgba(col, alpha));
        g.addColorStop(0.55, rgba(col, alpha * 0.38));
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, RX, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      if (s.particles !== 'off') {
        const rays = s.particles === 'eco' ? 6 : 10;
        for (let i = 0; i < rays; i++) {
          const a = (i / rays) * Math.PI * 2 + time * 0.15 * spd + Math.sin(time * 0.6 + i) * 0.16;
          const len = R * (1.35 + 0.4 * Math.sin(time * 1.3 * spd + i * 1.9) + bass * 0.4);
          const sp = 0.16 + 0.06 * Math.cos(time + i);
          const g = ctx.createRadialGradient(cx, cy, R * 0.08, cx, cy, len);
          g.addColorStop(0, rgba(i % 2 ? mid : core, 0.22 + energy * 0.14));
          g.addColorStop(0.55, rgba(outer, 0.08 + bass * 0.06));
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.arc(cx, cy, len, a - sp, a + sp);
          ctx.closePath();
          ctx.fill();
        }
      }

      const cR = R * (0.58 + bass * 0.2);
      const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, cR);
      cg.addColorStop(0, rgba([255, 255, 255], 0.22 + bass * 0.16));
      cg.addColorStop(0.45, rgba(core, 0.34 + energy * 0.16));
      cg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.arc(cx, cy, cR, 0, Math.PI * 2);
      ctx.fill();

      time += Math.min(0.05, dt);
      if (!stop && !s.reduced) raf = requestAnimationFrame((now) => { const d = (now - last) / 1000; last = now; draw(d || 0.016); });
    };
    draw(0.016);
    return () => { stop = true; cancelAnimationFrame(raf); ro?.disconnect(); };
  }, [reduced]);

  return <canvas ref={ref} className={className} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} aria-hidden="true" />;
}
