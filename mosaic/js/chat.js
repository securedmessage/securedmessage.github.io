// Mosaic — messages: inbox, one-to-one and group chats, voice messages, reactions, replies.  (c) RM Software
'use strict';

const QUICK_REACTIONS = ['❤️', '😂', '😮', '😢', '😡', '👍'];

function convTitle(c) {
  if (!c) return '';
  if (!c.is_group) return c.other ? (c.other.full_name || c.other.username) : 'Mosaic user';
  return c.title || c.others.map(o => o.username).slice(0, 3).join(', ') + (c.others.length > 3 ? ` +${c.others.length - 3}` : '') || 'Group';
}
function convAvatar(c, size = 's56') {
  if (!c.is_group) return `<span class="avwrap">${avatarImg(c.other, size)}${isActiveNow(c.other) ? '<i class="online"></i>' : ''}</span>`;
  const [a, b] = c.others;
  return `<span class="avgroup ${size}">${avatarImg(a || state.me, 'g1')}${avatarImg(b || state.me, 'g2')}</span>`;
}

// ---------- Inbox ----------
function InboxScreen() {
  const root = el(`<div>${topbar(esc(state.me.username), { right: `<button class="iconbtn" data-new aria-label="New message">${icon('newmsg')}</button>` })}
    <div class="searchbar">${icon('search')}<input placeholder="Search"></div>
    <div class="scroll"><div class="active-row hidden"></div><div class="list"><div class="spinner"></div></div></div></div>`);
  wireBack(root);
  const list = $('.list', root), input = $('input', root), activeRow = $('.active-row', root);
  let convs = [];
  const paint = () => {
    const q = input.value.trim().toLowerCase();
    const items = convs.filter(c => !q || convTitle(c).toLowerCase().includes(q) || c.others.some(o => o.username.includes(q)));
    const active = convs.filter(c => !c.is_group && isActiveNow(c.other));
    activeRow.classList.toggle('hidden', !!q || !active.length);
    activeRow.innerHTML = '';
    active.forEach(c => {
      const b = el(`<button class="story">${convAvatar(c, 's56')}<span>${esc(c.other.username)}</span></button>`);
      b.onclick = () => push(ChatScreen, c.id);
      activeRow.appendChild(b);
    });
    list.innerHTML = '';
    if (!items.length) {
      list.appendChild(el(`<div class="empty">${icon('messenger')}<h3>${q ? 'No matches' : 'Your messages'}</h3><p>${q ? '' : 'Send private photos, voice messages and texts to a friend or a group.'}</p>${q ? '' : '<button class="btn primary" data-start>Send message</button>'}</div>`));
      $('[data-start]', list)?.addEventListener('click', () => push(NewMessageScreen));
    }
    items.forEach(c => {
      const mine = c.last_sender_id === state.me.id;
      const seen = mine && !c.is_group && c.other_last_read >= c.updated_at;
      const status = !c.unread && !c.is_group ? activeLabel(c.other) : '';
      const r = el(`<button class="list-item ${c.unread ? 'unread' : ''}">${convAvatar(c, 's56')}
        <div class="grow"><div class="uname" style="font-weight:${c.unread ? 700 : 500}">${esc(convTitle(c))}</div>
        <div class="sub">${status && !mine ? esc(status) : `${mine ? (seen ? 'Seen · ' : 'You: ') : ''}${esc(c.last_message)} · ${timeAgo(c.updated_at)}`}</div></div>
        ${c.unread ? '<span class="udot"></span>' : ''}</button>`);
      r.onclick = () => push(ChatScreen, c.id);
      list.appendChild(r);
    });
  };
  async function load() { try { convs = await api.conversations(); paint(); } catch (e) { fail(e); } }
  input.oninput = paint;
  $('[data-new]', root).onclick = () => push(NewMessageScreen);
  const offs = ['message', 'read', 'message_delete', 'conversation'].map(ev => api.on(ev, debounce(load, 300)));
  const tick = setInterval(load, 60000);
  return { el: root, onShow: () => { load(); refreshBadges(); }, onDestroy: () => { offs.forEach(f => f()); clearInterval(tick); } };
}

