// Mosaic — app shell: backend, navigation, shared UI helpers, sign-in, tabs.  (c) RM Software
'use strict';

const APP_VERSION = '1.2.1';
const ROOT = document.getElementById('app');
// Public pages Google Play links to: privacy policy, terms and web account deletion.
const LEGAL_BASE = 'https://securedmessage.github.io/mosaic/';
const MIN_AGE = 16;
const legalLink = (page, label) => `<a href="${LEGAL_BASE}${page}" target="_blank" rel="noopener">${label}</a>`;

// ---------- Backend selection ----------
// When a server is built into config.js the app always uses it: no demo mode, no server switching.
const BUILT_IN_SERVER = !!(window.MOSAIC_CONFIG?.url && window.MOSAIC_CONFIG?.key);
function serverConfig() {
  const c = window.MOSAIC_CONFIG || {};
  if (BUILT_IN_SERVER) { store.removeItem('mosaic_server'); return { url: c.url, key: c.key }; }
  try { const s = JSON.parse(store.getItem('mosaic_server')); if (s && s.url && s.key) return s; } catch {}
  return null;
}
let api, serverError = null;
{
  const cfg = serverConfig();
  if (cfg) {
    // A server is configured: never fall back to demo mode silently.
    if (!window.supabase) serverError = 'The connection library is missing from this build (www/lib/supabase.js).';
    else {
      try { api = new SupabaseAPI(cfg.url, cfg.key); }
      catch (e) { console.error(e); serverError = 'The server address or key is not valid: ' + (e.message || e); }
    }
  }
  if (!api) api = new DemoAPI();
}

const state = { me: null, unreadChats: 0, unreadNotifs: 0, tab: 'home', storyGroups: [] };

// ---------- Theme ----------
function applyTheme() {
  const t = store.getItem('mosaic_theme') || 'system';
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  try { window.Capacitor?.Plugins?.MosaicBars?.setStyle({ dark }); } catch {}
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b0b0d' : '#ffffff');
}
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

// ---------- Small UI helpers ----------
function toast(msg, ms = 2400) {
  $$('.toast', ROOT).forEach(t => t.remove());
  const t = el(`<div class="toast">${esc(msg)}</div>`);
  ROOT.appendChild(t);
  setTimeout(() => t.remove(), ms);
}
function fail(e) { console.error(e); toast(e?.message || 'Something went wrong'); }

const overlays = []; // sheets / viewers that the back button closes first
// Bottom sheet with options and/or custom content. Resolves with the chosen value (null when dismissed).
// The returned promise also carries .close(value) so custom content can dismiss it.
function sheet({ title, options = [], content }) {
  let closer;
  const p = new Promise(resolve => {
    const scrim = el(`<div class="scrim"><div class="sheet"><div class="grab"></div>${title ? `<div class="sheet-h">${esc(title)}</div>` : ''}<div class="scroll body"></div></div></div>`);
    const body = $('.body', scrim);
    options.forEach(o => {
      const b = el(`<button class="opt ${o.danger ? 'danger' : ''}">${esc(o.label)}</button>`);
      b.onclick = () => close(o.value ?? o.label);
      body.appendChild(b);
    });
    if (content) body.appendChild(content);
    const close = v => { if (!scrim.isConnected) return; scrim.remove(); const i = overlays.indexOf(entry); if (i >= 0) overlays.splice(i, 1); resolve(v); };
    const entry = { close: () => close(null) };
    scrim.onclick = e => { if (e.target === scrim) close(null); };
    overlays.push(entry);
    ROOT.appendChild(scrim);
    closer = close;
  });
  p.close = v => closer?.(v);
  return p;
}
async function confirmDialog(title, okLabel = 'Delete') {
  return (await sheet({ title, options: [{ label: okLabel, value: 'ok', danger: true }, { label: 'Cancel', value: null }] })) === 'ok';
}
function pickFiles({ accept = 'image/*', multiple = false, capture = false } = {}) {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.multiple = multiple;
    if (capture) inp.capture = 'environment';
    inp.onchange = () => resolve([...inp.files]);
    inp.click();
  });
}
async function pickImage(capture = false) { return (await pickFiles({ capture }))[0] || null; }
async function processUpload(file, opts) {
  const url = URL.createObjectURL(file);
  try {
    const c = renderImage(await loadImage(url), opts);
    return api.uploadImage(await canvasToBlob(c, 0.85));
  } finally { URL.revokeObjectURL(url); }
}
function longPress(node, fn, ms = 480) {
  let t, moved = false, sx = 0, sy = 0;
  node.addEventListener('touchstart', e => { moved = false; sx = e.touches[0].clientX; sy = e.touches[0].clientY; t = setTimeout(() => { if (!moved) { navigator.vibrate?.(15); fn(e); } }, ms); }, { passive: true });
  node.addEventListener('touchmove', e => { if (Math.abs(e.touches[0].clientX - sx) > 8 || Math.abs(e.touches[0].clientY - sy) > 8) { moved = true; clearTimeout(t); } }, { passive: true });
  node.addEventListener('touchend', () => clearTimeout(t));
  node.addEventListener('contextmenu', e => { e.preventDefault(); fn(e); });
}
function doubleTap(node, onDouble, onSingle) {
  let last = 0, timer;
  node.addEventListener('click', e => {
    const now = Date.now();
    if (now - last < 300) { clearTimeout(timer); last = 0; onDouble(e); }
    else { last = now; if (onSingle) timer = setTimeout(() => onSingle(e), 300); }
  });
}
function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; }

