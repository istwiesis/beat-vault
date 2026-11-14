// Shared beat-store player: audio, analyser, bottom bar, beat list drawer, room nav.
import { BEATS } from './beats.js';
import { CONFIG } from './config.js';
import { coverURL, fmt } from './covers.js';

const ROOT = new URL('../', import.meta.url);
const STORE_KEY = 'beatvault:player';

export const ROOMS = [
  { id: 'discs', name: 'Discs', href: 'rooms/discs.html' },
  { id: 'rain', name: 'Night Drive', href: 'rooms/rain.html' },
  { id: 'object', name: 'Store', href: 'rooms/object.html' },
];
export const roomURL = (r) => new URL(r.href, ROOT).href;

const listeners = {};
const audio = new Audio();
audio.preload = 'auto';

let ctx, analyser, source, freq;

export const player = {
  beats: BEATS,
  index: 0,
  vIndex: 0,
  playing: false,
  bass: 0, // smoothed low-end level 0..1
  kick: 0, // transient, decays
  level: 0, // overall level 0..1
  get current() { return BEATS[this.index]; },
  get version() { return this.current.versions[this.vIndex] || this.current.versions[0]; },
  get time() { return audio.currentTime || 0; },
  get duration() { return audio.duration || this.version.duration || 0; },
  /** beat phase 0..1 from BPM, usable even without analyser */
  get phase() { return ((this.time * (this.current.bpm || 120)) / 60) % 1; },
  audio,

  on(evt, fn) { (listeners[evt] ||= []).push(fn); return this; },
  emit(evt, ...a) { (listeners[evt] || []).forEach((f) => f(...a)); },

  load(i, v = 0) {
    this.index = ((i % BEATS.length) + BEATS.length) % BEATS.length;
    this.vIndex = v;
    audio.src = new URL(this.version.file, ROOT).href;
    this.emit('change', this.current, this.index);
  },
  async play(i = this.index, v) {
    if (i !== this.index || (v !== undefined && v !== this.vIndex) || !audio.src) this.load(i, v ?? 0);
    ensureAudioGraph();
    try { await audio.play(); } catch { /* autoplay blocked: resumes on next gesture */ waitForGesture(); }
  },
  pause() { audio.pause(); },
  toggle() { this.playing ? this.pause() : this.play(); },
  next() { this.play(this.index + 1); },
  prev() { audio.currentTime > 3 ? (audio.currentTime = 0) : this.play(this.index - 1); },
  seek(frac) { if (this.duration) audio.currentTime = Math.min(Math.max(frac, 0), 0.999) * this.duration; },
  skip(sec) { if (this.duration) audio.currentTime = Math.min(Math.max(this.time + sec, 0), this.duration - 0.5); },
  contactURL(b = this.current) {
    return CONFIG.contact.replace('{title}', encodeURIComponent(b.title)).replace('{bpm}', b.bpm ?? '');
  },
};

function ensureAudioGraph() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  // Only route through the graph once it runs, otherwise the audio would be silent.
  if (!source && ctx.state === 'running') {
    source = ctx.createMediaElementSource(audio);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.6;
    freq = new Uint8Array(analyser.frequencyBinCount);
    source.connect(analyser).connect(ctx.destination);
  }
}

let gestureWaiting = false;
function waitForGesture() {
  if (gestureWaiting) return;
  gestureWaiting = true;
  document.body.classList.add('pb-needs-gesture');
  const go = () => {
    gestureWaiting = false;
    document.body.classList.remove('pb-needs-gesture');
    window.removeEventListener('pointerdown', go, true);
    window.removeEventListener('keydown', go, true);
    ensureAudioGraph();
    audio.play().catch(() => {});
  };
  window.addEventListener('pointerdown', go, true);
  window.addEventListener('keydown', go, true);
}

audio.addEventListener('play', () => { player.playing = true; ensureAudioGraph(); player.emit('play'); });
audio.addEventListener('pause', () => { player.playing = false; player.emit('pause'); });
audio.addEventListener('ended', () => player.next());

// analyser loop
let prevBass = 0;
(function tick() {
  requestAnimationFrame(tick);
  let bass = 0, level = 0;
  if (analyser && player.playing) {
    analyser.getByteFrequencyData(freq);
    for (let i = 1; i < 8; i++) bass += freq[i];
    for (let i = 0; i < 128; i++) level += freq[i];
    bass = Math.max(0, bass / 7 / 255 - 0.35) / 0.65;
    level /= 128 * 255;
  } else if (player.playing) {
    // no analyser available yet: fake a pulse from the BPM
    bass = Math.pow(1 - player.phase, 4) * 0.8;
    level = 0.4;
  }
  player.bass += (bass - player.bass) * 0.3;
  player.level += (level - player.level) * 0.2;
  if (bass - prevBass > 0.12) player.kick = 1;
  player.kick *= 0.9;
  prevBass = bass;
  player.emit('frame');
})();

