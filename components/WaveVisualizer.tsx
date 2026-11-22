'use client';
import { useEffect, useRef } from 'react';
import { hexToRgb } from '@/lib/palette';
import type { ParticlesMode, WaveMood } from '@/lib/preferences';

type Props = { playing: boolean; mood: WaveMood; accent: string; particles?: ParticlesMode; reduced?: boolean; analyser?: AnalyserNode | null; className?: string; boost?: number };
type RGB = [number, number, number];

const SPEED: Record<WaveMood, number> = { energetic: 1.55, calm: 0.48, unknown: 0.92, loved: 1.08 };

function palette(mood: WaveMood, accent: string): [RGB, RGB, RGB, RGB] {
  const rgb = hexToRgb(accent || '#b7e49a') as RGB;
  if (Math.abs(rgb[0] - rgb[1]) < 12 && Math.abs(rgb[1] - rgb[2]) < 12 && rgb[0] > 180) return [[255, 255, 255], [200, 200, 200], [140, 140, 140], [235, 235, 235]];
  if (mood === 'energetic') return [[255, 92, 138], [255, 168, 52], [186, 62, 255], rgb];
  if (mood === 'calm') return [[64, 210, 255], [110, 128, 255], rgb, [145, 255, 215]];
  if (mood === 'loved') return [[255, 72, 168], [255, 130, 92], [176, 78, 255], rgb];
  return [[228, 72, 255], [255, 84, 148], rgb, [92, 235, 210]];
}

