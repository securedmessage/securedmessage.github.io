// Mosaic — home feed, posts, comments, search, hashtags, reels and activity.  (c) RM Software
'use strict';

// ---------- Video playback: play what's on screen, pause the rest ----------
state.muted = true;
const videoObserver = new IntersectionObserver(entries => {
  entries.forEach(e => {
    const v = e.target;
    if (e.isIntersecting && e.intersectionRatio >= 0.6 && !v.closest('.hidden')) { v.muted = state.muted; v.play().catch(() => {}); }
    else v.pause();
  });
}, { threshold: [0, 0.6, 1] });
function pauseAllVideos(root = document) { $$('video', root).forEach(v => v.pause()); }

// ---------- Home ----------
function HomeTab() {
  const root = el(`<div style="flex:1;display:flex;flex-direction:column;min-height:0">
    <div class="topbar"><h1 class="logo">Mosaic</h1>
      <button class="iconbtn" data-act="activity" aria-label="Notifications">${icon('heart')}<span class="dot hidden" data-badge="notifs"></span></button>
      <button class="iconbtn" data-act="dm" aria-label="Messages">${icon('messenger')}<span class="badge hidden" data-badge="chats"></span></button>
    </div>
    <div class="scroll"><div class="pull hidden" style="height:0;overflow:hidden"></div><div class="stories"></div><div class="feed"><div class="spinner"></div></div></div></div>`);
  const scroller = $('.scroll', root);
  $('[data-act="dm"]', root).onclick = () => push(InboxScreen);
  $('[data-act="activity"]', root).onclick = () => push(ActivityScreen);
  let loaded = 0;
  async function load() {
    try {
      const [stories, posts] = await Promise.all([api.stories(), api.feed()]);
      state.storyGroups = stories;
      renderStories();
      const feed = $('.feed', root);
      feed.innerHTML = '';
      if (!posts.length) {
        feed.appendChild(el(`<div class="empty">${icon('camera')}<h3>Welcome to Mosaic</h3><p>Follow people to see their photos and videos here, or share your first post.</p><button class="btn primary" data-go>Find people</button></div>`));
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
    onHide: () => pauseAllVideos(root),
    onReselect: () => { if (scroller.scrollTop > 0) scroller.scrollTo({ top: 0, behavior: 'smooth' }); else load(); },
    reload: load,
  };
}

function seenStories() { try { return new Set(JSON.parse(store.getItem('mosaic_seen_stories') || '[]')); } catch { return new Set(); } }
function markStorySeen(id) { const s = seenStories(); s.add(id); store.setItem('mosaic_seen_stories', JSON.stringify([...s].slice(-500))); }

// ---------- Media carousel (photos and videos) ----------
function MediaView(p, { onDouble } = {}) {
  const media = p.media?.length ? p.media : [{ type: 'image', url: p.image_url }];
  const multi = media.length > 1;
  const node = el(`<div class="media">
    <div class="track">${media.map((m, i) => m.type === 'video'
      ? `<div class="slide"><video src="${esc(m.url)}" poster="${esc(m.poster || '')}" playsinline loop muted preload="metadata"></video></div>`
      : `<div class="slide"><img src="${esc(m.url)}" alt="" loading="lazy"></div>`).join('')}</div>
    ${multi ? `<span class="counter">1/${media.length}</span>` : ''}
    ${media.some(m => m.type === 'video') ? `<button class="mutebtn" aria-label="Sound">${icon(state.muted ? 'mute' : 'volume')}</button>` : ''}
    ${p.tags?.length ? `<button class="tagbtn" aria-label="Tagged people">${icon('tag')}</button><div class="taglist hidden">${p.tags.map(t => `<button data-uid="${esc(t.id)}">${esc(t.username)}</button>`).join('')}</div>` : ''}
  </div>`);
  const track = $('.track', node);
  $$('video', node).forEach(v => videoObserver.observe(v));
  if (multi) {
    const dots = el(`<div class="dots">${media.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>`);
    node._dots = dots;
    track.addEventListener('scroll', debounce(() => {
      const i = Math.round(track.scrollLeft / track.clientWidth);
      $('.counter', node).textContent = `${i + 1}/${media.length}`;
      $$('i', dots).forEach((d, k) => d.classList.toggle('on', k === i));
    }, 60));
  }
  const mute = $('.mutebtn', node);
  if (mute) mute.onclick = e => {
    e.stopPropagation();
    state.muted = !state.muted;
    $$('.mutebtn').forEach(b => b.innerHTML = icon(state.muted ? 'mute' : 'volume'));
    $$('video').forEach(v => { if (!v.paused) v.muted = state.muted; });
  };
  const tagbtn = $('.tagbtn', node);
  if (tagbtn) {
    tagbtn.onclick = e => { e.stopPropagation(); $('.taglist', node).classList.toggle('hidden'); };
    $$('.taglist button', node).forEach(b => b.onclick = e => { e.stopPropagation(); openProfile(b.dataset.uid); });
  }
  if (onDouble) doubleTap(track, () => {
    const h = el(`<div class="burst">${icon('heart', 'filled')}</div>`);
    node.appendChild(h); setTimeout(() => h.remove(), 850);
    onDouble();
  }, () => { if (tagbtn) $('.taglist', node).classList.toggle('hidden'); });
  return node;
}

// ---------- Post card ----------
function PostCard(p, { onDelete } = {}) {
  const node = el(`<article class="post">
    <div class="post-h">
      <button data-user>${avatarImg(p.author, 's32')}</button>
      <div class="who"><button class="uname" data-user>${esc(p.author?.username)}</button>${p.tags?.length ? `<div class="sub">with ${p.tags.slice(0, 2).map(t => esc(t.username)).join(', ')}${p.tags.length > 2 ? ` and ${p.tags.length - 2} more` : ''}</div>` : ''}</div>
      <button class="iconbtn" data-more aria-label="More">${icon('more')}</button>
    </div>
    <div class="media-slot"></div>
    <div class="actions">
      <button class="iconbtn" data-like aria-label="Like"></button>
      <button class="iconbtn" data-comment aria-label="Comment">${icon('comment')}</button>
      <button class="iconbtn" data-share aria-label="Send">${icon('send')}</button>
      <div class="spacer"></div>
      <button class="iconbtn" data-save aria-label="Save"></button>
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
  const mv = MediaView(p, { onDouble: () => setLike(true) });
  $('.media-slot', node).replaceWith(mv);
  if (mv._dots) node.querySelector('.actions').insertBefore(mv._dots, $('.spacer', node));
  $$('[data-user]', node).forEach(b => b.onclick = () => openProfile(p.user_id));
  $('[data-like]', node).onclick = () => setLike(!p.liked);
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
    const taggedMe = p.tags?.some(t => t.id === state.me.id);
    const opts = mine ? [{ label: 'Edit caption', value: 'edit' }, { label: 'Delete post', value: 'del', danger: true }]
      : [{ label: 'View profile', value: 'prof' }, { label: 'Report post', value: 'report', danger: true }];
    if (taggedMe && !mine) opts.splice(1, 0, { label: 'Remove me from this post', value: 'untag' });
    opts.push({ label: 'Share to…', value: 'share' }, { label: 'Cancel', value: null });
    const v = await sheet({ options: opts });
    if (v === 'prof') openProfile(p.user_id);
    if (v === 'share') sharePost(p);
    if (v === 'edit') editCaption(p, node);
    if (v === 'report') reportFlow('post', p.id);
    if (v === 'untag') { try { await api.removeTag(p.id); p.tags = p.tags.filter(t => t.id !== state.me.id); node.replaceWith(PostCard(p, { onDelete })); toast('Removed from post'); } catch (e) { fail(e); } }
    if (v === 'del' && await confirmDialog('Delete this post?')) {
      try { await api.deletePost(p.id); node.remove(); toast('Post deleted'); onDelete?.(p); } catch (e) { fail(e); }
    }
  };
  wireMentions(node);
  paint();
  return node;
}
// @mentions open profiles; #hashtags open hashtag pages.
function wireMentions(node) {
  $$('[data-mention]', node).forEach(m => m.onclick = async (e) => { e.stopPropagation(); const u = await api.getProfileByUsername(m.dataset.mention).catch(() => null); if (u) openProfile(u.id); else toast('No account with that name'); });
  $$('[data-hashtag]', node).forEach(m => m.onclick = (e) => { e.stopPropagation(); push(HashtagScreen, m.dataset.hashtag); });
}

// Lets the owner rewrite a post's caption, then redraws the card.
function editCaption(p, node) {
  const content = el(`<div style="padding:12px 16px 4px">
    <textarea class="field" id="ec-text" maxlength="2200" placeholder="Write a caption…" style="min-height:110px"></textarea>
    <div class="row" style="margin-top:12px"><button class="btn block" data-cancel>Cancel</button><button class="btn primary block" data-save-cap>Save</button></div></div>`);
  const ta = $('#ec-text', content);
  ta.value = p.caption || '';
  const s = sheet({ title: 'Edit caption', content });
  $('[data-cancel]', content).onclick = () => s.close(null);
  $('[data-save-cap]', content).onclick = async () => {
    const btn = $('[data-save-cap]', content); btn.disabled = true;
    try {
      const caption = ta.value.trim();
      await api.updatePost(p.id, caption);
      p.caption = caption;
      node.replaceWith(PostCard(p));
      s.close(null);
      toast('Caption updated');
    } catch (e) { btn.disabled = false; fail(e); }
  };
  setTimeout(() => ta.focus(), 250);
}

// Send a post to people or group chats.
async function sharePost(p) {
  const content = el(`<div><div class="searchbar">${icon('search')}<input placeholder="Search"></div><div class="res"></div></div>`);
  const res = $('.res', content);
  const sendBtn = (send) => {
    const b = el('<button class="btn primary">Send</button>');
    b.onclick = async () => { b.disabled = true; try { await send(); b.textContent = 'Sent'; } catch (e) { b.disabled = false; fail(e); } };
    return b;
  };
  const show = (convs, people) => {
    res.innerHTML = convs.length || people.length ? '' : '<div class="empty" style="padding:24px">No one found</div>';
    convs.forEach(c => {
      const row = el(`<div class="list-item">${convAvatar(c, 's44')}<div class="grow"><div class="uname">${esc(convTitle(c))}</div><div class="sub">${c.members.length} members</div></div></div>`);
      row.appendChild(sendBtn(() => api.sendMessage(c.id, { post_id: p.id })));
      res.appendChild(row);
    });
    people.filter(u => u.id !== state.me.id).forEach(u => {
      const row = el(`<div class="list-item">${avatarImg(u, 's44')}<div class="grow"><div class="uname">${esc(u.full_name || u.username)}</div><div class="sub">${esc(u.username)}</div></div></div>`);
      row.appendChild(sendBtn(async () => api.sendMessage(await api.openDM(u.id), { post_id: p.id })));
      res.appendChild(row);
    });
  };
  const initial = async () => {
    const convs = await api.conversations().catch(() => []);
    const people = convs.filter(c => !c.is_group).map(c => c.other);
    if (people.length < 8) (await api.following(state.me.id).catch(() => [])).forEach(u => { if (!people.find(x => x.id === u.id)) people.push(u); });
    show(convs.filter(c => c.is_group).slice(0, 5), people.slice(0, 20));
  };
  $('input', content).oninput = debounce(async e => { const q = e.target.value; q ? show([], await api.searchUsers(q)) : initial(); }, 250);
  initial();
  sheet({ title: 'Share', content });
}

function openProfile(id) {
  if (id === state.me.id && stack.length === 1) { stack[0].show('profile'); return; }
  push(() => ProfileView(id, false));
}

// ---------- Comments (likes and one level of replies) ----------
function CommentsScreen(p, onChange) {
  let replyTo = null; // top-level comment being replied to
  const expanded = new Set();
  const root = el(`<div>${topbar('Comments')}<div class="scroll"><div class="list"><div class="spinner"></div></div></div>
    <div class="replying hidden"><span></span><button class="iconbtn" data-x aria-label="Cancel reply">${icon('close')}</button></div>
    <div class="composer">${avatarImg(state.me, 's32')}<div class="box"><textarea rows="1" placeholder="Add a comment for ${esc(p.author?.username)}…" maxlength="1000"></textarea><button class="send" disabled>Post</button></div></div></div>`);
  wireBack(root);
  const list = $('.list', root), ta = $('textarea', root), send = $('.send', root), bar = $('.replying', root);
  let comments = [];
  const setReply = (c) => {
    replyTo = c ? (c.parent_id ? comments.find(x => x.id === c.parent_id) || c : c) : null;
    bar.classList.toggle('hidden', !replyTo);
    if (c) { $('span', bar).textContent = `Replying to ${c.author.username}`; ta.value = `@${c.author.username} `; ta.focus(); send.disabled = false; }
  };
  $('[data-x]', bar).onclick = () => { setReply(null); ta.value = ''; send.disabled = true; };
  const row = (c, { isCaption = false, child = false } = {}) => {
    const r = el(`<div class="list-item comment ${child ? 'child' : ''}" style="align-items:flex-start">
      <button data-u>${avatarImg(c.author, child ? 's24' : 's32')}</button>
      <div class="grow"><div style="white-space:normal"><button class="uname" data-u>${esc(c.author?.username)}</button> <span class="caption">${richText(c.body)}</span></div>
      <div class="sub">${timeAgo(c.created_at)}${isCaption ? '' : `${c.like_count ? `  ·  ${c.like_count} like${c.like_count === 1 ? '' : 's'}` : ''}  ·  <button class="sub" data-reply>Reply</button>`}</div></div>
      ${isCaption ? '' : `<button class="iconbtn clike ${c.liked ? 'liked' : ''}" data-clike aria-label="Like comment">${icon('heart', c.liked ? 'filled' : '')}</button>`}</div>`);
    $$('[data-u]', r).forEach(b => b.onclick = () => openProfile(c.user_id));
    $('[data-reply]', r)?.addEventListener('click', () => setReply(c));
    $('[data-clike]', r)?.addEventListener('click', async () => {
      c.liked = !c.liked; c.like_count += c.liked ? 1 : -1; render();
      try { c.liked ? await api.likeComment(c.id) : await api.unlikeComment(c.id); } catch (e) { c.liked = !c.liked; c.like_count += c.liked ? 1 : -1; render(); fail(e); }
    });
    wireMentions(r);
    if (!isCaption) longPress(r, async () => {
      const opts = [];
      if (c.user_id === state.me.id || p.user_id === state.me.id) opts.push({ label: 'Delete comment', value: 'del', danger: true });
      if (c.user_id !== state.me.id) opts.push({ label: 'Report comment', value: 'report', danger: true });
      opts.push({ label: 'Cancel', value: null });
      const v = await sheet({ options: opts });
      if (v === 'report') reportFlow('comment', c.id);
      if (v === 'del' && await confirmDialog('Delete comment?')) {
        try {
          await api.deleteComment(c.id);
          const gone = comments.filter(x => x.id === c.id || x.parent_id === c.id).length;
          comments = comments.filter(x => x.id !== c.id && x.parent_id !== c.id);
          p.comment_count -= gone; onChange?.(); render();
        } catch (e) { fail(e); }
      }
    });
    return r;
  };
  function render() {
    list.innerHTML = '';
    if (p.caption) { list.appendChild(row({ author: p.author, user_id: p.user_id, body: p.caption, created_at: p.created_at }, { isCaption: true })); list.appendChild(el('<div style="border-bottom:1px solid var(--line);margin:4px 0"></div>')); }
    const top = comments.filter(c => !c.parent_id || !comments.some(x => x.id === c.parent_id));
    if (!top.length) list.appendChild(el(`<div class="empty"><h3>No comments yet</h3><p>Start the conversation.</p></div>`));
    top.forEach(c => {
      list.appendChild(row(c));
      const kids = comments.filter(x => x.parent_id === c.id);
      if (!kids.length) return;
      if (expanded.has(c.id)) kids.forEach(k => list.appendChild(row(k, { child: true })));
      const t = el(`<button class="viewreplies"><i></i>${expanded.has(c.id) ? 'Hide replies' : `View ${kids.length} more repl${kids.length === 1 ? 'y' : 'ies'}`}</button>`);
      t.onclick = () => { expanded.has(c.id) ? expanded.delete(c.id) : expanded.add(c.id); render(); };
      list.appendChild(t);
    });
    if (comments.length) list.appendChild(el(`<div class="sub" style="text-align:center;padding:12px">Press and hold a comment for more options</div>`));
  }
  async function load() { try { comments = await api.comments(p.id); render(); } catch (e) { fail(e); } }
  ta.oninput = () => { autoGrow(ta); send.disabled = !ta.value.trim(); if (!ta.value) setReply(null); };
  send.onclick = async () => {
    const body = ta.value.trim(); if (!body) return;
    send.disabled = true;
    try {
      const c = await api.addComment(p.id, body, replyTo?.id || null);
      comments.push(c);
      if (replyTo) expanded.add(replyTo.id);
      ta.value = ''; autoGrow(ta); setReply(null); p.comment_count++; onChange?.();
      render(); if (!c.parent_id) $('.scroll', root).scrollTo(0, 1e6);
    } catch (e) { fail(e); send.disabled = false; }
  };
  load();
  return { el: root };
}

// ---------- People lists ----------
function UserListScreen(title, loader, { removable = false } = {}) {
  const root = el(`<div>${topbar(esc(title))}<div class="scroll"><div class="list"><div class="spinner"></div></div></div></div>`);
  wireBack(root);
  loader().then(async users => {
    const list = $('.list', root);
    list.innerHTML = users.length ? '' : '<div class="empty">No one here yet.</div>';
    for (const u of users) {
      const r = await UserRow(u);
      if (removable) {
        const b = el('<button class="btn" style="margin-left:6px">Remove</button>');
        b.onclick = async e => {
          e.stopPropagation();
          if (!(await confirmDialog(`Remove ${u.username} from your followers? They won't be told.`, 'Remove'))) return;
          try { await api.removeFollower(u.id); r.remove(); toast('Follower removed'); } catch (err) { fail(err); }
        };
        $('.fb', r).replaceWith(b);
      }
      list.appendChild(r);
    }
  }).catch(fail);
  return { el: root };
}
async function UserRow(u, { followBtn = true } = {}) {
  const r = el(`<div class="list-item"><button data-u class="avwrap">${avatarImg(u, 's44')}${isActiveNow(u) ? '<i class="online"></i>' : ''}</button><button class="grow" data-u style="text-align:left"><div class="uname">${esc(u.username)}</div><div class="sub">${esc(u.full_name)}</div></button><span class="fb"></span></div>`);
  $$('[data-u]', r).forEach(b => b.onclick = () => openProfile(u.id));
  if (followBtn && u.id !== state.me.id) {
    const rel = await api.relationship(u.id).catch(() => ({}));
    $('.fb', r).appendChild(FollowButton(u, rel));
  }
  return r;
}
// Follow / Requested / Following / Follow back — handles private accounts.
function FollowButton(user, rel = {}, onChange) {
  const b = el('<button class="btn"></button>');
  let s = rel.following ? 'following' : rel.requested ? 'requested' : 'none';
  const paint = () => {
    b.textContent = s === 'following' ? 'Following' : s === 'requested' ? 'Requested' : rel.followsMe ? 'Follow back' : 'Follow';
    b.classList.toggle('primary', s === 'none');
  };
  b.onclick = async (e) => {
    e.stopPropagation();
    const before = s;
    if (s === 'following') {
      const warn = user.is_private ? `Unfollow ${user.username}? You'll need to request again to see their posts.` : `Unfollow ${user.username}?`;
      if (!(await confirmDialog(warn, 'Unfollow'))) return;
      s = 'none';
    } else if (s === 'requested') s = 'none';
    else s = user.is_private ? 'requested' : 'following';
    paint();
    try {
      if (s === 'none') await api.unfollow(user.id);
      else s = await api.follow(user.id);
      paint();
      onChange?.(before, s);
      reloadHome();
    } catch (err) { s = before; paint(); fail(err); }
  };
  paint();
  return b;
}

