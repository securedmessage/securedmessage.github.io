// Mosaic — app shell and screens.  (c) RM Software
'use strict';

const APP_VERSION = '1.0.0';
const ROOT = document.getElementById('app');

// ---------- Backend selection ----------
function serverConfig() {
  try { const s = JSON.parse(store.getItem('mosaic_server')); if (s && s.url && s.key) return s; } catch {}
  const c = window.MOSAIC_CONFIG || {};
  return c.url && c.key ? { url: c.url, key: c.key } : null;
}
let api;
{
  const cfg = serverConfig();
  if (cfg && window.supabase) {
    try { api = new SupabaseAPI(cfg.url, cfg.key); } catch (e) { console.error(e); }
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
function sheet({ title, options = [], content }) {
  return new Promise(resolve => {
    const scrim = el(`<div class="scrim"><div class="sheet"><div class="grab"></div>${title ? `<div class="sheet-h">${esc(title)}</div>` : ''}<div class="scroll body"></div></div></div>`);
    const body = $('.body', scrim);
    options.forEach(o => {
      const b = el(`<button class="opt ${o.danger ? 'danger' : ''}">${esc(o.label)}</button>`);
      b.onclick = () => close(o.value ?? o.label);
      body.appendChild(b);
    });
    if (content) body.appendChild(content);
    const close = v => { scrim.remove(); const i = overlays.indexOf(entry); if (i >= 0) overlays.splice(i, 1); resolve(v); };
    const entry = { close: () => close(null) };
    scrim.onclick = e => { if (e.target === scrim) close(null); };
    overlays.push(entry);
    ROOT.appendChild(scrim);
    scrim._close = close;
  });
}
async function confirmDialog(title, okLabel = 'Delete') {
  return (await sheet({ title, options: [{ label: okLabel, value: 'ok', danger: true }, { label: 'Cancel', value: null }] })) === 'ok';
}
function pickImage(capture = false) {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    if (capture) inp.capture = 'environment';
    inp.onchange = () => resolve(inp.files[0] || null);
    inp.click();
  });
}
async function processUpload(file, opts) {
  const url = URL.createObjectURL(file);
  try {
    const c = renderImage(await loadImage(url), opts);
    return api.uploadImage(await canvasToBlob(c, 0.85));
  } finally { URL.revokeObjectURL(url); }
}
function longPress(node, fn, ms = 480) {
  let t, moved = false;
  node.addEventListener('touchstart', e => { moved = false; t = setTimeout(() => { if (!moved) { navigator.vibrate?.(15); fn(e); } }, ms); }, { passive: true });
  node.addEventListener('touchmove', () => { moved = true; clearTimeout(t); }, { passive: true });
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

// ---------- Navigation ----------
const stack = [];
function push(builder, ...args) {
  const scr = builder(...args);
  scr.el.classList.add('screen', 'push');
  ROOT.appendChild(scr.el);
  stack.push(scr);
  scr.onShow?.();
  return scr;
}
function pop() {
  if (stack.length <= 1) return false;
  const scr = stack.pop();
  scr.onDestroy?.();
  scr.el.classList.add('pop');
  setTimeout(() => scr.el.remove(), 170);
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
  return `<div class="topbar ${cls}">${back ? `<button class="iconbtn" data-back>${icon('back')}</button>` : ''}<h1>${title}</h1>${right}</div>`;
}
function wireBack(root) { $$('[data-back]', root).forEach(b => b.onclick = () => goBack()); }

// Android hardware back button
(function () {
  const App = window.Capacitor?.Plugins?.App;
  if (App) App.addListener('backButton', () => { if (!goBack()) App.exitApp(); });
  else window.addEventListener('keydown', e => { if (e.key === 'Escape') goBack(); });
  if (App) App.addListener('resume', () => refreshBadges());
})();

// ---------- Badges / realtime ----------
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
api.on('message', m => { if (m.sender_id !== state.me?.id) refreshBadges(); });
api.on('notification', () => { state.unreadNotifs++; paintBadges(); });
setInterval(() => { if (!document.hidden) refreshBadges(); }, 60000);

// ---------- Boot ----------
async function boot() {
  try { state.me = await api.session(); } catch (e) { console.warn(e); state.me = null; }
  if (state.me) enterApp(); else resetTo(AuthScreen);
}
function enterApp() {
  api.start();
  resetTo(MainScreen);
  refreshBadges();
}

// =====================================================================
// Auth
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
      <button class="btn primary big" id="a-go">Log in</button>
      <div class="err" id="a-err"></div>
      <div class="swap"><span id="a-q">Don't have an account?</span> <button id="a-swap">Sign up</button></div>
      ${api.mode === 'demo' ? `<div class="demo-note">Demo mode — accounts and posts stay on this device. Sample people will follow and reply to you.</div>` : ''}
      <div style="text-align:center;margin-top:6px" ${window.MOSAIC_PREVIEW ? 'hidden' : ''}><button class="linkbtn" id="a-server">${api.mode === 'demo' ? 'Connect to a server' : 'Server settings'}</button></div>
    </div></div>`);
  const paint = () => {
    $('#a-name', root).classList.toggle('hidden', !signup);
    $('#a-user', root).classList.toggle('hidden', !signup);
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
    btn.disabled = true;
    try {
      state.me = signup ? await api.signUp(email, pass, $('#a-user', root).value, $('#a-name', root).value) : await api.signIn(email, pass);
      enterApp();
    } catch (e) {
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
      <label class="lbl">Project URL</label>
      <input class="field" id="s-url" placeholder="https://xxxx.supabase.co" autocapitalize="none" value="${esc(cfg.url)}">
      <label class="lbl">Publishable (anon) key</label>
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
// Main (tabs)
// =====================================================================
function MainScreen() {
  const root = el(`<div>
    <div class="tab-host" style="flex:1;display:flex;flex-direction:column;min-height:0"></div>
    <nav class="tabbar">
      <button data-tab="home" aria-label="Home"></button>
      <button data-tab="search" aria-label="Search">${icon('search')}</button>
      <button data-tab="create" aria-label="New post">${icon('plus')}</button>
      <button data-tab="activity" aria-label="Activity">${icon('heart')}<span class="dot hidden" data-badge="notifs"></span></button>
      <button data-tab="profile" aria-label="Profile">${avatarImg(state.me, '', 'data-me-av')}</button>
    </nav></div>`);
  const host = $('.tab-host', root);
  const tabs = {};
  let current = null;
  const builders = { home: HomeTab, search: SearchTab, activity: ActivityTab, profile: () => ProfileView(state.me.id, true) };
  function show(name) {
    if (name === 'create') { push(CreateScreen, 'post'); return; }
    if (current === name) { tabs[name].onReselect?.(); return; }
    if (current) { tabs[current].el.classList.add('hidden'); tabs[current].onHide?.(); }
    if (!tabs[name]) { tabs[name] = builders[name](); host.appendChild(tabs[name].el); }
    tabs[name].el.classList.remove('hidden');
    current = name; state.tab = name;
    $$('.tabbar button', root).forEach(b => b.classList.toggle('on', b.dataset.tab === name));
    $('[data-tab="home"]', root).innerHTML = icon(name === 'home' ? 'homeF' : 'home');
    const act = $('[data-tab="activity"]', root);
    act.firstElementChild.outerHTML = icon('heart', name === 'activity' ? 'filled' : '');
    tabs[name].onShow?.();
    paintBadges();
  }
  $$('.tabbar button', root).forEach(b => b.onclick = () => show(b.dataset.tab));
  show('home');
  return {
    el: root,
    onShow: () => { if (current) tabs[current].onShow?.(); $$('[data-me-av]').forEach(i => i.src = avatarSrc(state.me)); paintBadges(); },
    reload: (name) => { if (tabs[name]) { tabs[name].el.remove(); delete tabs[name]; if (current === name) { current = null; show(name); } } },
    show,
  };
}

// ---------- Home ----------
function HomeTab() {
  const root = el(`<div style="flex:1;display:flex;flex-direction:column;min-height:0">
    <div class="topbar"><h1 class="logo">Mosaic</h1>
      <button class="iconbtn" data-act="new">${icon('plus')}</button>
      <button class="iconbtn" data-act="dm">${icon('messenger')}<span class="badge hidden" data-badge="chats"></span></button>
    </div>
    <div class="scroll"><div class="pull hidden" style="height:0;overflow:hidden"></div><div class="stories"></div><div class="feed"><div class="spinner"></div></div></div></div>`);
  const scroller = $('.scroll', root);
  $('[data-act="dm"]', root).onclick = () => push(InboxScreen);
  $('[data-act="new"]', root).onclick = () => push(CreateScreen, 'post');
  let loaded = 0;
  async function load() {
    try {
      const [stories, posts] = await Promise.all([api.stories(), api.feed()]);
      state.storyGroups = stories;
      renderStories();
      const feed = $('.feed', root);
      feed.innerHTML = '';
      if (!posts.length) {
        feed.appendChild(el(`<div class="empty">${icon('camera')}<h3>Welcome to Mosaic</h3><p>Follow people to see their photos here, or share your first post.</p><button class="btn primary" data-go>Find people</button></div>`));
        $('[data-go]', feed).onclick = () => stack[0].show('search');
      }
      posts.forEach(p => feed.appendChild(PostCard(p)));
      loaded = Date.now();
    } catch (e) { fail(e); $('.feed', root).innerHTML = `<div class="empty">Couldn't load your feed.<br><br><button class="btn" data-retry>Try again</button></div>`; $('[data-retry]', root).onclick = load; }
  }
  function renderStories() {
    const tray = $('.stories', root);
    const seen = seenStories();
    const mine = state.storyGroups.find(g => g.user.id === state.me.id);
    tray.innerHTML = '';
    const you = el(`<button class="story"><div style="position:relative">${mine ? `<span class="ring ${mine.items.every(i => seen.has(i.id)) ? 'seen' : ''}">${avatarImg(state.me)}</span>` : avatarImg(state.me)}${mine ? '' : '<div class="plus">+</div>'}</div><span>Your story</span></button>`);
    you.onclick = () => mine ? openStories(state.storyGroups, state.storyGroups.indexOf(mine), renderStories) : push(CreateScreen, 'story');
    longPress(you, () => push(CreateScreen, 'story'));
    tray.appendChild(you);
    const others = state.storyGroups.filter(g => g.user.id !== state.me.id)
      .sort((a, b) => Number(a.items.every(i => seen.has(i.id))) - Number(b.items.every(i => seen.has(i.id))));
    others.forEach(g => {
      const all = g.items.every(i => seen.has(i.id));
      const b = el(`<button class="story"><span class="ring ${all ? 'seen' : ''}">${avatarImg(g.user)}</span><span>${esc(g.user.username)}</span></button>`);
      b.onclick = () => openStories(others, others.indexOf(g), renderStories);
      tray.appendChild(b);
    });
  }
  // Pull down to refresh
  let startY = null, pulling = 0;
  const pull = $('.pull', root);
  scroller.addEventListener('touchstart', e => { startY = scroller.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
  scroller.addEventListener('touchmove', e => {
    if (startY == null) return;
    pulling = Math.max(0, Math.min(90, (e.touches[0].clientY - startY) * 0.5));
    pull.classList.remove('hidden'); pull.style.height = pulling + 'px';
    pull.innerHTML = pulling > 55 ? '<div class="spinner" style="margin:12px auto;width:22px;height:22px"></div>' : '';
  }, { passive: true });
  scroller.addEventListener('touchend', () => {
    if (startY != null && pulling > 55) load().finally(() => { pull.style.height = '0'; });
    else pull.style.height = '0';
    startY = null; pulling = 0;
  });
  load();
  return {
    el: root,
    onShow: () => { if (loaded && Date.now() - loaded > 60000) load(); else if (loaded) renderStories(); },
    onReselect: () => { if (scroller.scrollTop > 0) scroller.scrollTo({ top: 0, behavior: 'smooth' }); else load(); },
    reload: load,
  };
}
function reloadHome() { const m = stack[0]; m?.reload?.('home'); }

function seenStories() { try { return new Set(JSON.parse(store.getItem('mosaic_seen_stories') || '[]')); } catch { return new Set(); } }
function markStorySeen(id) { const s = seenStories(); s.add(id); store.setItem('mosaic_seen_stories', JSON.stringify([...s].slice(-500))); }

// ---------- Post card ----------
function PostCard(p, { onDelete } = {}) {
  const node = el(`<article class="post">
    <div class="post-h">
      <button data-user>${avatarImg(p.author, 's32')}</button>
      <div class="who"><button class="uname" data-user>${esc(p.author?.username)}</button></div>
      <button class="iconbtn" data-more>${icon('more')}</button>
    </div>
    <div class="media"><img src="${esc(p.image_url)}" alt="" loading="lazy"></div>
    <div class="actions">
      <button class="iconbtn" data-like></button>
      <button class="iconbtn" data-comment>${icon('comment')}</button>
      <button class="iconbtn" data-share>${icon('send')}</button>
      <div class="spacer"></div>
      <button class="iconbtn" data-save></button>
    </div>
    <div class="meta">
      <button class="uname" data-likes style="text-align:left"></button>
      ${p.caption ? `<div class="caption"><button class="uname" data-user>${esc(p.author?.username)}</button> ${richText(p.caption)}</div>` : ''}
      <button class="muted" data-comments style="text-align:left"></button>
      <div class="time">${timeAgo(p.created_at, true)}</div>
    </div></article>`);
  const paint = () => {
    const lb = $('[data-like]', node);
    lb.innerHTML = icon('heart', p.liked ? 'filled' : '');
    lb.classList.toggle('liked', p.liked);
    $('[data-save]', node).innerHTML = icon('bookmark', p.saved ? 'filled' : '');
    const likes = $('[data-likes]', node);
    likes.textContent = p.like_count ? `${fmtCount(p.like_count)} like${p.like_count === 1 ? '' : 's'}` : 'Be the first to like this';
    likes.style.fontWeight = p.like_count ? '' : '400';
    const cm = $('[data-comments]', node);
    cm.textContent = p.comment_count ? (p.comment_count === 1 ? 'View 1 comment' : `View all ${fmtCount(p.comment_count)} comments`) : 'Add a comment…';
  };
  const setLike = async (on) => {
    if (p.liked === on) return;
    p.liked = on; p.like_count += on ? 1 : -1; paint();
    try { on ? await api.like(p.id) : await api.unlike(p.id); }
    catch (e) { p.liked = !on; p.like_count += on ? -1 : 1; paint(); fail(e); }
  };
  $$('[data-user]', node).forEach(b => b.onclick = () => openProfile(p.user_id));
  $('[data-like]', node).onclick = () => setLike(!p.liked);
  doubleTap($('.media', node), () => {
    const h = el(`<div class="burst">${icon('heart', 'filled')}</div>`);
    $('.media', node).appendChild(h); setTimeout(() => h.remove(), 850);
    setLike(true);
  });
  const openComments = () => push(CommentsScreen, p, () => paint());
  $('[data-comment]', node).onclick = openComments;
  $('[data-comments]', node).onclick = openComments;
  $('[data-likes]', node).onclick = () => { if (p.like_count) push(UserListScreen, 'Likes', () => api.likers(p.id)); };
  $('[data-share]', node).onclick = () => sharePost(p);
  $('[data-save]', node).onclick = async () => {
    p.saved = !p.saved; paint();
    try { p.saved ? await api.save(p.id) : await api.unsave(p.id); if (p.saved) toast('Saved to your collection'); }
    catch (e) { p.saved = !p.saved; paint(); fail(e); }
  };
  $('[data-more]', node).onclick = async () => {
    const mine = p.user_id === state.me.id;
    const opts = mine ? [{ label: 'Delete post', value: 'del', danger: true }] : [{ label: 'View profile', value: 'prof' }];
    opts.push({ label: 'Share to…', value: 'share' }, { label: 'Cancel', value: null });
    const v = await sheet({ options: opts });
    if (v === 'prof') openProfile(p.user_id);
    if (v === 'share') sharePost(p);
    if (v === 'del' && await confirmDialog('Delete this post?')) {
      try { await api.deletePost(p.id); node.remove(); toast('Post deleted'); onDelete?.(p); } catch (e) { fail(e); }
    }
  };
  $$('[data-mention]', node).forEach(m => m.onclick = async (e) => { e.stopPropagation(); const u = await api.getProfileByUsername(m.dataset.mention); if (u) openProfile(u.id); });
  paint();
  return node;
}

async function sharePost(p) {
  const content = el(`<div><div class="searchbar">${icon('search')}<input placeholder="Search"></div><div class="res"></div></div>`);
  const res = $('.res', content);
  const showList = (people) => {
    res.innerHTML = people.length ? '' : '<div class="empty" style="padding:24px">No one found</div>';
    people.filter(u => u.id !== state.me.id).forEach(u => {
      const row = el(`<div class="list-item">${avatarImg(u, 's44')}<div class="grow"><div class="uname">${esc(u.full_name || u.username)}</div><div class="sub">${esc(u.username)}</div></div><button class="btn primary">Send</button></div>`);
      const b = $('button', row);
      b.onclick = async () => {
        b.disabled = true;
        try { const cid = await api.openDM(u.id); await api.sendMessage(cid, { post_id: p.id }); b.textContent = 'Sent'; }
        catch (e) { b.disabled = false; fail(e); }
      };
      res.appendChild(row);
    });
  };
  const initial = async () => {
    const convs = await api.conversations().catch(() => []);
    const people = convs.map(c => c.other);
    if (people.length < 8) (await api.following(state.me.id).catch(() => [])).forEach(u => { if (!people.find(x => x.id === u.id)) people.push(u); });
    showList(people.slice(0, 20));
  };
  $('input', content).oninput = debounce(async e => { const q = e.target.value; q ? showList(await api.searchUsers(q)) : initial(); }, 250);
  initial();
  sheet({ title: 'Share', content });
}

function openProfile(id) {
  if (id === state.me.id && stack.length === 1) { stack[0].show('profile'); return; }
  push(() => ProfileView(id, false));
}

// ---------- Comments ----------
function CommentsScreen(p, onChange) {
  const root = el(`<div>${topbar('Comments')}<div class="scroll"><div class="list"><div class="spinner"></div></div></div>
    <div class="composer">${avatarImg(state.me, 's32')}<div class="box"><textarea rows="1" placeholder="Add a comment for ${esc(p.author?.username)}…" maxlength="1000"></textarea><button class="send" disabled>Post</button></div></div></div>`);
  wireBack(root);
  const list = $('.list', root), ta = $('textarea', root), send = $('.send', root);
  const row = (c, isCaption = false) => {
    const r = el(`<div class="list-item" style="align-items:flex-start">
      <button data-u>${avatarImg(c.author, 's32')}</button>
      <div class="grow"><div style="white-space:normal"><button class="uname" data-u>${esc(c.author?.username)}</button> <span class="caption">${richText(c.body)}</span></div>
      <div class="sub">${timeAgo(c.created_at)}${isCaption ? '' : `  ·  <button class="sub" data-reply>Reply</button>`}</div></div></div>`);
    $$('[data-u]', r).forEach(b => b.onclick = () => openProfile(c.user_id));
    $('[data-reply]', r)?.addEventListener('click', () => { ta.value = `@${c.author.username} `; ta.focus(); send.disabled = false; });
    $$('[data-mention]', r).forEach(m => m.onclick = async () => { const u = await api.getProfileByUsername(m.dataset.mention); if (u) openProfile(u.id); });
    if (!isCaption && (c.user_id === state.me.id || p.user_id === state.me.id)) longPress(r, async () => {
      if (await confirmDialog('Delete comment?')) {
        try { await api.deleteComment(c.id); r.remove(); p.comment_count--; onChange?.(); } catch (e) { fail(e); }
      }
    });
    return r;
  };
  async function load() {
    try {
      const cs = await api.comments(p.id);
      list.innerHTML = '';
      if (p.caption) { list.appendChild(row({ author: p.author, user_id: p.user_id, body: p.caption, created_at: p.created_at }, true)); list.appendChild(el('<div style="border-bottom:1px solid var(--line);margin:4px 0"></div>')); }
      if (!cs.length) list.appendChild(el(`<div class="empty"><h3>No comments yet</h3><p>Start the conversation.</p></div>`));
      cs.forEach(c => list.appendChild(row(c)));
      if (cs.length) list.appendChild(el(`<div class="sub" style="text-align:center;padding:12px">Press and hold your comment to delete it</div>`));
    } catch (e) { fail(e); }
  }
  ta.oninput = () => { autoGrow(ta); send.disabled = !ta.value.trim(); };
  send.onclick = async () => {
    const body = ta.value.trim(); if (!body) return;
    send.disabled = true;
    try {
      await api.addComment(p.id, body);
      ta.value = ''; autoGrow(ta); p.comment_count++; onChange?.();
      await load(); $('.scroll', root).scrollTo(0, 1e6);
    } catch (e) { fail(e); send.disabled = false; }
  };
  load();
  return { el: root };
}

// ---------- User list (likes, followers…) ----------
function UserListScreen(title, loader) {
  const root = el(`<div>${topbar(esc(title))}<div class="scroll"><div class="list"><div class="spinner"></div></div></div></div>`);
  wireBack(root);
  loader().then(async users => {
    const list = $('.list', root);
    list.innerHTML = users.length ? '' : '<div class="empty">No one here yet.</div>';
    for (const u of users) list.appendChild(await UserRow(u));
  }).catch(fail);
  return { el: root };
}
async function UserRow(u, { followBtn = true } = {}) {
  const r = el(`<div class="list-item"><button data-u>${avatarImg(u, 's44')}</button><button class="grow" data-u style="text-align:left"><div class="uname">${esc(u.username)}</div><div class="sub">${esc(u.full_name)}</div></button><span class="fb"></span></div>`);
  $$('[data-u]', r).forEach(b => b.onclick = () => openProfile(u.id));
  if (followBtn && u.id !== state.me.id) {
    const following = await api.isFollowing(u.id).catch(() => false);
    $('.fb', r).appendChild(FollowButton(u.id, following));
  }
  return r;
}
function FollowButton(userId, following, followsYou = false, onChange) {
  const b = el('<button class="btn"></button>');
  const paint = () => { b.textContent = following ? 'Following' : followsYou ? 'Follow back' : 'Follow'; b.classList.toggle('primary', !following); };
  b.onclick = async (e) => {
    e.stopPropagation();
    if (following && !(await confirmDialog('Unfollow?', 'Unfollow'))) return;
    following = !following; paint(); onChange?.(following);
    try { following ? await api.follow(userId) : await api.unfollow(userId); reloadHome(); }
    catch (err) { following = !following; paint(); onChange?.(following); fail(err); }
  };
  paint();
  return b;
}

// ---------- Search / explore ----------
function SearchTab() {
  const root = el(`<div style="flex:1;display:flex;flex-direction:column;min-height:0">
    <div class="searchbar" style="margin-top:10px">${icon('search')}<input placeholder="Search people" autocapitalize="none"><button class="iconbtn hidden" data-clear style="width:30px;height:30px">${icon('close')}</button></div>
    <div class="scroll"><div class="results hidden"></div><div class="discover"><div class="spinner"></div></div></div></div>`);
  const input = $('input', root), results = $('.results', root), discover = $('.discover', root);
  let loaded = false;
  async function loadDiscover() {
    try {
      const [sugg, posts] = await Promise.all([api.suggestedUsers(), api.explore()]);
      discover.innerHTML = '';
      if (sugg.length) {
        discover.appendChild(el(`<div class="section-h">Suggested for you</div>`));
        for (const u of sugg.slice(0, 5)) discover.appendChild(await UserRow(u));
      }
      discover.appendChild(el(`<div class="section-h">Explore</div>`));
      if (!posts.length) discover.appendChild(el(`<div class="empty">Nothing to explore yet. Posts from everyone on Mosaic show up here.</div>`));
      discover.appendChild(PostGrid(posts, 'Explore', 'explore'));
      loaded = true;
    } catch (e) { fail(e); }
  }
  const run = debounce(async () => {
    const q = input.value.trim();
    $('[data-clear]', root).classList.toggle('hidden', !q);
    results.classList.toggle('hidden', !q); discover.classList.toggle('hidden', !!q);
    if (!q) return;
    try {
      const users = await api.searchUsers(q);
      if (input.value.trim() !== q) return;
      results.innerHTML = users.length ? '' : `<div class="empty">No results for “${esc(q)}”</div>`;
      for (const u of users) results.appendChild(await UserRow(u, { followBtn: false }));
    } catch (e) { fail(e); }
  }, 250);
  input.oninput = run;
  $('[data-clear]', root).onclick = () => { input.value = ''; run(); };
  return { el: root, onShow: () => { if (!loaded) loadDiscover(); }, onReselect: () => { input.focus(); }, };
}

function PostGrid(posts, title, cls = '') {
  const g = el(`<div class="grid ${cls}"></div>`);
  posts.forEach((p, i) => {
    const b = el(`<button><img src="${esc(p.image_url)}" alt="" loading="lazy"></button>`);
    b.onclick = () => push(PostListScreen, title, posts, i);
    g.appendChild(b);
  });
  return g;
}
function PostListScreen(title, posts, start = 0) {
  const root = el(`<div>${topbar(esc(title))}<div class="scroll"></div></div>`);
  wireBack(root);
  const sc = $('.scroll', root);
  posts.forEach(p => sc.appendChild(PostCard(p)));
  requestAnimationFrame(() => { const t = sc.children[start]; if (t) sc.scrollTop = t.offsetTop - sc.offsetTop; });
  return { el: root };
}
function SinglePostScreen(postId) {
  const root = el(`<div>${topbar('Post')}<div class="scroll"><div class="spinner"></div></div></div>`);
  wireBack(root);
  api.getPost(postId).then(p => {
    const sc = $('.scroll', root);
    sc.innerHTML = p ? '' : '<div class="empty">This post is no longer available.</div>';
    if (p) sc.appendChild(PostCard(p, { onDelete: () => pop() }));
  }).catch(fail);
  return { el: root };
}

// ---------- Activity ----------
function ActivityTab() {
  const root = el(`<div style="flex:1;display:flex;flex-direction:column;min-height:0">
    <div class="topbar"><h1>Notifications</h1></div><div class="scroll"><div class="list"><div class="spinner"></div></div></div></div>`);
  const list = $('.list', root);
  async function load() {
    try {
      const ns = await api.notifications();
      list.innerHTML = '';
      if (!ns.length) { list.appendChild(el(`<div class="empty">${icon('heart')}<h3>Activity on your posts</h3><p>When someone likes or comments on your posts, or follows you, you'll see it here.</p></div>`)); }
      const fresh = ns.filter(n => !n.read), old = ns.filter(n => n.read);
      const section = async (label, items) => {
        if (!items.length) return;
        list.appendChild(el(`<div class="section-h">${label}</div>`));
        for (const n of items) list.appendChild(await NotifRow(n));
      };
      await section('New', fresh);
      await section(fresh.length ? 'Earlier' : 'Recent', old);
      if (fresh.length) { await api.markNotificationsRead(); state.unreadNotifs = 0; paintBadges(); }
    } catch (e) { fail(e); }
  }
  return { el: root, onShow: load, onReselect: load };
}
async function NotifRow(n) {
  const text = n.type === 'like' ? 'liked your post.' : n.type === 'comment' ? `commented: ${esc(n.body || '')}` : 'started following you.';
  const r = el(`<div class="list-item"><button data-u>${avatarImg(n.actor, 's44')}</button>
    <div class="grow" style="white-space:normal"><span class="uname">${esc(n.actor?.username)}</span> ${text} <span class="sub">${timeAgo(n.created_at)}</span></div><span class="end"></span></div>`);
  $('[data-u]', r).onclick = () => openProfile(n.actor_id);
  const end = $('.end', r);
  if (n.type === 'follow') {
    const f = await api.isFollowing(n.actor_id).catch(() => true);
    end.appendChild(FollowButton(n.actor_id, f, true));
    r.onclick = e => { if (!e.target.closest('button')) openProfile(n.actor_id); };
  } else {
    if (n.post_image) end.appendChild(el(`<img class="thumb" src="${esc(n.post_image)}" alt="">`));
    r.onclick = e => { if (!e.target.closest('[data-u]')) push(SinglePostScreen, n.post_id); };
  }
  return r;
}

// ---------- Profile ----------
function ProfileView(userId, isTab) {
  const own = userId === state.me.id;
  const root = el(`<div ${isTab ? 'style="flex:1;display:flex;flex-direction:column;min-height:0"' : ''}>
    <div class="topbar">${isTab ? '' : `<button class="iconbtn" data-back>${icon('back')}</button>`}<h1 class="ptitle"></h1>
      ${own ? `<button class="iconbtn" data-new>${icon('plus')}</button><button class="iconbtn" data-settings>${icon('settings')}</button>` : `<button class="iconbtn" data-more>${icon('more')}</button>`}</div>
    <div class="scroll"><div class="spinner"></div></div></div>`);
  wireBack(root);
  const sc = $('.scroll', root);
  let tab = 'posts';
  $('[data-settings]', root)?.addEventListener('click', () => push(SettingsScreen));
  $('[data-new]', root)?.addEventListener('click', async () => {
    const v = await sheet({ title: 'Create', options: [{ label: 'Post', value: 'post' }, { label: 'Story', value: 'story' }, { label: 'Cancel', value: null }] });
    if (v) push(CreateScreen, v);
  });
  async function load() {
    try {
      const [u, st, posts, following, followsYou] = await Promise.all([
        own ? Promise.resolve(state.me) : api.getProfile(userId), api.stats(userId), api.userPosts(userId),
        own ? false : api.isFollowing(userId), own ? false : api.followsMe(userId)]);
      if (!u) { sc.innerHTML = '<div class="empty">This account doesn\'t exist.</div>'; return; }
      if (own) state.me = u;
      $('.ptitle', root).textContent = u.username;
      const g = state.storyGroups.find(x => x.user.id === u.id);
      sc.innerHTML = '';
      const head = el(`<div class="prof">
        <div class="prof-top"><button data-av>${g ? `<span class="ring">${avatarImg(u, 's86')}</span>` : avatarImg(u, 's86')}</button>
          <div class="counts"><div><b>${fmtCount(st.posts)}</b><span>posts</span></div>
          <button data-followers><b>${fmtCount(st.followers)}</b><span>followers</span></button>
          <button data-following><b>${fmtCount(st.following)}</b><span>following</span></button></div></div>
        ${u.full_name ? `<div class="name">${esc(u.full_name)}</div>` : '<div style="height:10px"></div>'}
        ${u.bio ? `<div class="bio">${richText(u.bio)}</div>` : ''}
        <div class="row" style="margin-top:14px"></div></div>`);
      const row = $('.row', head);
      if (own) {
        const edit = el('<button class="btn block">Edit profile</button>'); edit.onclick = () => push(EditProfileScreen);
        const share = el('<button class="btn block">Share profile</button>');
        share.onclick = async () => { try { await navigator.clipboard.writeText('@' + u.username); toast('Username copied'); } catch { toast('@' + u.username); } };
        row.append(edit, share);
      } else {
        const fb = FollowButton(u.id, following, followsYou, on => { st.followers += on ? 1 : -1; $('[data-followers] b', head).textContent = fmtCount(st.followers); }); fb.classList.add('block');
        const msg = el('<button class="btn block">Message</button>');
        msg.onclick = async () => { try { push(ChatScreen, await api.openDM(u.id)); } catch (e) { fail(e); } };
        row.append(fb, msg);
      }
      $('[data-av]', head).onclick = () => { if (g) openStories([g], 0); };
      $('[data-followers]', head).onclick = () => push(UserListScreen, 'Followers', () => api.followers(u.id));
      $('[data-following]', head).onclick = () => push(UserListScreen, 'Following', () => api.following(u.id));
      sc.appendChild(head);
      if (own) {
        const tabs = el(`<div class="tabs"><button data-t="posts">${icon('grid')}</button><button data-t="saved">${icon('bookmark')}</button></div>`);
        sc.appendChild(tabs);
        const body = el('<div></div>'); sc.appendChild(body);
        const showTab = async (t) => {
          tab = t;
          $$('button', tabs).forEach(b => b.classList.toggle('on', b.dataset.t === t));
          const list = t === 'posts' ? posts : await api.savedPosts();
          body.innerHTML = '';
          if (!list.length) body.appendChild(el(t === 'posts'
            ? `<div class="empty">${icon('camera')}<h3>Share photos</h3><p>When you share photos, they'll appear on your profile.</p><button class="btn primary" data-share>Share your first photo</button></div>`
            : `<div class="empty">${icon('bookmark')}<h3>Save</h3><p>Save photos you want to see again. Only you can see what you've saved.</p></div>`));
          $('[data-share]', body)?.addEventListener('click', () => push(CreateScreen, 'post'));
          body.appendChild(PostGrid(list, t === 'posts' ? 'Posts' : 'Saved'));
        };
        $$('button', tabs).forEach(b => b.onclick = () => showTab(b.dataset.t));
        showTab(tab);
      } else {
        sc.appendChild(el('<div class="tabs"><button class="on">' + icon('grid') + '</button></div>'));
        if (!posts.length) sc.appendChild(el(`<div class="empty">${icon('camera')}<h3>No posts yet</h3></div>`));
        sc.appendChild(PostGrid(posts, 'Posts'));
      }
    } catch (e) { fail(e); }
  }
  $('[data-more]', root)?.addEventListener('click', async () => {
    const v = await sheet({ options: [{ label: 'Send message', value: 'msg' }, { label: 'Copy username', value: 'copy' }, { label: 'Cancel', value: null }] });
    if (v === 'msg') { try { push(ChatScreen, await api.openDM(userId)); } catch (e) { fail(e); } }
    if (v === 'copy') { const u = await api.getProfile(userId); try { await navigator.clipboard.writeText('@' + u.username); toast('Copied'); } catch {} }
  });
  let shown = 0;
  return { el: root, onShow: () => { if (Date.now() - shown > 1500) load(); shown = Date.now(); }, onReselect: load };
}

function EditProfileScreen() {
  const me = state.me;
  let avatar = me.avatar_url;
  const root = el(`<div>${topbar('Edit profile', { right: '<button class="linkbtn" data-save style="padding:0 10px">Done</button>' })}
    <div class="scroll"><div class="form">
      <div style="text-align:center;margin:18px 0 6px"><button data-pic><img class="av s86" src="${esc(avatarSrc(me))}" style="margin:0 auto"></button>
      <div><button class="linkbtn" data-pic2 style="margin-top:10px">Change photo</button></div></div>
      <label class="lbl">Name</label><input class="field" id="e-name" maxlength="60" value="${esc(me.full_name)}">
      <label class="lbl">Username</label><input class="field" id="e-user" maxlength="30" autocapitalize="none" value="${esc(me.username)}">
      <label class="lbl">Bio</label><textarea class="field" id="e-bio" maxlength="300">${esc(me.bio)}</textarea>
    </div></div></div>`);
  wireBack(root);
  const change = async () => {
    const opts = [{ label: 'Choose photo', value: 'pick' }];
    if (avatar) opts.push({ label: 'Remove photo', value: 'rm', danger: true });
    opts.push({ label: 'Cancel', value: null });
    const v = await sheet({ title: 'Profile photo', options: opts });
    if (v === 'rm') { avatar = ''; $('[data-pic] img', root).src = defaultAvatar(me.full_name || me.username); }
    if (v === 'pick') {
      const f = await pickImage(); if (!f) return;
      toast('Uploading…', 10000);
      try { avatar = await processUpload(f, { max: 400, square: true }); $('[data-pic] img', root).src = avatar; toast('Photo ready'); } catch (e) { fail(e); }
    }
  };
  $('[data-pic]', root).onclick = change; $('[data-pic2]', root).onclick = change;
  $('[data-save]', root).onclick = async () => {
    try {
      state.me = await api.updateProfile({ full_name: $('#e-name', root).value.trim(), username: $('#e-user', root).value, bio: $('#e-bio', root).value.trim(), avatar_url: avatar });
      $$('[data-me-av]').forEach(i => i.src = avatarSrc(state.me));
      toast('Profile updated'); pop();
    } catch (e) { fail(e); }
  };
  return { el: root };
}

// ---------- Settings ----------
function SettingsScreen() {
  const themeName = () => ({ system: 'System', light: 'Light', dark: 'Dark' }[store.getItem('mosaic_theme') || 'system']);
  const root = el(`<div>${topbar('Settings')}<div class="scroll">
    <button class="set-row" data-a="edit">${icon('user')}Edit profile</button>
    <button class="set-row" data-a="theme">${icon('moon')}Appearance<span class="val">${themeName()}</span></button>
    <button class="set-row" data-a="server" ${window.MOSAIC_PREVIEW ? 'hidden' : ''}>${icon('server')}Server<span class="val">${api.mode === 'demo' ? 'Demo mode' : 'Connected'}</span></button>
    ${api.mode === 'demo' ? `<button class="set-row" data-a="reset">${icon('trash')}Reset demo data</button>` : ''}
    <button class="set-row" data-a="about">${icon('info')}About Mosaic</button>
    <button class="set-row" data-a="logout" style="color:var(--like)">${icon('logout')}Log out ${esc(state.me.username)}</button>
  </div></div>`);
  wireBack(root);
  $$('[data-a]', root).forEach(b => b.onclick = async () => {
    const a = b.dataset.a;
    if (a === 'edit') push(EditProfileScreen);
    if (a === 'server') push(ServerScreen);
    if (a === 'about') push(AboutScreen);
    if (a === 'theme') {
      const v = await sheet({ title: 'Appearance', options: [{ label: 'Use system setting', value: 'system' }, { label: 'Light', value: 'light' }, { label: 'Dark', value: 'dark' }] });
      if (v) { store.setItem('mosaic_theme', v); applyTheme(); $('.val', b).textContent = themeName(); }
    }
    if (a === 'reset' && await confirmDialog('Erase all demo accounts, posts and chats on this device?', 'Reset')) { api.reset(); location.reload(); }
    if (a === 'logout' && await confirmDialog('Log out of Mosaic?', 'Log out')) { await api.signOut(); state.me = null; resetTo(AuthScreen); }
  });
  return { el: root };
}
function AboutScreen() {
  const root = el(`<div>${topbar('About')}<div class="scroll"><div class="about">
    <span class="logo">Mosaic</span>
    <p>Version ${APP_VERSION}</p>
    <p>Share photos and stories, follow friends, and chat in real time.</p>
    <p style="margin-top:28px">© ${new Date().getFullYear()} RM Software. All rights reserved.</p>
  </div></div></div>`);
  wireBack(root);
  return { el: root };
}

// =====================================================================
// Create post / story
// =====================================================================
function CreateScreen(mode = 'post') {
  let img = null, filter = 'none', file = null;
  const root = el(`<div>${topbar('New post', { right: '<button class="linkbtn" data-share style="padding:0 12px">Share</button>' })}
    <div class="scroll">
      <div class="seg"><button data-m="post">Post</button><button data-m="story">Story</button></div>
      <div class="pick">${icon('image')}<div>Choose a photo from your gallery or take a new one.</div>
        <div class="row"><button class="btn primary" data-pick>Gallery</button><button class="btn" data-cam>Camera</button></div></div>
      <div class="editor hidden">
        <div class="preview" style="margin-top:10px"><canvas></canvas></div>
        <div class="filters"></div>
        <div class="post-only" style="padding:0 14px 20px">
          <textarea class="field" placeholder="Write a caption…" maxlength="2200"></textarea>
          <div style="margin-top:10px"><button class="linkbtn" data-repick>Choose a different photo</button></div>
        </div>
        <div class="story-only" style="padding:4px 14px 20px"><button class="linkbtn" data-repick2>Choose a different photo</button><p class="sub">Stories disappear after 24 hours.</p></div>
      </div>
    </div></div>`);
  wireBack(root);
  const canvas = $('canvas', root), shareBtn = $('[data-share]', root);
  const paintMode = () => {
    $('h1', root).textContent = mode === 'post' ? 'New post' : 'New story';
    $$('.seg button', root).forEach(b => b.classList.toggle('on', b.dataset.m === mode));
    $('.post-only', root).classList.toggle('hidden', mode !== 'post');
    $('.story-only', root).classList.toggle('hidden', mode !== 'story');
    canvas.style.aspectRatio = mode === 'post' ? '1' : '9 / 16';
    canvas.style.objectFit = 'cover';
    shareBtn.style.opacity = img ? 1 : .4;
    if (img) draw();
  };
  const draw = () => {
    const c = renderImage(img, { max: 1080, square: mode === 'post', filter });
    canvas.width = c.width; canvas.height = c.height;
    canvas.getContext('2d').drawImage(c, 0, 0);
  };
  async function choose(capture) {
    const f = await pickImage(capture); if (!f) return;
    file = f;
    const url = URL.createObjectURL(f);
    try { img = await loadImage(url); } catch { toast("That photo couldn't be opened"); return; }
    $('.pick', root).classList.add('hidden'); $('.editor', root).classList.remove('hidden');
    const thumb = renderImage(img, { max: 160, square: true }).toDataURL('image/jpeg', .7);
    const fl = $('.filters', root); fl.innerHTML = '';
    FILTERS.forEach(([name, f]) => {
      const b = el(`<button class="${f === filter ? 'on' : ''}"><img src="${thumb}" style="filter:${f}"><span>${name}</span></button>`);
      b.onclick = () => { filter = f; $$('button', fl).forEach(x => x.classList.remove('on')); b.classList.add('on'); draw(); };
      fl.appendChild(b);
    });
    paintMode();
  }
  $('[data-pick]', root).onclick = () => choose(false);
  $('[data-cam]', root).onclick = () => choose(true);
  $('[data-repick]', root).onclick = () => choose(false);
  $('[data-repick2]', root).onclick = () => choose(false);
  $$('.seg button', root).forEach(b => b.onclick = () => { mode = b.dataset.m; paintMode(); });
  shareBtn.onclick = async () => {
    if (!img) { toast('Choose a photo first'); return; }
    shareBtn.disabled = true; shareBtn.textContent = 'Sharing…';
    try {
      const c = renderImage(img, { max: mode === 'post' ? 1080 : 1440, square: mode === 'post', filter });
      const url = await api.uploadImage(await canvasToBlob(c, 0.86));
      if (mode === 'post') await api.createPost(url, $('textarea', root).value.trim());
      else await api.addStory(url);
      toast(mode === 'post' ? 'Shared to your profile' : 'Added to your story');
      pop();
      stack[0].show?.('home');
      reloadHome();
      stack[0].reload?.('profile');
    } catch (e) { fail(e); shareBtn.disabled = false; shareBtn.textContent = 'Share'; }
  };
  paintMode();
  return { el: root };
}

// =====================================================================
// Stories viewer
// =====================================================================
function openStories(groups, gi, onClose) {
  if (!groups[gi]) return;
  const DUR = 5000;
  let ii = 0, start = 0, elapsed = 0, paused = false, raf;
  const v = el(`<div class="viewer"><div class="bars"></div>
    <div class="vh"><button data-u class="row" style="align-items:center;gap:10px"><img class="av s32"><span class="uname"></span></button><span class="sub"></span>
      <button class="iconbtn hidden" data-del>${icon('more')}</button><button class="iconbtn" data-x>${icon('close')}</button></div>
    <div class="stage"><img alt=""><div class="tapl"></div><div class="tapr"></div></div>
    <div class="reply"><input placeholder="Send message" maxlength="1000"><button class="iconbtn" data-send>${icon('send')}</button></div></div>`);
  const entry = { close: () => close() };
  overlays.push(entry);
  ROOT.appendChild(v);
  const imgEl = $('.stage img', v), input = $('.reply input', v);
  function show() {
    const g = groups[gi], it = g.items[ii];
    $('.bars', v).innerHTML = g.items.map((_, k) => `<div><i style="width:${k < ii ? 100 : 0}%"></i></div>`).join('');
    $('.vh img', v).src = avatarSrc(g.user);
    $('.vh .uname', v).textContent = g.user.username;
    $('.vh .sub', v).textContent = timeAgo(it.created_at);
    const mine = g.user.id === state.me.id;
    $('[data-del]', v).classList.toggle('hidden', !mine);
    $('.reply', v).style.visibility = mine ? 'hidden' : 'visible';
    imgEl.src = it.image_url;
    markStorySeen(it.id);
    elapsed = 0; start = performance.now();
  }
  function tick(t) {
    if (!paused) {
      const p = Math.min(1, (elapsed + t - start) / DUR);
      const bar = $$('.bars i', v)[ii]; if (bar) bar.style.width = p * 100 + '%';
      if (p >= 1) { next(); }
    }
    raf = requestAnimationFrame(tick);
  }
  function pause() { if (!paused) { paused = true; elapsed += performance.now() - start; } }
  function resume() { if (paused) { paused = false; start = performance.now(); } }
  function next() { const g = groups[gi]; if (ii < g.items.length - 1) { ii++; show(); } else if (gi < groups.length - 1) { gi++; ii = 0; show(); } else close(); }
  function prev() { if (ii > 0) { ii--; show(); } else if (gi > 0) { gi--; ii = groups[gi].items.length - 1; show(); } else show(); }
  function close() { cancelAnimationFrame(raf); v.remove(); const k = overlays.indexOf(entry); if (k >= 0) overlays.splice(k, 1); onClose?.(); }
  $('.tapl', v).onclick = prev; $('.tapr', v).onclick = next;
  const stage = $('.stage', v);
  stage.addEventListener('touchstart', pause, { passive: true }); stage.addEventListener('touchend', resume);
  stage.addEventListener('mousedown', pause); stage.addEventListener('mouseup', resume);
  $('[data-x]', v).onclick = close;
  $('[data-u]', v).onclick = () => { const u = groups[gi].user; close(); openProfile(u.id); };
  input.onfocus = pause; input.onblur = resume;
  const sendReply = async () => {
    const body = input.value.trim(); if (!body) return;
    const g = groups[gi], it = g.items[ii];
    input.value = ''; input.blur();
    try { const cid = await api.openDM(g.user.id); await api.sendMessage(cid, { body, story_url: it.image_url }); toast('Message sent'); } catch (e) { fail(e); }
  };
  $('[data-send]', v).onclick = sendReply;
  input.onkeydown = e => { if (e.key === 'Enter') sendReply(); };
  $('[data-del]', v).onclick = async () => {
    pause();
    const it = groups[gi].items[ii];
    const r = await sheet({ options: [{ label: 'Delete story', value: 'd', danger: true }, { label: 'Cancel', value: null }] });
    if (r === 'd') {
      try {
        await api.deleteStory(it.id);
        groups[gi].items.splice(ii, 1);
        if (!groups[gi].items.length) { groups.splice(gi, 1); state.storyGroups = state.storyGroups.filter(x => x.items.length); close(); reloadHome(); return; }
        ii = Math.min(ii, groups[gi].items.length - 1); show();
      } catch (e) { fail(e); }
    }
    resume();
  };
  show(); raf = requestAnimationFrame(tick);
}

function openImage(src) {
  const v = el(`<div class="viewer"><div class="vh"><span style="flex:1"></span><button class="iconbtn" data-x>${icon('close')}</button></div><div class="stage"><img src="${esc(src)}" alt=""></div></div>`);
  const entry = { close: () => { v.remove(); overlays.splice(overlays.indexOf(entry), 1); } };
  overlays.push(entry);
  $('[data-x]', v).onclick = entry.close;
  ROOT.appendChild(v);
}

// =====================================================================
// Messaging
// =====================================================================
function InboxScreen() {
  const root = el(`<div>${topbar(esc(state.me.username), { right: `<button class="iconbtn" data-new>${icon('newmsg')}</button>` })}
    <div class="searchbar">${icon('search')}<input placeholder="Search"></div>
    <div class="scroll"><div class="list"><div class="spinner"></div></div></div></div>`);
  wireBack(root);
  const list = $('.list', root), input = $('input', root);
  let convs = [];
  const paint = () => {
    const q = input.value.trim().toLowerCase();
    const items = convs.filter(c => !q || c.other.username.includes(q) || (c.other.full_name || '').toLowerCase().includes(q));
    list.innerHTML = '';
    if (!items.length) {
      list.appendChild(el(`<div class="empty">${icon('messenger')}<h3>${q ? 'No matches' : 'Your messages'}</h3><p>${q ? '' : 'Send private photos and messages to a friend.'}</p>${q ? '' : '<button class="btn primary" data-start>Send message</button>'}</div>`));
      $('[data-start]', list)?.addEventListener('click', () => push(NewMessageScreen));
    }
    items.forEach(c => {
      const mine = c.last_sender_id === state.me.id;
      const seen = mine && c.other_last_read >= c.updated_at;
      const r = el(`<button class="list-item ${c.unread ? 'unread' : ''}">${avatarImg(c.other, 's56')}
        <div class="grow"><div class="uname" style="font-weight:${c.unread ? 700 : 500}">${esc(c.other.full_name || c.other.username)}</div>
        <div class="sub">${mine ? (seen ? 'Seen · ' : 'You: ') : ''}${esc(c.last_message)} · ${timeAgo(c.updated_at)}</div></div>
        ${c.unread ? '<span class="udot"></span>' : ''}</button>`);
      r.onclick = () => push(ChatScreen, c.id);
      list.appendChild(r);
    });
  };
  async function load() { try { convs = await api.conversations(); paint(); } catch (e) { fail(e); } }
  input.oninput = paint;
  $('[data-new]', root).onclick = () => push(NewMessageScreen);
  const offs = [api.on('message', () => load()), api.on('read', () => load()), api.on('message_delete', () => load())];
  return { el: root, onShow: () => { load(); refreshBadges(); }, onDestroy: () => offs.forEach(f => f()) };
}

function NewMessageScreen() {
  const root = el(`<div>${topbar('New message')}<div class="searchbar">${icon('search')}<input placeholder="Search people" autocapitalize="none"></div><div class="scroll"><div class="list"></div></div></div>`);
  wireBack(root);
  const list = $('.list', root), input = $('input', root);
  const show = (users, label) => {
    list.innerHTML = label ? `<div class="section-h">${label}</div>` : '';
    users = users.filter(u => u && u.id !== state.me.id);
    if (!users.length) list.innerHTML += '<div class="empty">No people found.</div>';
    users.forEach(u => {
      const r = el(`<button class="list-item">${avatarImg(u, 's44')}<div class="grow"><div class="uname">${esc(u.full_name || u.username)}</div><div class="sub">${esc(u.username)}</div></div></button>`);
      r.onclick = async () => { try { const id = await api.openDM(u.id); pop(); push(ChatScreen, id); } catch (e) { fail(e); } };
      list.appendChild(r);
    });
  };
  const initial = async () => show(await api.following(state.me.id).catch(() => []), 'Suggested');
  input.oninput = debounce(async () => { const q = input.value.trim(); q ? show(await api.searchUsers(q)) : initial(); }, 250);
  initial();
  setTimeout(() => input.focus(), 250);
  return { el: root };
}

function ChatScreen(convId) {
  const root = el(`<div>
    <div class="topbar"><button class="iconbtn" data-back>${icon('back')}</button>
      <button class="row grow-h" data-prof style="align-items:center;gap:10px;flex:1;min-width:0;text-align:left"><img class="av s32"><div style="min-width:0"><div class="uname c-name"></div><div class="sub c-user"></div></div></button>
      <button class="iconbtn" data-info>${icon('info')}</button></div>
    <div class="scroll"><div class="chat"><div class="spinner"></div></div></div>
    <div class="composer"><button class="iconbtn" data-img style="color:var(--accent)">${icon('camera')}</button>
      <div class="box"><textarea rows="1" placeholder="Message…" maxlength="4000"></textarea><button class="send" disabled>Send</button></div></div></div>`);
  wireBack(root);
  const chat = $('.chat', root), sc = $('.scroll', root), ta = $('textarea', root), send = $('.send', root);
  let conv = null, msgs = [], typingTimer = null, typingShown = false;
  const room = api.joinChat(convId);
  const nearBottom = () => sc.scrollHeight - sc.scrollTop - sc.clientHeight < 120;
  const toBottom = () => requestAnimationFrame(() => { sc.scrollTop = sc.scrollHeight; });

  function bubble(m, showAvatar) {
    const me = m.sender_id === state.me.id;
    let inner;
    if (m.post_id) {
      inner = m.post ? `<div class="bub shared" data-post="${esc(m.post.id)}"><div class="sh">${avatarImg(m.post.author, 's24')}${esc(m.post.author?.username)}</div><img src="${esc(m.post.image_url)}" alt="">${m.post.caption ? `<div class="cap">${esc(m.post.caption)}</div>` : ''}</div>`
        : `<div class="bub"><i>Post unavailable</i></div>`;
    } else if (m.image_url) inner = `<div class="bub img"><img src="${esc(m.image_url)}" alt="" data-full></div>`;
    else inner = '';
    if (m.story_url) inner = `<div class="story-ref">${me ? 'You replied to their story' : 'Replied to your story'}<img src="${esc(m.story_url)}" alt=""></div>` + inner;
    if (m.body) inner += `<div class="bub">${richText(m.body)}</div>`;
    const hearts = m.hearts || [];
    const node = el(`<div class="msg ${me ? 'me' : ''} ${hearts.length ? 'hasheart' : ''}" data-id="${esc(m.id)}">
      ${me ? '' : (showAvatar ? avatarImg(conv.other) : '<img class="av ghost">')}
      <div class="col">${inner}</div>${hearts.length ? `<span class="heart">❤${hearts.length > 1 ? ' ' + hearts.length : ''}</span>` : ''}</div>`);
    // Double-tap likes the message; a single tap opens a shared post or photo.
    doubleTap($('.col', node), () => toggleHeart(m), e => {
      if (e.target.closest('[data-post]')) push(SinglePostScreen, m.post.id);
      else if (e.target.closest('[data-full]')) openImage(m.image_url);
    });
    longPress(node, () => msgMenu(m));
    return node;
  }
  async function toggleHeart(m) {
    const on = !(m.hearts || []).includes(state.me.id);
    m.hearts = on ? [...(m.hearts || []), state.me.id] : m.hearts.filter(x => x !== state.me.id);
    render(false);
    try { await api.toggleHeart(m.id, on, convId); } catch (e) { fail(e); }
  }
  async function msgMenu(m) {
    const opts = [{ label: (m.hearts || []).includes(state.me.id) ? 'Remove like' : 'Like ❤', value: 'h' }];
    if (m.body) opts.push({ label: 'Copy text', value: 'c' });
    if (m.sender_id === state.me.id) opts.push({ label: 'Unsend', value: 'u', danger: true });
    opts.push({ label: 'Cancel', value: null });
    const v = await sheet({ options: opts });
    if (v === 'h') toggleHeart(m);
    if (v === 'c') { try { await navigator.clipboard.writeText(m.body); toast('Copied'); } catch {} }
    if (v === 'u') { try { await api.deleteMessage(m.id); msgs = msgs.filter(x => x.id !== m.id); render(false); } catch (e) { fail(e); } }
  }
  function render(scroll = true) {
    const stick = scroll || nearBottom();
    chat.innerHTML = '';
    if (!msgs.length) chat.appendChild(el(`<div class="empty" style="padding-top:60px">${avatarImg(conv.other, 's86', 'style="margin:0 auto 10px"')}<h3>${esc(conv.other.full_name || conv.other.username)}</h3><p>${esc(conv.other.username)} · Mosaic</p><button class="btn" data-vp>View profile</button></div>`));
    $('[data-vp]', chat)?.addEventListener('click', () => openProfile(conv.other.id));
    let prev = null;
    msgs.forEach((m, i) => {
      if (!prev || new Date(m.created_at) - new Date(prev.created_at) > 3600e3)
        chat.appendChild(el(`<div class="daysep">${dayLabel(m.created_at)} ${clockTime(m.created_at)}</div>`));
      else if (prev.sender_id !== m.sender_id) chat.appendChild(el('<div class="gap"></div>'));
      const nxt = msgs[i + 1];
      const lastOfRun = !nxt || nxt.sender_id !== m.sender_id || new Date(nxt.created_at) - new Date(m.created_at) > 3600e3;
      chat.appendChild(bubble(m, lastOfRun));
      prev = m;
    });
    const last = msgs.at(-1);
    if (last && last.sender_id === state.me.id && conv.other_last_read >= last.created_at)
      chat.appendChild(el(`<div class="seen">Seen</div>`));
    if (typingShown) chat.appendChild(el(`<div class="msg">${avatarImg(conv.other)}<div class="bub typing"><i></i><i></i><i></i></div></div>`));
    if (stick) toBottom();
  }
  async function load() {
    try {
      [conv, msgs] = await Promise.all([api.conversation(convId), api.messages(convId)]);
      if (!conv) { chat.innerHTML = '<div class="empty">Conversation not found.</div>'; return; }
      $('.topbar img', root).src = avatarSrc(conv.other);
      $('.c-name', root).textContent = conv.other.full_name || conv.other.username;
      $('.c-user', root).textContent = conv.other.username;
      render();
      await api.markRead(convId); refreshBadges();
    } catch (e) { fail(e); }
  }
  const offs = [
    api.on('message', m => {
      if (m.conversation_id !== convId || !conv) return;
      if (msgs.some(x => x.id === m.id)) return;
      msgs.push(m);
      if (m.sender_id !== state.me.id) { typingShown = false; api.markRead(convId).then(refreshBadges); }
      render(m.sender_id === state.me.id);
    }),
    api.on('message_delete', d => { if (msgs.some(x => x.id === d.id)) { msgs = msgs.filter(x => x.id !== d.id); render(false); } }),
    api.on('reaction', r => {
      const m = msgs.find(x => x.id === r.message_id); if (!m) return;
      m.hearts = (m.hearts || []).filter(u => u !== r.user_id); if (r.on) m.hearts.push(r.user_id);
      render(false);
    }),
    api.on('read', r => { if (r.conversation_id === convId && conv && r.user_id === conv.other.id) { conv.other_last_read = r.at; render(false); } }),
    api.on('typing', t => {
      if (t.conversation_id !== convId || t.user_id === state.me.id) return;
      typingShown = true; render(false);
      clearTimeout(typingTimer); typingTimer = setTimeout(() => { typingShown = false; render(false); }, 4000);
    }),
  ];
  ta.oninput = () => { autoGrow(ta); send.disabled = !ta.value.trim(); if (ta.value) room.typing(); };
  ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); doSend(); } };
  async function doSend() {
    const body = ta.value.trim(); if (!body) return;
    ta.value = ''; autoGrow(ta); send.disabled = true;
    try { await api.sendMessage(convId, { body }); } catch (e) { fail(e); ta.value = body; send.disabled = false; }
  }
  send.onclick = doSend;
  $('[data-img]', root).onclick = async () => {
    const v = await sheet({ options: [{ label: 'Photo from gallery', value: 'g' }, { label: 'Take photo', value: 'c' }, { label: 'Cancel', value: null }] });
    if (!v) return;
    const f = await pickImage(v === 'c'); if (!f) return;
    toast('Sending photo…', 8000);
    try { const url = await processUpload(f, { max: 1280 }); await api.sendMessage(convId, { image_url: url }); $$('.toast', ROOT).forEach(t => t.remove()); }
    catch (e) { fail(e); }
  };
  $('[data-prof]', root).onclick = () => conv && openProfile(conv.other.id);
  $('[data-info]', root).onclick = () => conv && openProfile(conv.other.id);
  load();
  return { el: root, onDestroy: () => { offs.forEach(f => f()); room.leave(); clearTimeout(typingTimer); } };
}

boot();