// "Active now" / "Active 5m ago" — hidden when either person turned off activity status.
function activeLabel(p) {
  if (!p?.last_seen_at || state.me?.show_activity === false || p.show_activity === false) return '';
  const mins = (Date.now() - new Date(p.last_seen_at).getTime()) / 60000;
  if (mins < 3) return 'Active now';
  if (mins < 60) return `Active ${Math.round(mins)}m ago`;
  if (mins < 24 * 60) return `Active ${Math.round(mins / 60)}h ago`;
  return '';
}
const isActiveNow = p => activeLabel(p) === 'Active now';

// ---------- Navigation ----------
const stack = [];
function push(builder, ...args) {
  const scr = builder(...args);
  stack.at(-1)?.onHide?.();
  const below = stack.at(-1);
  scr.el.classList.add('screen', 'push');
  scr.el.addEventListener('animationend', () => {
    scr.el.classList.remove('push');
    if (below && stack.at(-1) !== below) below.el.classList.add('covered');
  }, { once: true });
  ROOT.appendChild(scr.el);
  stack.push(scr);
  scr.onShow?.();
  return scr;
}
function pop() {
  if (stack.length <= 1) return false;
  const scr = stack.pop();
  scr.onDestroy?.();
  stack.at(-1).el.classList.remove('covered');
  scr.el.classList.add('pop');
  setTimeout(() => scr.el.remove(), 200);
  stack.at(-1).onShow?.();
  return true;
}
function resetTo(builder) {
  while (stack.length) { const s = stack.pop(); s.onDestroy?.(); s.el.remove(); }
  overlays.splice(0).forEach(o => o.close());
  push(builder);
  stack[0].el.classList.remove('push');
}
function goBack() {
  if (overlays.length) { overlays.at(-1).close(); return true; }
  return pop();
}
function topbar(title, { back = true, right = '', cls = '' } = {}) {
  return `<div class="topbar ${cls}">${back ? `<button class="iconbtn" data-back aria-label="Back">${icon('back')}</button>` : ''}<h1>${title}</h1>${right}</div>`;
}
function wireBack(root) { $$('[data-back]', root).forEach(b => b.onclick = () => goBack()); }

// Android hardware back button and app resume
(function () {
  const App = window.Capacitor?.Plugins?.App;
  if (App) App.addListener('backButton', () => { if (!goBack()) App.exitApp(); });
  else window.addEventListener('keydown', e => { if (e.key === 'Escape') goBack(); });
  if (App) App.addListener('resume', () => { refreshBadges(); presence(); });
})();

// ---------- Badges / presence ----------
async function refreshBadges() {
  if (!state.me) return;
  try {
    [state.unreadChats, state.unreadNotifs] = await Promise.all([api.unreadChats(), api.unreadNotifications()]);
  } catch (e) { console.warn(e); }
  paintBadges();
}
function paintBadges() {
  $$('[data-badge="chats"]').forEach(b => { b.textContent = state.unreadChats; b.classList.toggle('hidden', !state.unreadChats); });
  $$('[data-badge="notifs"]').forEach(b => b.classList.toggle('hidden', !state.unreadNotifs));
}
function presence() { if (state.me && !document.hidden) api.touchPresence().catch(() => {}); }
api.on('message', m => { if (m.sender_id !== state.me?.id) refreshBadges(); });
api.on('notification', () => { state.unreadNotifs++; paintBadges(); });
setInterval(() => { if (!document.hidden) { refreshBadges(); presence(); } }, 60000);
document.addEventListener('visibilitychange', presence);