// persistence across rooms
window.addEventListener('pagehide', () => {
  sessionStorage.setItem(STORE_KEY, JSON.stringify({
    id: player.current?.id, v: player.vIndex, t: audio.currentTime, playing: player.playing,
  }));
});

function restore() {
  let s;
  try { s = JSON.parse(sessionStorage.getItem(STORE_KEY)); } catch {}
  const i = s ? BEATS.findIndex((b) => b.id === s.id) : -1;
  player.load(i >= 0 ? i : 0, s?.v || 0);
  if (s?.t) audio.addEventListener('loadedmetadata', () => (audio.currentTime = s.t), { once: true });
  if (s?.playing) player.play();
}

// ---------- UI ----------
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };

function mountBar() {
  const bar = h(`
  <div class="pb" role="region" aria-label="Player">
    <img class="pb-cover" alt="">
    <div class="pb-meta"><small>now playing</small><b class="pb-title"></b><span class="pb-sub"></span></div>
    <div class="pb-ctrl">
      <button class="pb-prev" aria-label="Zurück">⏮</button>
      <button class="pb-play" aria-label="Play">▶</button>
      <button class="pb-next" aria-label="Weiter">⏭</button>
    </div>
    <div class="pb-wavewrap"><canvas class="pb-wave" tabindex="0" role="slider" aria-label="Position" title="Klicken / ziehen zum Spulen · ←/→ 5 s · Shift+←/→ überall 10 s"></canvas><span class="pb-time">0:00</span></div>
    <select class="pb-ver" aria-label="Version"></select>
    <a class="pb-buy" target="_blank" rel="noopener">Anfragen</a>
    <button class="pb-list">Beats <span>${BEATS.length}</span></button>
    <div class="pb-hint">Klick irgendwo, um weiterzuhören</div>
  </div>`);
  document.body.append(bar);
  const $ = (s) => bar.querySelector(s);
  const wave = $('.pb-wave'), wctx = wave.getContext('2d');
  let lastLabel = '';

  $('.pb-play').onclick = () => player.toggle();
  $('.pb-prev').onclick = () => player.prev();
  $('.pb-next').onclick = () => player.next();
  $('.pb-ver').onchange = (e) => {
    const t = audio.currentTime;
    player.play(player.index, +e.target.value);
    audio.addEventListener('loadedmetadata', () => (audio.currentTime = Math.min(t, audio.duration - 1)), { once: true });
  };
  $('.pb-list').onclick = () => document.body.classList.toggle('pd-open');
  // scrub: preview while dragging, seek once on release (each seek is a new range request)
  let scrub = null;
  const fracAt = (e) => { const r = wave.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
  wave.onpointerdown = (e) => { wave.setPointerCapture(e.pointerId); scrub = fracAt(e); };
  wave.onpointermove = (e) => { if (scrub !== null) scrub = fracAt(e); };
  wave.onpointerup = (e) => {
    if (scrub === null) return;
    player.seek(fracAt(e)); scrub = null;
    if (!player.playing) player.play();
  };
  wave.onpointercancel = () => (scrub = null);
  wave.onkeydown = (e) => {
    const step = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5, PageUp: 30, PageDown: -30 }[e.key];
    if (step) { e.preventDefault(); e.stopPropagation(); player.skip(step); }
    if (e.key === 'Home') { e.preventDefault(); player.seek(0); }
  };

  const sync = () => {
    const b = player.current;
    $('.pb-cover').src = coverURL(b, 128);
    $('.pb-title').textContent = b.title;
    $('.pb-sub').textContent = `${b.bpm ?? '—'} BPM · ${fmt(player.version.duration)}`;
    $('.pb-buy').href = player.contactURL();
    const sel = $('.pb-ver');
    sel.innerHTML = b.versions.map((v, i) => `<option value="${i}">${v.label}</option>`).join('');
    sel.value = player.vIndex;
    sel.hidden = b.versions.length < 2;
  };
  player.on('change', sync);
  player.on('play', () => { $('.pb-play').textContent = '⏸'; bar.classList.add('is-playing'); });
  player.on('pause', () => { $('.pb-play').textContent = '▶'; bar.classList.remove('is-playing'); });

  player.on('frame', () => {
    const dpr = devicePixelRatio || 1, w = wave.clientWidth, hgt = wave.clientHeight;
    if (wave.width !== w * dpr) { wave.width = w * dpr; wave.height = hgt * dpr; }
    wctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    wctx.clearRect(0, 0, w, hgt);
    const peaks = player.version.peaks, n = peaks.length, bw = w / n;
    const prog = scrub ?? (player.duration ? player.time / player.duration : 0);
    for (let i = 0; i < n; i++) {
      const ph = Math.max(1.5, peaks[i] * hgt * 0.9);
      wctx.fillStyle = i / n < prog ? getAccent() : 'rgba(255,255,255,.28)';
      wctx.fillRect(i * bw, (hgt - ph) / 2, Math.max(1, bw - 1), ph);
    }
    const label = `${fmt(prog * player.duration)} / ${fmt(player.duration)}`;
    if (label !== lastLabel) { // avoid a DOM write + layout every frame
      lastLabel = label;
      $('.pb-time').textContent = label;
      wave.setAttribute('aria-valuetext', label);
    }
  });
}