// Pick one person for a chat, or several for a group.
function NewMessageScreen() {
  let chosen = [];
  const root = el(`<div>${topbar('New message', { right: '<button class="linkbtn" data-go style="padding:0 12px" disabled>Chat</button>' })}
    <div class="chips sel" style="padding:8px 14px 0"></div>
    <div class="searchbar">${icon('search')}<input placeholder="Search people" autocapitalize="none"></div>
    <div class="scroll"><div class="list"></div></div></div>`);
  wireBack(root);
  const list = $('.list', root), input = $('input', root), go = $('[data-go]', root);
  let last = [];
  const paintSel = () => {
    const s = $('.sel', root); s.innerHTML = '';
    chosen.forEach(u => { const c = el(`<button class="chip">${esc(u.username)} ✕</button>`); c.onclick = () => { chosen = chosen.filter(x => x.id !== u.id); paintSel(); show(last); }; s.appendChild(c); });
    go.disabled = !chosen.length;
    go.textContent = chosen.length > 1 ? 'Create group' : 'Chat';
  };
  const show = (users, label) => {
    last = users;
    list.innerHTML = label ? `<div class="section-h">${label}</div>` : '';
    users = users.filter(u => u && u.id !== state.me.id);
    if (!users.length) list.innerHTML += '<div class="empty">No people found.</div>';
    users.forEach(u => {
      const on = chosen.some(c => c.id === u.id);
      const r = el(`<button class="list-item"><span class="avwrap">${avatarImg(u, 's44')}${isActiveNow(u) ? '<i class="online"></i>' : ''}</span><div class="grow"><div class="uname">${esc(u.full_name || u.username)}</div><div class="sub">${esc(u.username)}</div></div><span class="check ${on ? 'on' : ''}">${on ? icon('check') : ''}</span></button>`);
      r.onclick = () => { chosen = on ? chosen.filter(c => c.id !== u.id) : [...chosen, u]; paintSel(); show(last, label); };
      list.appendChild(r);
    });
  };
  const initial = async () => show(await api.following(state.me.id).catch(() => []), 'Suggested');
  input.oninput = debounce(async () => { const q = input.value.trim(); q ? show(await api.searchUsers(q)) : initial(); }, 250);
  go.onclick = async () => {
    try {
      if (chosen.length === 1) { const id = await api.openDM(chosen[0].id); pop(); push(ChatScreen, id); return; }
      const content = el(`<div style="padding:12px 16px 4px"><label class="lbl" for="g-name" style="margin-top:0">Group name (optional)</label>
        <input class="field" id="g-name" maxlength="60" placeholder="${esc(chosen.map(u => u.username).slice(0, 3).join(', '))}">
        <div class="row" style="margin-top:12px"><button class="btn block" data-cancel>Cancel</button><button class="btn primary block" data-make>Create</button></div></div>`);
      const s = sheet({ title: 'New group', content });
      $('[data-cancel]', content).onclick = () => s.close(null);
      $('[data-make]', content).onclick = async () => {
        try { const id = await api.createGroup($('#g-name', content).value.trim(), chosen.map(u => u.id)); s.close(null); pop(); push(ChatScreen, id); }
        catch (e) { fail(e); }
      };
      setTimeout(() => $('#g-name', content).focus(), 250);
    } catch (e) { fail(e); }
  };
  initial();
  setTimeout(() => input.focus(), 250);
  return { el: root };
}