// ---------- Boot ----------
function ServerErrorScreen() {
  const root = el(`<div class="auth"><div class="inner">
    <h1 class="logo">Mosaic</h1>
    <p class="tag">Can't connect to the server</p>
    <div class="demo-note" style="text-align:left">${esc(serverError)}</div>
    ${BUILT_IN_SERVER ? '<button class="btn primary big" id="se-retry">Try again</button>' : '<button class="btn primary big" id="se-server">Server settings</button>'}
  </div></div>`);
  $('#se-server', root)?.addEventListener('click', () => push(ServerScreen));
  $('#se-retry', root)?.addEventListener('click', () => location.reload());
  return { el: root };
}

async function boot() {
  if (serverError) { resetTo(ServerErrorScreen); return; }
  try { state.me = await api.session(); } catch (e) { console.warn(e); state.me = null; }
  if (state.me) enterApp(); else resetTo(AuthScreen);
}
function enterApp() {
  api.start();
  resetTo(MainScreen);
  refreshBadges();
  presence();
}

// =====================================================================
// Sign in
// =====================================================================
function AuthScreen() {
  let signup = false;
  const root = el(`<div class="auth">
    <div class="inner">
      <h1 class="logo">Mosaic</h1>
      <p class="tag">Share moments. Stay close.</p>
      <input class="field" id="a-name" placeholder="Full name" autocomplete="name">
      <input class="field" id="a-user" placeholder="Username" autocapitalize="none" autocomplete="username">
      <input class="field" id="a-email" type="email" placeholder="Email" autocapitalize="none" autocomplete="email">
      <input class="field" id="a-pass" type="password" placeholder="Password" autocomplete="current-password">
      <label class="agree" id="a-agree-row"><input type="checkbox" id="a-agree"><span>I'm ${MIN_AGE} or older and I agree to the ${legalLink('terms.html', 'Terms of Use')} and ${legalLink('privacy.html', 'Privacy Policy')}.</span></label>
      <button class="btn primary big" id="a-go">Log in</button>
      <div class="err" id="a-err"></div>
      <div class="swap"><span id="a-q">Don't have an account?</span> <button id="a-swap">Sign up</button></div>
      ${api.mode === 'demo' ? `<div class="demo-note">Demo mode — accounts and posts stay on this device. Sample people will follow and reply to you.</div>` : ''}
      <div style="text-align:center;margin-top:6px" ${window.MOSAIC_PREVIEW || BUILT_IN_SERVER ? 'hidden' : ''}><button class="linkbtn" id="a-server">${api.mode === 'demo' ? 'Connect to a server' : 'Server settings'}</button></div>
    </div></div>`);
  const paint = () => {
    $('#a-name', root).classList.toggle('hidden', !signup);
    $('#a-user', root).classList.toggle('hidden', !signup);
    $('#a-agree-row', root).classList.toggle('hidden', !signup);
    $('#a-go', root).textContent = signup ? 'Sign up' : 'Log in';
    $('#a-q', root).textContent = signup ? 'Have an account?' : "Don't have an account?";
    $('#a-swap', root).textContent = signup ? 'Log in' : 'Sign up';
    $('#a-pass', root).autocomplete = signup ? 'new-password' : 'current-password';
    $('#a-err', root).textContent = '';
  };
  $('#a-swap', root).onclick = () => { signup = !signup; paint(); };
  $('#a-server', root).onclick = () => push(ServerScreen);
  const go = async () => {
    const btn = $('#a-go', root), err = $('#a-err', root);
    const email = $('#a-email', root).value, pass = $('#a-pass', root).value;
    err.textContent = '';
    if (!email || !pass) { err.textContent = 'Enter your email and password.'; return; }
    if (signup && (!$('#a-name', root).value.trim() || !$('#a-user', root).value.trim())) { err.textContent = 'Enter your name and a username.'; return; }
    if (signup && !$('#a-agree', root).checked) { err.textContent = `To sign up, confirm you're ${MIN_AGE} or older and agree to the Terms and Privacy Policy.`; return; }
    btn.disabled = true;
    try {
      state.me = signup ? await api.signUp(email, pass, $('#a-user', root).value, $('#a-name', root).value) : await api.signIn(email, pass);
      enterApp();
    } catch (e) {
      if (e.signedIn) { state.me = await api.session(); enterApp(); toast(e.message, 5000); return; }
      err.textContent = e.message;
      if (e.info) { signup = false; paint(); err.textContent = e.message; }
    } finally { btn.disabled = false; }
  };
  $('#a-go', root).onclick = go;
  $('#a-pass', root).onkeydown = e => { if (e.key === 'Enter') go(); };
  paint();
  return { el: root };
}