// ---------- Search / explore / hashtags ----------
function SearchTab() {
  const root = el(`<div style="flex:1;display:flex;flex-direction:column;min-height:0">
    <div class="searchbar" style="margin-top:10px">${icon('search')}<input placeholder="Search people or #tags" autocapitalize="none"><button class="iconbtn hidden" data-clear style="width:30px;height:30px" aria-label="Clear">${icon('close')}</button></div>
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
      const tags = topHashtags(posts);
      if (tags.length) {
        const chips = el(`<div class="chips"></div>`);
        tags.forEach(t => { const c = el(`<button class="chip">#${esc(t)}</button>`); c.onclick = () => push(HashtagScreen, t); chips.appendChild(c); });
        discover.appendChild(el(`<div class="section-h">Popular tags</div>`)); discover.appendChild(chips);
      }
      discover.appendChild(el(`<div class="section-h">Explore</div>`));
      if (!posts.length) discover.appendChild(el(`<div class="empty">Nothing to explore yet. Posts from everyone on Mosaic show up here.</div>`));
      discover.appendChild(PostGrid(posts, 'Explore'));
      loaded = true;
    } catch (e) { fail(e); }
  }
  const run = debounce(async () => {
    const q = input.value.trim();
    $('[data-clear]', root).classList.toggle('hidden', !q);
    results.classList.toggle('hidden', !q); discover.classList.toggle('hidden', !!q);
    if (!q) return;
    try {
      results.innerHTML = '';
      const tag = q.replace(/^#/, '').replace(/[^\w.]/g, '');
      if (tag) {
        const t = el(`<button class="list-item"><span class="hashicon">${icon('hash')}</span><div class="grow"><div class="uname">#${esc(tag)}</div><div class="sub">See posts with this tag</div></div></button>`);
        t.onclick = () => push(HashtagScreen, tag);
        if (q.startsWith('#')) { results.appendChild(t); return; }
        const users = await api.searchUsers(q);
        if (input.value.trim() !== q) return;
        for (const u of users) results.appendChild(await UserRow(u, { followBtn: false }));
        results.appendChild(t);
      }
    } catch (e) { fail(e); }
  }, 250);
  input.oninput = run;
  $('[data-clear]', root).onclick = () => { input.value = ''; run(); };
  return { el: root, onShow: () => { if (!loaded) loadDiscover(); }, onReselect: () => { input.focus(); } };
}
function topHashtags(posts) {
  const counts = {};
  posts.forEach(p => (p.caption || '').replace(/#((?=[\w.]*[A-Za-z_])[\w.]{1,30})/g, (_, t) => { t = t.toLowerCase().replace(/\.+$/, ''); counts[t] = (counts[t] || 0) + 1; }));
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => e[0]);
}
function HashtagScreen(tag) {
  tag = tag.replace(/^#/, '');
  const root = el(`<div>${topbar('#' + esc(tag))}<div class="scroll"><div class="spinner"></div></div></div>`);
  wireBack(root);
  api.hashtagPosts(tag).then(posts => {
    const sc = $('.scroll', root);
    sc.innerHTML = '';
    sc.appendChild(el(`<div class="taghead"><span class="hashbig">${icon('hash')}</span><div><b>#${esc(tag)}</b><div class="sub">${fmtCount(posts.length)} post${posts.length === 1 ? '' : 's'}</div></div></div>`));
    if (!posts.length) sc.appendChild(el(`<div class="empty">No posts with #${esc(tag)} yet. Add it to a caption to start it.</div>`));
    sc.appendChild(PostGrid(posts, '#' + tag));
  }).catch(fail);
  return { el: root };
}

function PostGrid(posts, title) {
  const g = el(`<div class="grid"></div>`);
  posts.forEach((p, i) => {
    const media = p.media || [];
    const badge = media.some(m => m.type === 'video') ? icon('reels') : media.length > 1 ? icon('grid') : '';
    const b = el(`<button><img src="${esc(p.image_url)}" alt="" loading="lazy">${badge ? `<span class="gbadge">${badge}</span>` : ''}</button>`);
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
  return { el: root, onHide: () => pauseAllVideos(root), onDestroy: () => pauseAllVideos(root) };
}
function SinglePostScreen(postId) {
  const root = el(`<div>${topbar('Post')}<div class="scroll"><div class="spinner"></div></div></div>`);
  wireBack(root);
  api.getPost(postId).then(p => {
    const sc = $('.scroll', root);
    sc.innerHTML = p ? '' : '<div class="empty">This post isn\'t available.</div>';
    if (p) sc.appendChild(PostCard(p, { onDelete: () => pop() }));
  }).catch(fail);
  return { el: root, onHide: () => pauseAllVideos(root), onDestroy: () => pauseAllVideos(root) };
}

// ---------- Reels: full-screen vertical videos ----------
function ReelsTab() {
  const root = el(`<div class="reels" style="flex:1;display:flex;flex-direction:column;min-height:0">
    <div class="reels-top"><h1>Reels</h1><button class="iconbtn" data-new aria-label="New reel">${icon('camera')}</button></div>
    <div class="reel-track"><div class="spinner"></div></div></div>`);
  const track = $('.reel-track', root);
  let loaded = 0, visible = false;
  $('[data-new]', root).onclick = () => push(CreateScreen, 'post', { video: true });
  async function load() {
    try {
      const posts = await api.reels();
      track.innerHTML = '';
      if (!posts.length) {
        track.appendChild(el(`<div class="empty reel-empty">${icon('reels')}<h3>No reels yet</h3><p>Share a video post and it shows up here for everyone who can see your posts.</p><button class="btn primary" data-go>Share a video</button></div>`));
        $('[data-go]', track).onclick = () => push(CreateScreen, 'post', { video: true });
      }
      posts.forEach(p => track.appendChild(ReelItem(p)));
      loaded = Date.now();
      if (visible) playCurrent();
    } catch (e) { fail(e); }
  }
  const io = new IntersectionObserver(es => es.forEach(e => {
    const v = $('video', e.target);
    if (!v) return;
    if (e.isIntersecting && e.intersectionRatio > 0.7 && visible) { v.muted = state.muted; v.play().catch(() => {}); } else v.pause();
  }), { threshold: [0, 0.7, 1] });
  function ReelItem(p) {
    const vid = p.media.find(m => m.type === 'video');
    const n = el(`<section class="reel">
      <video src="${esc(vid.url)}" poster="${esc(vid.poster || p.image_url)}" playsinline loop preload="metadata"></video>
      <button class="reel-mute" aria-label="Sound">${icon(state.muted ? 'mute' : 'volume')}</button>
      <div class="reel-side">
        <button data-like aria-label="Like"></button><span data-lc></span>
        <button data-comment aria-label="Comments">${icon('comment')}</button><span>${fmtCount(p.comment_count)}</span>
        <button data-share aria-label="Send">${icon('send')}</button>
        <button data-more aria-label="More">${icon('more')}</button>
      </div>
      <div class="reel-info"><button class="row" data-user style="align-items:center;gap:8px">${avatarImg(p.author, 's32')}<b>${esc(p.author?.username)}</b></button>
        ${p.caption ? `<div class="reel-cap">${richText(p.caption)}</div>` : ''}</div></section>`);
    const v = $('video', n);
    const paint = () => { $('[data-like]', n).innerHTML = icon('heart', p.liked ? 'filled' : ''); $('[data-like]', n).classList.toggle('liked', p.liked); $('[data-lc]', n).textContent = fmtCount(p.like_count); };
    const setLike = async on => { if (p.liked === on) return; p.liked = on; p.like_count += on ? 1 : -1; paint(); try { on ? await api.like(p.id) : await api.unlike(p.id); } catch (e) { p.liked = !on; p.like_count += on ? -1 : 1; paint(); fail(e); } };
    doubleTap(v, () => { const h = el(`<div class="burst">${icon('heart', 'filled')}</div>`); n.appendChild(h); setTimeout(() => h.remove(), 850); setLike(true); },
      () => { v.paused ? v.play().catch(() => {}) : v.pause(); });
    $('.reel-mute', n).onclick = () => { state.muted = !state.muted; v.muted = state.muted; $$('.reel-mute, .mutebtn').forEach(b => b.innerHTML = icon(state.muted ? 'mute' : 'volume')); };
    $('[data-like]', n).onclick = () => setLike(!p.liked);
    $('[data-comment]', n).onclick = () => push(CommentsScreen, p, () => {});
    $('[data-share]', n).onclick = () => sharePost(p);
    $('[data-user]', n).onclick = () => openProfile(p.user_id);
    $('[data-more]', n).onclick = async () => {
      const mine = p.user_id === state.me.id;
      const vv = await sheet({ options: mine ? [{ label: 'Delete', value: 'del', danger: true }, { label: 'Cancel', value: null }] : [{ label: 'Report', value: 'report', danger: true }, { label: 'Cancel', value: null }] });
      if (vv === 'report') reportFlow('post', p.id);
      if (vv === 'del' && await confirmDialog('Delete this reel?')) { try { await api.deletePost(p.id); n.remove(); } catch (e) { fail(e); } }
    };
    wireMentions(n);
    paint();
    io.observe(n);
    return n;
  }
  function playCurrent() {
    const h = track.clientHeight || 1;
    const i = Math.round(track.scrollTop / h);
    $$('.reel', track).forEach((r, k) => { const v = $('video', r); if (k === i) { v.muted = state.muted; v.play().catch(() => {}); } else v.pause(); });
  }
  return {
    el: root,
    onShow: () => { visible = true; if (!loaded || Date.now() - loaded > 120000) load(); else playCurrent(); },
    onHide: () => { visible = false; pauseAllVideos(root); },
    onReselect: () => { track.scrollTo({ top: 0, behavior: 'smooth' }); load(); },
  };
}

// ---------- Activity ----------
function ActivityScreen() {
  const root = el(`<div>${topbar('Notifications')}<div class="scroll"><div class="list"><div class="spinner"></div></div></div></div>`);
  wireBack(root);
  const list = $('.list', root);
  async function load() {
    try {
      const [ns, reqs] = await Promise.all([api.notifications(), api.followRequests()]);
      list.innerHTML = '';
      if (reqs.length) {
        const r = el(`<button class="list-item reqrow"><span class="avstack">${reqs.slice(0, 2).map(u => avatarImg(u, 's32')).join('')}</span>
          <div class="grow"><div class="uname">Follow requests</div><div class="sub">${esc(reqs[0].username)}${reqs.length > 1 ? ` + ${reqs.length - 1} other${reqs.length > 2 ? 's' : ''}` : ''}</div></div><span class="udot"></span></button>`);
        r.onclick = () => push(FollowRequestsScreen);
        list.appendChild(r);
      }
      if (!ns.length && !reqs.length) { list.appendChild(el(`<div class="empty">${icon('heart')}<h3>Activity on your posts</h3><p>When someone likes or comments on your posts, follows you, or tags you, you'll see it here.</p></div>`)); }
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
  return { el: root, onShow: load };
}
async function NotifRow(n) {
  const text = {
    like: 'liked your post.', comment: `commented: ${esc(n.body || '')}`, follow: 'started following you.',
    follow_request: 'asked to follow you.', follow_accept: 'accepted your follow request.', tag: 'tagged you in a post.',
    reply: `replied to your comment: ${esc(n.body || '')}`, comment_like: `liked your comment: ${esc(n.body || '')}`,
  }[n.type] || '';
  const r = el(`<div class="list-item"><button data-u>${avatarImg(n.actor, 's44')}</button>
    <div class="grow" style="white-space:normal"><span class="uname">${esc(n.actor?.username)}</span> ${text} <span class="sub">${timeAgo(n.created_at)}</span></div><span class="end"></span></div>`);
  $('[data-u]', r).onclick = () => openProfile(n.actor_id);
  const end = $('.end', r);
  if (n.type === 'follow' || n.type === 'follow_accept') {
    const rel = await api.relationship(n.actor_id).catch(() => ({ following: true }));
    end.appendChild(FollowButton(n.actor, rel));
    r.onclick = e => { if (!e.target.closest('button')) openProfile(n.actor_id); };
  } else if (n.type === 'follow_request') {
    r.onclick = () => push(FollowRequestsScreen);
  } else {
    if (n.post_image) end.appendChild(el(`<img class="thumb" src="${esc(n.post_image)}" alt="">`));
    r.onclick = e => { if (!e.target.closest('[data-u]') && n.post_id) push(SinglePostScreen, n.post_id); };
  }
  return r;
}
function FollowRequestsScreen() {
  const root = el(`<div>${topbar('Follow requests')}<div class="scroll"><div class="list"><div class="spinner"></div></div></div></div>`);
  wireBack(root);
  const list = $('.list', root);
  api.followRequests().then(users => {
    list.innerHTML = users.length ? '' : '<div class="empty">No pending requests.</div>';
    users.forEach(u => {
      const r = el(`<div class="list-item"><button data-u>${avatarImg(u, 's44')}</button><button class="grow" data-u style="text-align:left"><div class="uname">${esc(u.username)}</div><div class="sub">${esc(u.full_name)}</div></button>
        <button class="btn primary" data-ok>Confirm</button><button class="btn" data-no style="margin-left:6px">Delete</button></div>`);
      $$('[data-u]', r).forEach(b => b.onclick = () => openProfile(u.id));
      $('[data-ok]', r).onclick = async () => { try { await api.acceptRequest(u.id); $('[data-ok]', r).remove(); $('[data-no]', r).replaceWith(el('<span class="sub">Now follows you</span>')); } catch (e) { fail(e); } };
      $('[data-no]', r).onclick = async () => { try { await api.declineRequest(u.id); r.remove(); } catch (e) { fail(e); } };
      list.appendChild(r);
    });
  }).catch(fail);
  return { el: root };
}