// ---------- Voice recording ----------
function pickAudioType() {
  if (!window.MediaRecorder) return null;
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/aac'].find(t => MediaRecorder.isTypeSupported?.(t)) || '';
}
async function startRecording() {
  const type = pickAudioType();
  if (type === null || !navigator.mediaDevices?.getUserMedia) throw new Error("Voice messages aren't supported on this device.");
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { throw new Error('Mosaic needs microphone access to record. Allow it in your phone settings and try again.'); }
  const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const started = Date.now();
  rec.start(250);
  return {
    started,
    stop: () => new Promise(resolve => {
      rec.onstop = () => { stream.getTracks().forEach(t => t.stop()); const blob = new Blob(chunks, { type: rec.mimeType || type || 'audio/webm' }); resolve({ blob, duration: (Date.now() - started) / 1000 }); };
      rec.stop();
    }),
    cancel: () => { rec.onstop = () => stream.getTracks().forEach(t => t.stop()); if (rec.state !== 'inactive') rec.stop(); },
  };
}
let currentAudio = null;
function AudioBubble(m, me) {
  const n = el(`<div class="bub audio"><button class="playbtn" aria-label="Play voice message">${icon('play')}</button><div class="abar"><i></i></div><span class="adur">${fmtDuration(m.audio_duration)}</span></div>`);
  const audio = new Audio(); audio.preload = 'none'; audio.src = m.audio_url;
  const btn = $('.playbtn', n), bar = $('.abar i', n), dur = $('.adur', n);
  btn.onclick = e => {
    e.stopPropagation();
    if (audio.paused) { if (currentAudio && currentAudio !== audio) currentAudio.pause(); currentAudio = audio; audio.play().catch(() => toast("This voice message couldn't be played")); }
    else audio.pause();
  };
  audio.onplay = () => btn.innerHTML = icon('pause');
  audio.onpause = audio.onended = () => { btn.innerHTML = icon('play'); if (audio.ended) { bar.style.width = '0'; dur.textContent = fmtDuration(m.audio_duration); } };
  audio.ontimeupdate = () => {
    const total = isFinite(audio.duration) ? audio.duration : (m.audio_duration || 1);
    bar.style.width = Math.min(100, audio.currentTime / total * 100) + '%';
    dur.textContent = fmtDuration(Math.max(0, total - audio.currentTime));
  };
  n._audio = audio;
  return n;
}

