// Mosaic — shared helpers. (c) RM Software
'use strict';

// Local storage that falls back to memory when the browser blocks it.
const store = (() => {
  try { const k = '__mosaic_t'; localStorage.setItem(k, k); localStorage.removeItem(k); return localStorage; }
  catch { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }
})();

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Turn plain text into safe HTML with @mentions and #tags highlighted.
function richText(s) {
  return esc(s).replace(/(^|\s)(@[\w.]{1,30}|#(?=[\w.]*[A-Za-z_])[\w.]{1,30})/g, (m, sp, tag) =>
    `${sp}<span class="mention" ${tag[0] === '@' ? `data-mention="${tag.slice(1).replace(/\.+$/, '')}"` : `data-hashtag="${tag.slice(1).replace(/\.+$/, '').toLowerCase()}"`}>${tag}</span>`);
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function timeAgo(iso, long = false) {
  const s = Math.max(1, (Date.now() - new Date(iso).getTime()) / 1000);
  const units = [[31536000, 'y', 'year'], [604800, 'w', 'week'], [86400, 'd', 'day'], [3600, 'h', 'hour'], [60, 'm', 'minute'], [1, 's', 'second']];
  for (const [n, short, word] of units) {
    if (s >= n) {
      const v = Math.floor(s / n);
      if (long) return `${v} ${word}${v === 1 ? '' : 's'} ago`;
      return v + short;
    }
  }
  return 'now';
}

function clockTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function dayLabel(iso) {
  const d = new Date(iso), now = new Date();
  const same = (a, b) => a.toDateString() === b.toDateString();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (same(d, now)) return 'Today';
  if (same(d, y)) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

function fmtCount(n) {
  n = n || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return n.toLocaleString();
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));

// ---------- Icons (original line art) ----------
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  homeF: '<path class="f" d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.5-4.5"/>',
  plus: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M12 8v8M8 12h8"/>',
  heart: '<path d="M12 20.5S3.5 15.4 3.5 9.3A4.6 4.6 0 0 1 12 6.8a4.6 4.6 0 0 1 8.5 2.5c0 6.1-8.5 11.2-8.5 11.2z"/>',
  comment: '<path d="M20.5 11.6a8.4 8.4 0 0 1-12.3 7.5L3.5 20.5l1.4-4.6a8.4 8.4 0 1 1 15.6-4.3z"/>',
  send: '<path d="M21.5 3 10.2 13.8M21.5 3l-6.8 18-4.5-7.2L3 9.4z"/>',
  bookmark: '<path d="M18.5 21 12 15.8 5.5 21V4.5a1.5 1.5 0 0 1 1.5-1.5h10a1.5 1.5 0 0 1 1.5 1.5z"/>',
  more: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>',
  back: '<path d="M15 4.5 7.5 12l7.5 7.5"/>',
  close: '<path d="M5.5 5.5l13 13M18.5 5.5l-13 13"/>',
  messenger: '<path d="M12 3c5 0 9 3.7 9 8.5S17 20 12 20c-1 0-2-.1-2.9-.4L5 21.5l.6-3.8C4 16.2 3 14 3 11.5 3 6.7 7 3 12 3z"/><path d="m7.5 13.5 3-3.2 2.4 2 3.6-2.8-3 3.3-2.4-2z"/>',
  grid: '<rect x="3.5" y="3.5" width="17" height="17" rx="1.5"/><path d="M9.2 3.5v17M14.8 3.5v17M3.5 9.2h17M3.5 14.8h17"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.8"/><path d="m21 15-5-5L5 21"/>',
  camera: '<path d="M4 7.5h3l2-2.5h6l2 2.5h3a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8.5a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.8"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  moon: '<path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  newmsg: '<path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 12a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  reels: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M3 8.5h18M8 3l3 5.5M13.5 3l3 5.5"/><path d="M10 12.2v5l4.3-2.5z" fill="currentColor"/>',
  tag: '<path d="M12 12.5a3.3 3.3 0 1 0 0-6.6 3.3 3.3 0 0 0 0 6.6zM5.5 20a6.5 6.5 0 0 1 13 0"/><rect x="2.5" y="2.5" width="19" height="19" rx="4"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>',
  pause: '<path d="M7 4.5h3.5v15H7zM13.5 4.5H17v15h-3.5z" fill="currentColor"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  reply: '<path d="M10 8 4.5 12.5 10 17"/><path d="M5 12.5h9a5.5 5.5 0 0 1 5.5 5.5v1"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>',
  text: '<path d="M5 6.5V4.5h14v2M12 4.5v15M9 19.5h6"/>',
  pen: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  group: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>',
  video: '<rect x="2.5" y="5.5" width="13" height="13" rx="2.5"/><path d="m15.5 10.5 6-3.5v10l-6-3.5z"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  block: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  volume: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
  hash: '<path d="M9.5 3.5 7.5 20.5M16.5 3.5l-2 17M4 9h16.5M3.5 15H20"/>',
  people: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/><path d="M19 3.5v5M16.5 6h5"/>',
};
function icon(name, cls = '') {
  const filled = name.endsWith('F') || cls.includes('filled');
  let body = ICONS[name] || '';
  if (filled) body = body.replace(/class="f"/g, '');
  return `<svg class="i ${filled ? 'filled' : ''} ${cls}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
}

// ---------- Default avatar (initials over a soft gradient) ----------
const PALETTES = [['#ff8a3d', '#f0325a'], ['#8f3cf2', '#4c7cf5'], ['#14b8a6', '#4c7cf5'], ['#f59e0b', '#ef4444'], ['#ec4899', '#8b5cf6'], ['#22c55e', '#0ea5e9'], ['#6366f1', '#a855f7']];
function hashStr(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }
function defaultAvatar(name) {
  const [a, b] = PALETTES[hashStr(name) % PALETTES.length];
  const ini = esc(String(name || '?').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 1).toUpperCase() || '?');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/><text x="50" y="50" dy=".36em" text-anchor="middle" font-family="Roboto,Arial,sans-serif" font-size="46" font-weight="600" fill="#fff">${ini}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
function avatarSrc(p) { return (p && p.avatar_url) || defaultAvatar(p ? (p.full_name || p.username) : '?'); }
function avatarImg(p, size = '', extra = '') {
  return `<img class="av ${size}" src="${esc(avatarSrc(p))}" alt="" loading="lazy" ${extra}>`;
}

// ---------- Images ----------
function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
function fileToDataURL(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}
// Draw an image to a canvas, optionally square-cropped, scaled and filtered.
function renderImage(img, { max = 1080, square = false, filter = 'none' } = {}) {
  let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0;
  if (square) { const m = Math.min(sw, sh); sx = (sw - m) / 2; sy = (sh - m) / 2; sw = sh = m; }
  const scale = Math.min(1, max / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
  const ctx = c.getContext('2d');
  ctx.filter = filter;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}
function canvasToBlob(c, q = 0.85) { return new Promise(res => c.toBlob(res, 'image/jpeg', q)); }

const FILTERS = [
  ['Normal', 'none'],
  ['Vivid', 'saturate(1.45) contrast(1.08)'],
  ['Glow', 'brightness(1.12) saturate(1.2) contrast(.92)'],
  ['Warm', 'sepia(.28) saturate(1.3) hue-rotate(-8deg)'],
  ['Cool', 'saturate(1.1) hue-rotate(12deg) brightness(1.03)'],
  ['Fade', 'contrast(.82) brightness(1.1) saturate(.8)'],
  ['Drama', 'contrast(1.35) saturate(1.1) brightness(.92)'],
  ['Mono', 'grayscale(1) contrast(1.1)'],
  ['Noir', 'grayscale(1) contrast(1.5) brightness(.9)'],
  ['Retro', 'sepia(.55) contrast(1.1) brightness(1.05)'],
];

// ---------- Generated artwork for demo mode ----------
function demoArt(seed, w = 1080, h = 1080) {
  const r = (() => { let s = hashStr(seed) || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  const hue = Math.floor(r() * 360);
  const c = (dh, s, l, a = 1) => `hsla(${(hue + dh) % 360},${s}%,${l}%,${a})`;
  const kind = Math.floor(r() * 4);
  let shapes = '';
  if (kind === 0) { // sunset hills
    shapes += `<circle cx="${w * (0.3 + r() * 0.4)}" cy="${h * 0.42}" r="${w * 0.16}" fill="${c(40, 95, 70)}"/>`;
    for (let i = 0; i < 4; i++) {
      const y = h * (0.55 + i * 0.11);
      shapes += `<path d="M0 ${y} Q ${w * r()} ${y - h * 0.15 * r()} ${w} ${y + 20 - 40 * r()} V ${h} H 0Z" fill="${c(200 + i * 12, 45, 30 - i * 5)}" opacity=".95"/>`;
    }
  } else if (kind === 1) { // bokeh
    for (let i = 0; i < 26; i++) shapes += `<circle cx="${w * r()}" cy="${h * r()}" r="${20 + r() * 120}" fill="${c(r() * 80, 90, 60 + r() * 25, 0.18 + r() * 0.35)}"/>`;
  } else if (kind === 2) { // geometric
    for (let i = 0; i < 9; i++) {
      const x = w * r(), y = h * r(), s = 80 + r() * 300;
      shapes += `<rect x="${x - s / 2}" y="${y - s / 2}" width="${s}" height="${s}" rx="${s * 0.2 * r()}" transform="rotate(${r() * 90} ${x} ${y})" fill="${c(r() * 140, 75, 55 + r() * 20, 0.75)}"/>`;
    }
  } else { // waves
    for (let i = 0; i < 7; i++) {
      const y = h * (0.15 + i * 0.13);
      shapes += `<path d="M0 ${y} C ${w * 0.3} ${y - 90 * r()}, ${w * 0.6} ${y + 120 * r()}, ${w} ${y - 30} V ${h} H 0Z" fill="${c(i * 18, 70, 72 - i * 7, 0.55)}"/>`;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c(0, 70, 82)}"/><stop offset="1" stop-color="${c(60, 65, 52)}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#b)"/>${shapes}</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

// ---------- Video and audio helpers ----------
function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
// Reads a video file's length and grabs a frame to use as its thumbnail.
function videoInfo(file) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(file);
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    const done = (fn, arg) => { v.onloadeddata = v.onseeked = v.onerror = null; fn(arg); };
    v.onerror = () => done(reject, new Error("That video couldn't be opened. Try an MP4 file."));
    v.onloadeddata = () => { v.currentTime = Math.min(0.5, (v.duration || 1) / 3); };
    v.onseeked = () => {
      try {
        const max = 1080, scale = Math.min(1, max / Math.max(v.videoWidth, v.videoHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(v.videoWidth * scale) || 720; c.height = Math.round(v.videoHeight * scale) || 1280;
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        done(resolve, { url, duration: v.duration, width: v.videoWidth, height: v.videoHeight, poster: c });
      } catch (e) { done(reject, e); }
    };
  });
}
function extFromType(type, fallback) {
  const m = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/aac': 'aac' };
  return m[(type || '').split(';')[0]] || fallback;
}