export default function WaveVisualizer({ playing, mood, accent, particles = 'full', reduced = false, analyser = null, className, boost = 1 }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const ptr = useRef({ x: 0.5, y: 0.5, on: false });
  const st = useRef({ playing, mood, accent, particles, reduced, analyser, boost });
  st.current = { playing, mood, accent, particles, reduced, analyser, boost };

  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d', { alpha: true });
    if (!c || !ctx) return;
    let w = 1, h = 1, raf = 0, stop = false, energy = 0.25, bass = 0.2, time = 0, last = performance.now();
    let bins = new Uint8Array(0);

    const resize = () => {
      const r = Math.min(window.devicePixelRatio || 1, st.current.particles === 'eco' ? 1.25 : 1.75);
      const rect = c.getBoundingClientRect();
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      c.width = Math.round(w * r);
      c.height = Math.round(h * r);
      ctx.setTransform(r, 0, 0, r, 0, 0);
    };
    resize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    ro?.observe(c);
    const rgba = (rgb: RGB, a: number) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

    const draw = (dt: number) => {
      const s = st.current;
      const spd = SPEED[s.mood] ?? 1;
      const [core, mid, outer, spark] = palette(s.mood, s.accent);
      let low = 0, hi = 0, hasAudio = false;
      if (s.playing && s.analyser) {
        if (bins.length !== s.analyser.frequencyBinCount) bins = new Uint8Array(s.analyser.frequencyBinCount);
        s.analyser.getByteFrequencyData(bins as Uint8Array<ArrayBuffer>);
        const n1 = Math.max(4, Math.floor(bins.length * 0.14)), n2 = Math.max(8, Math.floor(bins.length * 0.42));
        for (let i = 0; i < n1; i++) low += bins[i];
        for (let i = n1; i < n2; i++) hi += bins[i];
        low = low / n1 / 255; hi = hi / Math.max(1, n2 - n1) / 255; hasAudio = true;
      }
      const idle = 0.28 + 0.08 * Math.sin(time * 0.85);
      const tE = s.playing ? (hasAudio ? 0.26 + hi * 1.15 : 0.48 + 0.24 * Math.abs(Math.sin(time * 1.65))) : idle;
      const tB = s.playing ? (hasAudio ? 0.2 + low * 1.45 : 0.42 + 0.34 * Math.pow(Math.abs(Math.sin(time * 1.85)), 2)) : idle * 0.7;
      const k = s.reduced ? 1 : 0.09;
      energy += (tE - energy) * k; bass += (tB - bass) * k;

      const cx = w * (w > h * 1.65 ? 0.68 : 0.5) + (ptr.current.on ? (ptr.current.x - 0.5) * 32 : 0);
      const cy = h * 0.5 + (ptr.current.on ? (ptr.current.y - 0.5) * 22 : 0);
      const R = Math.min(w, h) * (w > h * 1.65 ? 0.52 : 0.38) * (s.boost || 1);

      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';

      [[time * 0.35 * spd, 0.22, 1.28 + bass * 0.24, 1.05 + energy * 0.18, mid, 0.36 + energy * 0.14],
       [-time * 0.28 * spd + 2.1, 0.28, 1.15 + energy * 0.2, 1.32 + bass * 0.22, outer, 0.3 + bass * 0.14],
       [time * 0.42 * spd + 4.2, 0.16, 0.95 + bass * 0.26, 0.95 + energy * 0.22, core, 0.44 + energy * 0.18],
       [-time * 0.5 * spd + 1.1, 0.3, 0.85, 1.1, spark, 0.2 + energy * 0.1]].forEach(([ang, dist, rx, ry, col, a]) => {
        const A = ang as number, D = (dist as number) * R, RX = (rx as number) * R, RY = (ry as number) * R;
        ctx.save(); ctx.translate(cx + Math.cos(A) * D, cy + Math.sin(A * 1.15) * D * 0.85); ctx.rotate(A * 0.6); ctx.scale(1, RY / Math.max(1, RX));
        const g = ctx.createRadialGradient(0, 0, RX * 0.06, 0, 0, RX);
        g.addColorStop(0, rgba(col as RGB, a as number)); g.addColorStop(0.55, rgba(col as RGB, (a as number) * 0.42)); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, RX, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      });

      if (s.particles !== 'off') {
        const rays = s.particles === 'eco' ? 6 : 11;
        for (let i = 0; i < rays; i++) {
          const a = (i / rays) * Math.PI * 2 + time * 0.18 * spd + Math.sin(time * 0.7 + i) * 0.18;
          const len = R * (1.15 + 0.45 * Math.sin(time * 1.4 * spd + i * 1.9) + bass * 0.45);
          const sp = 0.14 + 0.06 * Math.cos(time + i);
          const g = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, len);
          g.addColorStop(0, rgba(i % 2 ? mid : core, 0.25 + energy * 0.16)); g.addColorStop(0.5, rgba(outer, 0.1 + bass * 0.08)); g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, len, a - sp, a + sp); ctx.closePath(); ctx.fill();
        }
      }

      for (let ring = 0; ring < 2; ring++) {
        ctx.beginPath();
        for (let i = 0; i <= 80; i++) {
          const th = (i / 80) * Math.PI * 2;
          const r = R * (0.56 + ring * 0.22 + bass * 0.16) * (1 + Math.sin(th * 6 + time * 1.9 * spd + ring) * (0.07 + bass * 0.08) + Math.cos(th * 3 - time * 1.3 * spd) * (0.06 + energy * 0.06));
          i === 0 ? ctx.moveTo(cx + Math.cos(th) * r, cy + Math.sin(th) * r) : ctx.lineTo(cx + Math.cos(th) * r, cy + Math.sin(th) * r);
        }
        ctx.closePath(); ctx.strokeStyle = rgba(ring === 0 ? [255, 255, 255] : core, 0.24 + energy * 0.18); ctx.lineWidth = ring === 0 ? 1.8 : 1.2; ctx.stroke();
      }

      const cR = R * (0.48 + bass * 0.18), cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, cR);
      cg.addColorStop(0, rgba([255, 255, 255], 0.32 + bass * 0.22)); cg.addColorStop(0.45, rgba(core, 0.36 + energy * 0.18)); cg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cy, cR, 0, Math.PI * 2); ctx.fill();

      time += Math.min(0.05, dt);
      if (!stop && !s.reduced) raf = requestAnimationFrame((now) => { const d = (now - last) / 1000; last = now; draw(d || 0.016); });
    };
    draw(0.016);
    return () => { stop = true; cancelAnimationFrame(raf); ro?.disconnect(); };
  }, [reduced]);

  return <canvas ref={ref} className={className} aria-hidden="true" onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); if (r.width && r.height) ptr.current = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, on: true }; }} onPointerLeave={() => { ptr.current.on = false; }} />;
}
