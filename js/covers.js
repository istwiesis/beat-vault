// Procedural cover art per beat (deterministic from the title).
import { CONFIG } from './config.js';

const cache = new Map();

// Canvas text needs the web fonts loaded first, otherwise covers get cached with fallback fonts.
await Promise.race([
  Promise.all(['120px Anton', '120px "Instrument Serif"', '14px "Space Mono"', '120px "Bodoni Moda"', '15px "Inter Tight"']
    .map((f) => document.fonts.load(f).catch(() => {}))),
  new Promise((r) => setTimeout(r, 2500)),
]);

export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

// mulberry32
export function rng(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function palette(beat) {
  const r = rng(hash(beat.id));
  const hue = Math.floor(r() * 360);
  return {
    hue,
    bg: `hsl(${hue} ${20 + r() * 30}% ${8 + r() * 10}%)`,
    ink: `hsl(${(hue + 160 + r() * 60) % 360} ${60 + r() * 30}% ${55 + r() * 15}%)`,
    pale: `hsl(${hue} 15% 88%)`,
  };
}

function grain(ctx, w, h, r, amt = 0.12) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 255 * amt;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function fitText(ctx, text, maxW, size, font) {
  ctx.font = `${size}px ${font}`;
  const w = ctx.measureText(text).width;
  if (w > maxW) ctx.font = `${Math.floor(size * maxW / w)}px ${font}`;
}

/** Square cover canvas. Cached per beat+size. */
export function cover(beat, size = 512) {
  const key = beat.id + ':' + size;
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const r = rng(hash(beat.id) ^ 0xabc);
  const p = palette(beat);
  const s = size / 512;
  const layout = hash(beat.id) % 4;

  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, size, size);

  // abstract shapes
  for (let i = 0; i < 6; i++) {
    const g = ctx.createRadialGradient(r() * size, r() * size, 0, r() * size, r() * size, (100 + r() * 300) * s);
    g.addColorStop(0, `hsla(${(p.hue + r() * 80 - 40 + 360) % 360} 70% ${30 + r() * 40}% / ${0.25 + r() * 0.4})`);
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.strokeStyle = `hsla(${p.hue} 30% 80% / .18)`;
  ctx.lineWidth = 1.5 * s;
  if (layout === 0) for (let i = 0; i < 24; i++) { ctx.beginPath(); ctx.arc(size / 2, size / 2, i * 14 * s, 0, 7); ctx.stroke(); }
  if (layout === 1) for (let i = 0; i < 30; i++) { ctx.beginPath(); ctx.moveTo(0, i * 18 * s); ctx.lineTo(size, i * 18 * s + r() * 60 * s); ctx.stroke(); }
  if (layout === 2) for (let i = 0; i < 40; i++) { ctx.strokeRect(r() * size, r() * size, r() * 80 * s, r() * 80 * s); }

  // title
  const title = beat.title;
  ctx.fillStyle = p.ink;
  ctx.textBaseline = 'alphabetic';
  if (layout === 3) {
    ctx.save();
    ctx.translate(size * 0.62, size * 0.92);
    ctx.rotate(-Math.PI / 2);
    fitText(ctx, title, size * 0.84, 150 * s, '"Anton", Impact, sans-serif');
    ctx.fillText(title, 0, 0);
    ctx.restore();
  } else {
    fitText(ctx, title, size * 0.86, 120 * s, layout === 1 ? '"Instrument Serif", Georgia, serif' : '"Anton", Impact, sans-serif');
    ctx.fillText(title, size * 0.07, size * (layout === 0 ? 0.55 : 0.86));
  }

  ctx.fillStyle = p.pale;
  ctx.font = `${14 * s}px "Space Mono", monospace`;
  ctx.fillText(`${beat.bpm ?? '—'} BPM`, size * 0.07, size * 0.1);
  ctx.textAlign = 'right';
  ctx.fillText(CONFIG.artist, size * 0.93, size * 0.1);
  ctx.textAlign = 'left';

  grain(ctx, size, size, r);
  cache.set(key, c);
  return c;
}

export function coverURL(beat, size = 256) {
  const key = beat.id + ':url:' + size;
  if (!cache.has(key)) cache.set(key, cover(beat, size).toDataURL('image/jpeg', 0.85));
  return cache.get(key);
}

export const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