function ServerScreen() {
  const cfg = serverConfig() || { url: '', key: '' };
  const root = el(`<div>${topbar('Server')}
    <div class="scroll"><div class="form">
      <p class="sub" style="margin-top:14px">Connect Mosaic to your Supabase project so people on different phones can follow each other and chat. Leave both fields empty to use demo mode.</p>
      <label class="lbl" for="s-url">Project URL</label>
      <input class="field" id="s-url" placeholder="https://xxxx.supabase.co" autocapitalize="none" value="${esc(cfg.url)}">
      <label class="lbl" for="s-key">Publishable (anon) key</label>
      <textarea class="field" id="s-key" placeholder="eyJ… or sb_publishable_…" autocapitalize="none" style="min-height:110px;font-family:monospace;font-size:12.5px">${esc(cfg.key)}</textarea>
      <div style="height:16px"></div>
      <button class="btn primary big" id="s-save">Save and restart</button>
      <div style="height:10px"></div>
      <button class="btn big" id="s-demo">Use demo mode</button>
    </div></div></div>`);
  wireBack(root);
  $('#s-save', root).onclick = () => {
    const url = $('#s-url', root).value.trim().replace(/\/+$/, ''), key = $('#s-key', root).value.trim();
    if (!url && !key) { store.removeItem('mosaic_server'); location.reload(); return; }
    if (!/^https:\/\/.+/.test(url) || key.length < 20) { toast('Enter both the project URL and the key'); return; }
    store.setItem('mosaic_server', JSON.stringify({ url, key }));
    location.reload();
  };
  $('#s-demo', root).onclick = () => { store.removeItem('mosaic_server'); location.reload(); };
  return { el: root };
}

// =====================================================================
// Main tabs: Home · Search · Create · Reels · Profile
// =====================================================================
function MainScreen() {
  const root = el(`<div>
    <div class="tab-host" style="flex:1;display:flex;flex-direction:column;min-height:0"></div>
    <nav class="tabbar">
      <button data-tab="home" aria-label="Home"></button>
      <button data-tab="search" aria-label="Search">${icon('search')}</button>
      <button data-tab="create" aria-label="New post">${icon('plus')}</button>
      <button data-tab="reels" aria-label="Reels">${icon('reels')}</button>
      <button data-tab="profile" aria-label="Profile">${avatarImg(state.me, '', 'data-me-av')}</button>
    </nav></div>`);
  const host = $('.tab-host', root);
  const tabs = {};
  let current = null;
  const builders = { home: HomeTab, search: SearchTab, reels: ReelsTab, profile: () => ProfileView(state.me.id, true) };
  function show(name) {
    if (name === 'create') { push(CreateScreen, 'post'); return; }
    if (current === name) { tabs[name].onReselect?.(); return; }
    if (current) { tabs[current].el.classList.add('hidden'); tabs[current].onHide?.(); }
    if (!tabs[name]) { tabs[name] = builders[name](); host.appendChild(tabs[name].el); }
    tabs[name].el.classList.remove('hidden');
    current = name; state.tab = name;
    root.classList.toggle('dark-tabbar', name === 'reels');
    $$('.tabbar button', root).forEach(b => b.classList.toggle('on', b.dataset.tab === name));
    $('[data-tab="home"]', root).innerHTML = icon(name === 'home' ? 'homeF' : 'home');
    $('[data-tab="reels"]', root).innerHTML = icon('reels', name === 'reels' ? 'bold' : '');
    tabs[name].onShow?.();
    paintBadges();
  }
  $$('.tabbar button', root).forEach(b => b.onclick = () => show(b.dataset.tab));
  show('home');
  return {
    el: root,
    onShow: () => { if (current) tabs[current].onShow?.(); $$('[data-me-av]').forEach(i => i.src = avatarSrc(state.me)); paintBadges(); },
    onHide: () => { if (current) tabs[current].onHide?.(); },
    reload: (name) => { if (tabs[name]) { tabs[name].onHide?.(); tabs[name].el.remove(); delete tabs[name]; if (current === name) { current = null; show(name); } } },
    show,
  };
}
function reloadHome() { const m = stack[0]; m?.reload?.('home'); }