// ---------- Chat ----------
function ChatScreen(convId) {
  const root = el(`<div>
    <div class="topbar"><button class="iconbtn" data-back aria-label="Back">${icon('back')}</button>
      <button class="row" data-info style="align-items:center;gap:10px;flex:1;min-width:0;text-align:left"><span class="c-av"></span><div style="min-width:0"><div class="uname c-name"></div><div class="sub c-sub"></div></div></button>
      <button class="iconbtn" data-info2 aria-label="Chat details">${icon('info')}</button></div>
    <div class="chat-banner hidden"></div>
    <div class="scroll"><div class="chat"><div class="spinner"></div></div></div>
    <div class="replybar hidden"><div class="grow"><div class="rb-who"></div><div class="rb-text"></div></div><button class="iconbtn" data-x aria-label="Cancel reply">${icon('close')}</button></div>
    <div class="composer">
      <button class="iconbtn" data-img aria-label="Send a photo" style="color:var(--accent)">${icon('camera')}</button>
      <div class="box"><textarea rows="1" placeholder="Message…" maxlength="4000"></textarea><button class="send hidden" aria-label="Send">Send</button><button class="iconbtn mic" data-mic aria-label="Record voice message">${icon('mic')}</button></div>
    </div>
    <div class="recbar hidden"><button class="iconbtn" data-cancel aria-label="Discard recording">${icon('trash')}</button><span class="recdot"></span><span class="rectime">0:00</span><span class="grow sub">Recording…</span><button class="btn primary" data-sendrec>Send</button></div>
  </div>`);
  wireBack(root);
  const chat = $('.chat', root), sc = $('.scroll', root), ta = $('textarea', root), send = $('.send', root), mic = $('[data-mic]', root);
  let conv = null, msgs = [], typingFrom = null, typingTimer = null, replyTo = null, rel = null, recorder = null, recTimer = null;
  const room = api.joinChat(convId);
  const nearBottom = () => sc.scrollHeight - sc.scrollTop - sc.clientHeight < 140;
  const toBottom = () => requestAnimationFrame(() => { sc.scrollTop = sc.scrollHeight; });
  const person = id => conv?.members.find(m => m.id === id) || (id === state.me.id ? state.me : null);
  const snippet = m => m ? (m.body || (m.audio_url ? 'Voice message' : m.post_id ? 'Shared post' : m.image_url ? 'Photo' : m.story_url ? 'Story reply' : '')) : '';

  function paintHeader() {
    $('.c-av', root).innerHTML = convAvatar(conv, 's32');
    $('.c-name', root).textContent = convTitle(conv);
    $('.c-sub', root).textContent = conv.is_group ? `${conv.members.length} members` : (activeLabel(conv.other) || conv.other?.username || '');
    const banner = $('.chat-banner', root);
    const blocked = !conv.is_group && (rel?.blocked || !conv.other);
    banner.classList.toggle('hidden', !blocked);
    if (blocked) {
      banner.innerHTML = rel?.blocked ? `You blocked this account. <button class="linkbtn" data-unblock>Unblock</button>` : `You can't message this account.`;
      $('[data-unblock]', banner)?.addEventListener('click', async () => { try { await api.unblock(conv.other.id); rel.blocked = false; paintHeader(); } catch (e) { fail(e); } });
    }
    $('.composer', root).classList.toggle('hidden', blocked);
  }

  function reactionsChip(m) {
    const rs = m.reactions || [];
    if (!rs.length) return '';
    const counts = {};
    rs.forEach(r => counts[r.emoji] = (counts[r.emoji] || 0) + 1);
    const em = Object.keys(counts).slice(0, 3).join('');
    return `<button class="reacts" data-reacts>${em}${rs.length > 1 ? `<b>${rs.length}</b>` : ''}</button>`;
  }
  function bubble(m, { showAvatar, showName }) {
    if (m.system) {
      const who = m.sender_id === state.me.id ? 'You' : (person(m.sender_id)?.username || 'Someone');
      return el(`<div class="sysmsg">${esc(who)} ${esc(m.body)}</div>`);
    }
    const me = m.sender_id === state.me.id;
    const author = person(m.sender_id);
    let inner = '';
    if (m.reply_to) {
      const orig = msgs.find(x => x.id === m.reply_to);
      const whoName = orig ? (orig.sender_id === state.me.id ? 'you' : person(orig.sender_id)?.username || 'someone') : '';
      inner += `<div class="quote" data-jump="${esc(m.reply_to)}"><span>${me ? 'You' : esc(author?.username || '')} replied${orig ? ` to ${esc(whoName)}` : ''}</span><div>${orig ? esc(snippet(orig)).slice(0, 120) : 'Original message unavailable'}</div></div>`;
    }
    if (m.story_url) inner += `<div class="story-ref">${me ? 'You replied to their story' : 'Replied to your story'}<img src="${esc(m.story_url)}" alt=""></div>`;
    if (m.post_id) {
      inner += m.post ? `<div class="bub shared" data-post="${esc(m.post.id)}"><div class="sh">${avatarImg(m.post.author, 's24')}${esc(m.post.author?.username)}</div><img src="${esc(m.post.image_url)}" alt="">${m.post.caption ? `<div class="cap">${esc(m.post.caption)}</div>` : ''}</div>`
        : `<div class="bub"><i>Post unavailable</i></div>`;
    }
    if (m.image_url) inner += `<div class="bub img"><img src="${esc(m.image_url)}" alt="" data-full></div>`;
    const node = el(`<div class="msg ${me ? 'me' : ''} ${m.reactions?.length ? 'hasheart' : ''}" data-id="${esc(m.id)}">
      ${me ? '' : (showAvatar ? `<button data-who class="avbtn">${avatarImg(author)}</button>` : '<img class="av ghost" alt="">')}
      <div class="col">${showName && !me ? `<div class="sender">${esc(author?.username || '')}</div>` : ''}${inner}</div>${reactionsChip(m)}</div>`);
    const col = $('.col', node);
    if (m.audio_url) col.appendChild(AudioBubble(m, me));
    if (m.body) col.appendChild(el(`<div class="bub">${richText(m.body)}</div>`));
    wireMentions(node);
    $('[data-who]', node)?.addEventListener('click', () => openProfile(m.sender_id));
    $('[data-reacts]', node)?.addEventListener('click', e => { e.stopPropagation(); showReactions(m); });
    doubleTap(col, () => react(m, '❤️', true), e => {
      const j = e.target.closest('[data-jump]');
      if (j) { const t = $(`.msg[data-id="${CSS.escape(j.dataset.jump)}"]`, chat); if (t) { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); t.classList.add('flash'); setTimeout(() => t.classList.remove('flash'), 1200); } }
      else if (e.target.closest('[data-post]')) push(SinglePostScreen, m.post.id);
      else if (e.target.closest('[data-full]')) openImage(m.image_url);
    });
    longPress(node, () => msgMenu(m));
    swipeToReply(node, () => setReply(m));
    return node;
  }
  function swipeToReply(node, fn) {
    let sx = 0, sy = 0, dx = 0, active = false;
    node.addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; dx = 0; active = true; }, { passive: true });
    node.addEventListener('touchmove', e => {
      if (!active) return;
      dx = e.touches[0].clientX - sx;
      if (Math.abs(e.touches[0].clientY - sy) > 30) { active = false; node.style.transform = ''; return; }
      if (dx > 0) node.style.transform = `translateX(${Math.min(dx, 80)}px)`;
    }, { passive: true });
    node.addEventListener('touchend', () => { if (active && dx > 60) { navigator.vibrate?.(10); fn(); } node.style.transform = ''; active = false; });
  }
  function setReply(m) {
    replyTo = m;
    const bar = $('.replybar', root);
    bar.classList.toggle('hidden', !m);
    if (m) {
      $('.rb-who', bar).textContent = `Replying to ${m.sender_id === state.me.id ? 'yourself' : person(m.sender_id)?.username || ''}`;
      $('.rb-text', bar).textContent = snippet(m);
      ta.focus();
    }
  }
  $('.replybar [data-x]', root).onclick = () => setReply(null);

  async function react(m, emoji, toggle = false) {
    const mine = (m.reactions || []).find(r => r.user_id === state.me.id);
    const next = toggle && mine?.emoji === emoji ? null : (mine?.emoji === emoji && !toggle ? null : emoji);
    m.reactions = (m.reactions || []).filter(r => r.user_id !== state.me.id);
    if (next) m.reactions.push({ user_id: state.me.id, emoji: next });
    render(false);
    try { await api.react(m.id, next, convId); } catch (e) { fail(e); }
  }
  function showReactions(m) {
    const content = el(`<div class="list"></div>`);
    (m.reactions || []).forEach(r => {
      const u = person(r.user_id) || { username: 'Someone' };
      const row = el(`<div class="list-item">${avatarImg(u, 's44')}<div class="grow"><div class="uname">${esc(r.user_id === state.me.id ? 'You' : u.username)}</div>${r.user_id === state.me.id ? '<div class="sub">Tap to remove</div>' : ''}</div><span style="font-size:24px">${r.emoji}</span></div>`);
      if (r.user_id === state.me.id) row.onclick = () => { s.close(null); react(m, null); };
      content.appendChild(row);
    });
    const s = sheet({ title: 'Reactions', content });
  }
  async function msgMenu(m) {
    if (m.system) return;
    const content = el(`<div><div class="reactbar">${QUICK_REACTIONS.map(e => `<button>${e}</button>`).join('')}</div></div>`);
    const s = sheet({ content, options: [
      { label: 'Reply', value: 'reply' },
      ...(m.body ? [{ label: 'Copy text', value: 'copy' }] : []),
      ...(m.sender_id === state.me.id ? [{ label: 'Unsend', value: 'unsend', danger: true }] : [{ label: 'Report', value: 'report', danger: true }]),
      { label: 'Cancel', value: null }] });
    const mine = (m.reactions || []).find(r => r.user_id === state.me.id);
    $$('.reactbar button', content).forEach(b => {
      if (mine?.emoji === b.textContent) b.classList.add('on');
      b.onclick = () => { s.close(null); react(m, b.textContent); };
    });
    const v = await s;
    if (v === 'reply') setReply(m);
    if (v === 'copy') { try { await navigator.clipboard.writeText(m.body); toast('Copied'); } catch {} }
    if (v === 'report') reportFlow('message', m.id);
    if (v === 'unsend') { try { await api.deleteMessage(m.id, convId); msgs = msgs.filter(x => x.id !== m.id); render(false); } catch (e) { fail(e); } }
  }

  function render(scroll = true) {
    const stick = scroll || nearBottom();
    chat.innerHTML = '';
    if (!msgs.filter(m => !m.system).length && !conv.is_group && conv.other) {
      chat.appendChild(el(`<div class="empty" style="padding-top:50px">${avatarImg(conv.other, 's86', 'style="margin:0 auto 10px"')}<h3>${esc(conv.other.full_name || conv.other.username)}</h3><p>${esc(conv.other.username)} · Mosaic</p><button class="btn" data-vp>View profile</button></div>`));
      $('[data-vp]', chat)?.addEventListener('click', () => openProfile(conv.other.id));
    }
    let prev = null;
    msgs.forEach((m, i) => {
      if (!prev || new Date(m.created_at) - new Date(prev.created_at) > 3600e3)
        chat.appendChild(el(`<div class="daysep">${dayLabel(m.created_at)} ${clockTime(m.created_at)}</div>`));
      else if (prev.sender_id !== m.sender_id || prev.system) chat.appendChild(el('<div class="gap"></div>'));
      const nxt = msgs[i + 1];
      const lastOfRun = !nxt || nxt.system || nxt.sender_id !== m.sender_id || new Date(nxt.created_at) - new Date(m.created_at) > 3600e3;
      const firstOfRun = !prev || prev.system || prev.sender_id !== m.sender_id || new Date(m.created_at) - new Date(prev.created_at) > 3600e3;
      chat.appendChild(bubble(m, { showAvatar: lastOfRun, showName: conv.is_group && firstOfRun }));
      prev = m;
    });
    const last = [...msgs].reverse().find(m => !m.system);
    if (last && last.sender_id === state.me.id) {
      if (!conv.is_group && conv.other_last_read >= last.created_at) chat.appendChild(el(`<div class="seen">Seen</div>`));
      if (conv.is_group) {
        const seenBy = conv.others.filter(o => o.last_read_at >= last.created_at);
        if (seenBy.length) chat.appendChild(el(`<div class="seen">${seenBy.length === conv.others.length ? 'Seen by everyone' : 'Seen by ' + esc(seenBy.map(o => o.username).slice(0, 3).join(', ')) + (seenBy.length > 3 ? ` +${seenBy.length - 3}` : '')}</div>`));
      }
    }
    if (typingFrom) chat.appendChild(el(`<div class="msg">${avatarImg(person(typingFrom))}<div class="bub typing"><i></i><i></i><i></i></div></div>`));
    if (stick) toBottom();
  }
  async function load() {
    try {
      [conv, msgs] = await Promise.all([api.conversation(convId), api.messages(convId)]);
      if (!conv) { chat.innerHTML = '<div class="empty">This conversation isn\'t available.</div>'; $('.composer', root).classList.add('hidden'); return; }
      if (!conv.is_group && conv.other) rel = await api.relationship(conv.other.id).catch(() => null);
      paintHeader();
      render();
      await api.markRead(convId); refreshBadges();
    } catch (e) { fail(e); }
  }
  async function refreshConv() {
    try { const c = await api.conversation(convId); if (c) { conv = c; paintHeader(); render(false); } } catch {}
  }
  const offs = [
    api.on('message', m => {
      if (m.conversation_id !== convId || !conv) return;
      if (msgs.some(x => x.id === m.id)) return;
      msgs.push(m);
      if (m.system) refreshConv();
      if (m.sender_id !== state.me.id) { if (typingFrom === m.sender_id) typingFrom = null; api.markRead(convId).then(refreshBadges); }
      render(m.sender_id === state.me.id);
    }),
    api.on('message_delete', d => { if (msgs.some(x => x.id === d.id)) { msgs = msgs.filter(x => x.id !== d.id); render(false); } }),
    api.on('reaction', r => {
      const m = msgs.find(x => x.id === r.message_id); if (!m) return;
      m.reactions = (m.reactions || []).filter(x => x.user_id !== r.user_id);
      if (r.emoji) m.reactions.push({ user_id: r.user_id, emoji: r.emoji });
      render(false);
    }),
    api.on('read', r => {
      if (r.conversation_id !== convId || !conv) return;
      const o = conv.others.find(x => x.id === r.user_id); if (o) o.last_read_at = r.at;
      if (!conv.is_group && conv.other?.id === r.user_id) conv.other_last_read = r.at;
      render(false);
    }),
    api.on('conversation', c => { if (c.id === convId) refreshConv(); }),
    api.on('typing', t => {
      if (t.conversation_id !== convId || t.user_id === state.me.id) return;
      typingFrom = t.user_id; render(false);
      clearTimeout(typingTimer); typingTimer = setTimeout(() => { typingFrom = null; render(false); }, 4000);
    }),
  ];
  const presenceTick = setInterval(refreshConv, 60000);

  const syncComposer = () => { const has = !!ta.value.trim(); send.classList.toggle('hidden', !has); mic.classList.toggle('hidden', has); };
  ta.oninput = () => { autoGrow(ta); syncComposer(); if (ta.value) room.typing(); };
  ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); doSend(); } };
  async function sendFields(f) {
    if (replyTo) f.reply_to = replyTo.id;
    setReply(null);
    return api.sendMessage(convId, f);
  }
  async function doSend() {
    const body = ta.value.trim(); if (!body) return;
    const keepReply = replyTo;
    ta.value = ''; autoGrow(ta); syncComposer();
    try { await sendFields({ body }); } catch (e) { fail(e); ta.value = body; syncComposer(); setReply(keepReply); }
  }
  send.onclick = doSend;
  $('[data-img]', root).onclick = async () => {
    const v = await sheet({ options: [{ label: 'Photo from gallery', value: 'g' }, { label: 'Take photo', value: 'c' }, { label: 'Cancel', value: null }] });
    if (!v) return;
    const f = await pickImage(v === 'c'); if (!f) return;
    toast('Sending photo…', 8000);
    try { const url = await processUpload(f, { max: 1280 }); await sendFields({ image_url: url }); $$('.toast', ROOT).forEach(t => t.remove()); }
    catch (e) { fail(e); }
  };
  // Voice messages: tap the mic to record, then send or discard.
  const recbar = $('.recbar', root), composer = $('.composer', root);
  function stopUI() { clearInterval(recTimer); recbar.classList.add('hidden'); composer.classList.remove('hidden'); recorder = null; }
  mic.onclick = async () => {
    try {
      recorder = await startRecording();
      composer.classList.add('hidden'); recbar.classList.remove('hidden');
      recTimer = setInterval(() => {
        const s = (Date.now() - recorder.started) / 1000;
        $('.rectime', recbar).textContent = fmtDuration(s);
        if (s >= 120) $('[data-sendrec]', recbar).click();
      }, 250);
    } catch (e) { fail(e); }
  };
  $('[data-cancel]', recbar).onclick = () => { recorder?.cancel(); stopUI(); };
  $('[data-sendrec]', recbar).onclick = async () => {
    if (!recorder) return;
    const r = recorder; stopUI();
    const { blob, duration } = await r.stop();
    if (duration < 0.8) { toast('Hold on a little longer to record a voice message'); return; }
    toast('Sending voice message…', 10000);
    try {
      const type = (blob.type || 'audio/webm').split(';')[0];
      const url = await api.uploadFile(blob, extFromType(type, 'webm'), type);
      await sendFields({ audio_url: url, audio_duration: Math.round(duration * 10) / 10 });
      $$('.toast', ROOT).forEach(t => t.remove());
    } catch (e) { fail(e); }
  };
  const openInfo = () => conv && push(ChatInfoScreen, convId, () => load());
  $('[data-info]', root).onclick = openInfo;
  $('[data-info2]', root).onclick = openInfo;
  load();
  return {
    el: root,
    onShow: () => { if (conv) refreshConv(); },
    onDestroy: () => { offs.forEach(f => f()); room.leave(); clearTimeout(typingTimer); clearInterval(presenceTick); recorder?.cancel(); currentAudio?.pause(); },
  };
}