let accent;
const getAccent = () => (accent ||= getComputedStyle(document.body).getPropertyValue('--pb-accent').trim() || '#fff');

function mountDrawer() {
  const d = h(`
  <aside class="pd" aria-label="Beat-Liste">
    <div class="pd-head">
      <div class="pd-brand"><b>${CONFIG.artist}</b><small>${CONFIG.tagline}</small></div>
      <button class="pd-close" aria-label="Schließen">✕</button>
    </div>
    <div class="pd-prices">${CONFIG.prices.map((p) => `<div><small>${p.name}</small><b>${p.price}</b></div>`).join('')}</div>
    <div class="pd-filter">
      <input type="search" placeholder="Suchen…" aria-label="Suchen">
      <select aria-label="BPM">
        <option value="">Alle BPM</option><option value="0-99">&lt; 100</option><option value="100-119">100–119</option>
        <option value="120-139">120–139</option><option value="140-999">140+</option>
      </select>
    </div>
    <ol class="pd-list"></ol>
  </aside>`);
  document.body.append(d);
  const list = d.querySelector('.pd-list');
  list.innerHTML = BEATS.map((b, i) => `
    <li data-i="${i}">
      <button class="pd-row">
        <img loading="lazy" alt="">
        <span class="pd-t">${b.title}${b.versions.length > 1 ? ` <em>+${b.versions.length - 1}</em>` : ''}</span>
        <span class="pd-bpm">${b.bpm ?? '—'}</span>
        <span class="pd-dur">${fmt(b.duration)}</span>
      </button>
      <a class="pd-buy" href="${player.contactURL(b)}" target="_blank" rel="noopener">Anfragen</a>
    </li>`).join('');
  // covers lazily, so 100+ canvases aren't drawn up-front
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    const li = e.target; li.querySelector('img').src = coverURL(BEATS[li.dataset.i], 96); io.unobserve(li);
  }), { root: list });
  list.querySelectorAll('li').forEach((li) => io.observe(li));
  list.onclick = (e) => { const row = e.target.closest('.pd-row'); if (row) player.play(+row.parentElement.dataset.i); };

  const [q, bpm] = d.querySelectorAll('input, select');
  const filter = () => {
    const [lo, hi] = bpm.value ? bpm.value.split('-').map(Number) : [0, 999];
    const s = q.value.trim().toLowerCase();
    list.querySelectorAll('li').forEach((li) => {
      const b = BEATS[li.dataset.i];
      li.hidden = !(b.title.toLowerCase().includes(s) && (b.bpm ?? 0) >= lo && (b.bpm ?? 0) <= hi);
    });
  };
  q.oninput = bpm.onchange = filter;
  d.querySelector('.pd-close').onclick = () => document.body.classList.remove('pd-open');
  player.on('change', (_, i) => list.querySelectorAll('li').forEach((li) => li.classList.toggle('is-current', +li.dataset.i === i)));
}

function mountNav(room) {
  const nav = h(`<nav class="rn"><a href="${new URL('index.html', ROOT).href}" class="rn-home">◐ ${CONFIG.artist}</a>${ROOMS.map((r) => `<a href="${roomURL(r)}" class="${r.id === room ? 'is-active' : ''}">${r.name}</a>`).join('')}</nav>`);
  document.body.append(nav);
}

/** Call once per page. */
export function initPlayer({ room } = {}) {
  mountNav(room);
  mountBar();
  mountDrawer();
  restore();
  // registered before the room's own arrow-key handlers, so Shift+arrows can claim the key first
  window.addEventListener('keydown', (e) => {
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (e.code === 'Space' && document.activeElement.tagName !== 'BUTTON') { e.preventDefault(); player.toggle(); }
    if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault(); e.stopImmediatePropagation();
      player.skip(e.key === 'ArrowRight' ? 10 : -10);
    }
  });
  return player;
}