// ---------- Chat details ----------
function ChatInfoScreen(convId, onChange) {
  const root = el(`<div>${topbar('Details')}<div class="scroll"><div class="spinner"></div></div></div>`);
  wireBack(root);
  const sc = $('.scroll', root);
  async function load() {
    const c = await api.conversation(convId).catch(fail);
    if (!c) { sc.innerHTML = '<div class="empty">This conversation isn\'t available.</div>'; return; }
    sc.innerHTML = '';
    if (c.is_group) {
      const head = el(`<div class="form" style="padding-top:16px">
        <div style="text-align:center">${convAvatar(c, 's86')}</div>
        <label class="lbl" for="gi-name">Group name</label>
        <div class="row"><input class="field" id="gi-name" maxlength="60" placeholder="Name this group" value="${esc(c.title)}"><button class="btn primary" data-rename>Save</button></div></div>`);
      $('[data-rename]', head).onclick = async () => {
        try { await api.renameGroup(convId, $('#gi-name', head).value.trim()); toast('Group name updated'); onChange?.(); } catch (e) { fail(e); }
      };
      sc.appendChild(head);
      sc.appendChild(el(`<div class="section-h">${c.members.length} members</div>`));
      const add = el(`<button class="list-item"><span class="addcircle">${icon('plus')}</span><div class="grow"><div class="uname">Add people</div></div></button>`);
      add.onclick = async () => {
        const picked = await pickPeople('Add people', [], { doneLabel: 'Add' });
        const fresh = picked.filter(p => !c.members.some(m => m.id === p.id));
        if (!fresh.length) return;
        try { await api.addMembers(convId, fresh.map(p => p.id)); toast('Added'); onChange?.(); load(); } catch (e) { fail(e); }
      };
      sc.appendChild(add);
      c.members.forEach(m => {
        const r = el(`<button class="list-item"><span class="avwrap">${avatarImg(m, 's44')}${m.id !== state.me.id && isActiveNow(m) ? '<i class="online"></i>' : ''}</span><div class="grow"><div class="uname">${esc(m.id === state.me.id ? 'You' : m.username)}</div><div class="sub">${esc(m.id === c.created_by ? 'Created the group' : (m.id !== state.me.id ? activeLabel(m) || m.full_name : m.full_name))}</div></div></button>`);
        r.onclick = () => openProfile(m.id);
        sc.appendChild(r);
      });
      const leave = el(`<button class="set-row" style="color:var(--like);margin-top:12px">${icon('logout')}Leave group</button>`);
      leave.onclick = async () => {
        if (!(await confirmDialog("Leave this group? You won't get its messages anymore.", 'Leave'))) return;
        try { await api.leaveGroup(convId); toast('You left the group'); while (stack.length > 1) pop(); push(InboxScreen); } catch (e) { fail(e); }
      };
      sc.appendChild(leave);
    } else if (c.other) {
      const rel = await api.relationship(c.other.id).catch(() => ({}));
      const u = c.other;
      sc.appendChild(el(`<div style="text-align:center;padding:20px">${avatarImg(u, 's86', 'style="margin:0 auto 8px"')}<h3 style="margin:4px 0">${esc(u.full_name || u.username)}</h3><div class="sub">${esc(u.username)}${activeLabel(u) ? ' · ' + esc(activeLabel(u)) : ''}</div></div>`));
      const rows = [
        [icon('user'), 'View profile', () => openProfile(u.id)],
        [icon('group'), 'Create a group with ' + u.username, async () => {
          const picked = await pickPeople('Add people', [u], { doneLabel: 'Create group' });
          if (picked.length < 2) { toast('Pick at least one more person for a group'); return; }
          try { const id = await api.createGroup('', picked.map(p => p.id)); push(ChatScreen, id); } catch (e) { fail(e); }
        }],
        rel.blocked ? [icon('block'), 'Unblock', async () => { try { await api.unblock(u.id); toast(`Unblocked ${u.username}`); onChange?.(); load(); } catch (e) { fail(e); } }]
          : [icon('block'), 'Block', async () => { if (await blockFlow(u)) { onChange?.(); load(); } }, true],
        [icon('flag'), 'Report', () => reportFlow('user', u.id), true],
      ];
      rows.forEach(([ic, label, fn, danger]) => { const b = el(`<button class="set-row" ${danger ? 'style="color:var(--like)"' : ''}>${ic}${esc(label)}</button>`); b.onclick = fn; sc.appendChild(b); });
    }
  }
  load();
  return { el: root };
}
