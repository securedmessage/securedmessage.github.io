// Mosaic — profiles, privacy, blocking, reporting and settings.  (c) RM Software
'use strict';

function ProfileView(userId, isTab) {
  const own = userId === state.me.id;
  const root = el(`<div ${isTab ? 'style="flex:1;display:flex;flex-direction:column;min-height:0"' : ''}>
    <div class="topbar">${isTab ? '' : `<button class="iconbtn" data-back aria-label="Back">${icon('back')}</button>`}<h1 class="ptitle"></h1>
      ${own ? `<button class="iconbtn" data-new aria-label="Create">${icon('plus')}</button><button class="iconbtn" data-settings aria-label="Settings">${icon('settings')}</button>` : `<button class="iconbtn" data-more aria-label="More">${icon('more')}</button>`}</div>
    <div class="scroll"><div class="spinner"></div></div></div>`);
  wireBack(root);
  const sc = $('.scroll', root);
  let tab = 'posts', user = null, rel = {};
  $('[data-settings]', root)?.addEventListener('click', () => push(SettingsScreen));
  $('[data-new]', root)?.addEventListener('click', async () => {
    const v = await sheet({ title: 'Create', options: [{ label: 'Post', value: 'post' }, { label: 'Reel (video)', value: 'reel' }, { label: 'Story', value: 'story' }, { label: 'Cancel', value: null }] });
    if (v === 'reel') push(CreateScreen, 'post', { video: true });
    else if (v) push(CreateScreen, v);
  });
  async function load() {
    try {
      const [u, st, r] = await Promise.all([own ? api.getProfile(state.me.id) : api.getProfile(userId), api.stats(userId), own ? {} : api.relationship(userId)]);
      if (!u) { $('.ptitle', root).textContent = ''; sc.innerHTML = '<div class="empty"><h3>Profile isn\'t available</h3><p>The account may have been removed.</p></div>'; return; }
      user = u; rel = r;
      if (own) state.me = u;
      const locked = !own && u.is_private && !rel.following;
      $('.ptitle', root).innerHTML = `${u.is_private ? `<span class="lockico">${icon('lock')}</span>` : ''}${esc(u.username)}`;
      const g = state.storyGroups.find(x => x.user.id === u.id);
      const status = own ? '' : activeLabel(u);
      sc.innerHTML = '';
      const head = el(`<div class="prof">
        <div class="prof-top"><button data-av class="avwrap">${g && !locked ? `<span class="ring">${avatarImg(u, 's86')}</span>` : avatarImg(u, 's86')}</button>
          <div class="counts"><div><b>${fmtCount(st.posts)}</b><span>posts</span></div>
          <button data-followers><b>${fmtCount(st.followers)}</b><span>followers</span></button>
          <button data-following><b>${fmtCount(st.following)}</b><span>following</span></button></div></div>
        ${u.full_name ? `<div class="name">${esc(u.full_name)}</div>` : '<div style="height:10px"></div>'}
        ${status ? `<div class="sub status">${isActiveNow(u) ? '<i class="online inline"></i>' : ''}${esc(status)}</div>` : ''}
        ${u.bio ? `<div class="bio">${richText(u.bio)}</div>` : ''}
        ${rel.blocked ? `<div class="demo-note" style="margin-top:12px;text-align:left">You blocked this account. They can't find your profile, see your posts or message you.</div>` : ''}
        <div class="row" style="margin-top:14px"></div></div>`);
      wireMentions(head);
      const row = $('.row', head);
      if (own) {
        const edit = el('<button class="btn block">Edit profile</button>'); edit.onclick = () => push(EditProfileScreen);
        const share = el('<button class="btn block">Share profile</button>');
        share.onclick = async () => { try { await navigator.clipboard.writeText('@' + u.username); toast('Username copied'); } catch { toast('@' + u.username); } };
        row.append(edit, share);
      } else if (rel.blocked) {
        const ub = el('<button class="btn primary block">Unblock</button>');
        ub.onclick = async () => { try { await api.unblock(u.id); toast(`Unblocked ${u.username}`); load(); } catch (e) { fail(e); } };
        row.append(ub);
      } else {
        const fb = FollowButton(u, rel, (before, now) => {
          if (before === 'following' || now === 'following') { st.followers += now === 'following' ? 1 : -1; $('[data-followers] b', head).textContent = fmtCount(st.followers); }
          if (u.is_private && (before === 'following' || now === 'following')) load();
        });
        fb.classList.add('block');
        const msg = el('<button class="btn block">Message</button>');
        msg.onclick = async () => { try { push(ChatScreen, await api.openDM(u.id)); } catch (e) { fail(e); } };
        row.append(fb, msg);
      }
      $('[data-av]', head).onclick = () => { if (g && !locked) openStories([g], 0); };
      const lists = (which) => {
        if (locked) { toast('This account is private'); return; }
        push(UserListScreen, which === 'followers' ? 'Followers' : 'Following', () => which === 'followers' ? api.followers(u.id) : api.following(u.id), { removable: own && which === 'followers' });
      };
      $('[data-followers]', head).onclick = () => lists('followers');
      $('[data-following]', head).onclick = () => lists('following');
      sc.appendChild(head);
      if (rel.blocked) return;
      if (locked) {
        sc.appendChild(el(`<div class="tabs"></div>`));
        sc.appendChild(el(`<div class="empty">${icon('lock')}<h3>This account is private</h3><p>Follow this account to see their photos and videos.</p></div>`));
        return;
      }
      const tabs = el(`<div class="tabs"><button data-t="posts" aria-label="Posts">${icon('grid')}</button><button data-t="reels" aria-label="Reels">${icon('reels')}</button>${own ? `<button data-t="saved" aria-label="Saved">${icon('bookmark')}</button>` : ''}<button data-t="tagged" aria-label="Tagged">${icon('tag')}</button></div>`);
      sc.appendChild(tabs);
      const body = el('<div></div>'); sc.appendChild(body);
      let postsCache = null;
      const showTab = async (t) => {
        tab = t;
        $$('button', tabs).forEach(b => b.classList.toggle('on', b.dataset.t === t));
        body.innerHTML = '<div class="spinner"></div>';
        let list;
        try {
          if (t === 'posts' || t === 'reels') { postsCache ||= await api.userPosts(userId); list = t === 'posts' ? postsCache : postsCache.filter(p => p.media.some(m => m.type === 'video')); }
          else if (t === 'saved') list = await api.savedPosts();
          else list = await api.taggedPosts(userId);
        } catch (e) { fail(e); list = []; }
        if (tab !== t) return;
        body.innerHTML = '';
        const empties = {
          posts: own ? [icon('camera'), 'Share photos', "When you share photos and videos, they'll appear on your profile.", 'Share your first photo'] : [icon('camera'), 'No posts yet'],
          reels: [icon('reels'), own ? 'Share a reel' : 'No reels yet', own ? 'Video posts show up here and in the Reels tab.' : ''],
          saved: [icon('bookmark'), 'Save', "Save photos and videos you want to see again. Only you can see what you've saved."],
          tagged: [icon('tag'), own ? 'Photos of you' : 'No photos', own ? "When people tag you in photos, they'll appear here." : ''],
        }[t];
        if (!list.length) {
          body.appendChild(el(`<div class="empty">${empties[0]}<h3>${empties[1]}</h3>${empties[2] ? `<p>${empties[2]}</p>` : ''}${empties[3] ? `<button class="btn primary" data-share>${empties[3]}</button>` : ''}</div>`));
          $('[data-share]', body)?.addEventListener('click', () => push(CreateScreen, 'post'));
        }
        body.appendChild(PostGrid(list, { posts: 'Posts', reels: 'Reels', saved: 'Saved', tagged: 'Tagged' }[t]));
      };
      $$('button', tabs).forEach(b => b.onclick = () => showTab(b.dataset.t));
      showTab(tab);
    } catch (e) { fail(e); }
  }
  $('[data-more]', root)?.addEventListener('click', async () => {
    if (!user) return;
    const opts = [];
    if (!rel.blocked) opts.push({ label: 'Send message', value: 'msg' });
    if (rel.followsMe) opts.push({ label: 'Remove follower', value: 'remove' });
    opts.push({ label: 'Copy username', value: 'copy' });
    opts.push(rel.blocked ? { label: 'Unblock', value: 'unblock' } : { label: 'Block', value: 'block', danger: true });
    opts.push({ label: 'Report', value: 'report', danger: true }, { label: 'Cancel', value: null });
    const v = await sheet({ title: user.username, options: opts });
    if (v === 'msg') { try { push(ChatScreen, await api.openDM(userId)); } catch (e) { fail(e); } }
    if (v === 'copy') { try { await navigator.clipboard.writeText('@' + user.username); toast('Copied'); } catch { toast('@' + user.username); } }
    if (v === 'remove' && await confirmDialog(`Remove ${user.username} from your followers? They won't be told.`, 'Remove')) { try { await api.removeFollower(userId); toast('Follower removed'); load(); } catch (e) { fail(e); } }
    if (v === 'block') { if (await blockFlow(user)) load(); }
    if (v === 'unblock') { try { await api.unblock(userId); toast(`Unblocked ${user.username}`); load(); } catch (e) { fail(e); } }
    if (v === 'report') reportFlow('user', userId);
  });
  let shown = 0;
  return { el: root, onShow: () => { if (Date.now() - shown > 1500) load(); shown = Date.now(); }, onReselect: load };
}

async function blockFlow(user) {
  const ok = await confirmDialog(`Block ${user.username}? They won't be able to find your profile, see your posts or message you. They won't be told you blocked them.`, 'Block');
  if (!ok) return false;
  try { await api.block(user.id); toast(`Blocked ${user.username}`); reloadHome(); return true; } catch (e) { fail(e); return false; }
}

const REPORT_REASONS = ['Child safety concern', "It's spam", 'Nudity or sexual content', 'Hate speech or symbols', 'Bullying or harassment', 'Violence or dangerous content', 'Scam or fraud', 'False information', 'Something else'];
async function reportFlow(kind, targetId) {
  const what = { post: 'post', user: 'account', comment: 'comment', message: 'message' }[kind];
  const reason = await sheet({ title: `Why are you reporting this ${what}?`, options: [...REPORT_REASONS.map(r => ({ label: r, value: r })), { label: 'Cancel', value: null }] });
  if (!reason) return;
  const content = el(`<div style="padding:12px 16px 4px"><label class="lbl" for="rp-d" style="margin-top:0">Anything else we should know? (optional)</label>
    <textarea class="field" id="rp-d" maxlength="1000"></textarea>
    <div class="row" style="margin-top:12px"><button class="btn block" data-cancel>Cancel</button><button class="btn primary block" data-send>Submit report</button></div></div>`);
  const s = sheet({ title: reason, content });
  $('[data-cancel]', content).onclick = () => s.close(null);
  $('[data-send]', content).onclick = async () => {
    $('[data-send]', content).disabled = true;
    try { await api.report(kind, targetId, reason, $('#rp-d', content).value.trim()); s.close(null); toast('Thanks for letting us know. Your report was sent.', 3500); }
    catch (e) { $('[data-send]', content).disabled = false; fail(e); }
  };
}

function EditProfileScreen() {
  const me = state.me;
  let avatar = me.avatar_url;
  const root = el(`<div>${topbar('Edit profile', { right: '<button class="linkbtn" data-save style="padding:0 10px">Done</button>' })}
    <div class="scroll"><div class="form">
      <div style="text-align:center;margin:18px 0 6px"><button data-pic aria-label="Change photo"><img class="av s86" src="${esc(avatarSrc(me))}" style="margin:0 auto" alt=""></button>
      <div><button class="linkbtn" data-pic2 style="margin-top:10px">Change photo</button></div></div>
      <label class="lbl" for="e-name">Name</label><input class="field" id="e-name" maxlength="60" value="${esc(me.full_name)}">
      <label class="lbl" for="e-user">Username</label><input class="field" id="e-user" maxlength="30" autocapitalize="none" value="${esc(me.username)}">
      <label class="lbl" for="e-bio">Bio</label><textarea class="field" id="e-bio" maxlength="300">${esc(me.bio)}</textarea>
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

function SettingsScreen() {
  const themeName = () => ({ system: 'System', light: 'Light', dark: 'Dark' }[store.getItem('mosaic_theme') || 'system']);
  const root = el(`<div>${topbar('Settings')}<div class="scroll">
    <div class="set-group">Account privacy</div>
    <label class="set-row toggle">${icon('lock')}<span class="grow">Private account<span class="sub">Only people you approve can see your posts, reels, stories and followers.</span></span><input type="checkbox" id="st-private"></label>
    <label class="set-row toggle">${icon('people')}<span class="grow">Show activity status<span class="sub">Let people you message see when you were last active. When off, you won't see theirs either.</span></span><input type="checkbox" id="st-active"></label>
    <button class="set-row" data-a="requests">${icon('people')}Follow requests</button>
    <button class="set-row" data-a="blocked">${icon('block')}Blocked accounts</button>
    <div class="set-group">App</div>
    <button class="set-row" data-a="edit">${icon('user')}Edit profile</button>
    <button class="set-row" data-a="theme">${icon('moon')}Appearance<span class="val">${themeName()}</span></button>
    <button class="set-row" data-a="server" ${window.MOSAIC_PREVIEW || BUILT_IN_SERVER ? 'hidden' : ''}>${icon('server')}Server<span class="val">${api.mode === 'demo' ? 'Demo mode' : 'Connected'}</span></button>
    ${api.mode === 'demo' ? `<button class="set-row" data-a="reset">${icon('trash')}Reset demo data</button>` : ''}
    <button class="set-row" data-a="about">${icon('info')}About Mosaic</button>
    <a class="set-row" href="${LEGAL_BASE}privacy.html" target="_blank" rel="noopener">${icon('lock')}Privacy Policy</a>
    <a class="set-row" href="${LEGAL_BASE}terms.html" target="_blank" rel="noopener">${icon('flag')}Terms of Use</a>
    <div class="set-group">Account</div>
    <button class="set-row" data-a="logout">${icon('logout')}Log out ${esc(state.me.username)}</button>
    <button class="set-row" data-a="delete" style="color:var(--like)">${icon('trash')}Delete account</button>
  </div></div>`);
  wireBack(root);
  const priv = $('#st-private', root), act = $('#st-active', root);
  priv.checked = !!state.me.is_private; act.checked = state.me.show_activity !== false;
  priv.onchange = async () => {
    const on = priv.checked;
    if (!on && !(await confirmDialog('Switch to a public account? Anyone can see your posts, and everyone who asked to follow you will be approved.', 'Switch to public'))) { priv.checked = true; return; }
    try { state.me = await api.updateProfile({ is_private: on }); toast(on ? 'Your account is now private' : 'Your account is now public'); stack[0].reload?.('profile'); }
    catch (e) { priv.checked = !on; fail(e); }
  };
  act.onchange = async () => {
    try { state.me = await api.updateProfile({ show_activity: act.checked }); presence(); toast(act.checked ? 'Activity status is on' : 'Activity status is off'); }
    catch (e) { act.checked = !act.checked; fail(e); }
  };
  $$('[data-a]', root).forEach(b => b.onclick = async () => {
    const a = b.dataset.a;
    if (a === 'edit') push(EditProfileScreen);
    if (a === 'server') push(ServerScreen);
    if (a === 'about') push(AboutScreen);
    if (a === 'requests') push(FollowRequestsScreen);
    if (a === 'blocked') push(BlockedScreen);
    if (a === 'theme') {
      const v = await sheet({ title: 'Appearance', options: [{ label: 'Use system setting', value: 'system' }, { label: 'Light', value: 'light' }, { label: 'Dark', value: 'dark' }] });
      if (v) { store.setItem('mosaic_theme', v); applyTheme(); $('.val', b).textContent = themeName(); }
    }
    if (a === 'reset' && await confirmDialog('Erase all demo accounts, posts and chats on this device?', 'Reset')) { api.reset(); location.reload(); }
    if (a === 'logout' && await confirmDialog('Log out of Mosaic?', 'Log out')) { await api.signOut(); state.me = null; resetTo(AuthScreen); }
    if (a === 'delete') deleteAccountFlow();
  });
  return { el: root };
}

// Permanently deletes the account after the person types DELETE.
function deleteAccountFlow() {
  const content = el(`<div style="padding:12px 16px 4px">
    <p style="margin-top:0">This permanently deletes <b>@${esc(state.me.username)}</b> and everything in it: your profile, posts, reels, stories, comments, likes, followers, and the messages you sent. It can't be undone.</p>
    <p class="sub">Group chats you're in will continue for the other members without you.</p>
    <label class="lbl" for="del-confirm">Type DELETE to confirm</label>
    <input class="field" id="del-confirm" autocapitalize="characters" autocomplete="off">
    <div class="row" style="margin-top:14px"><button class="btn block" data-cancel>Cancel</button><button class="btn block danger-btn" data-del disabled>Delete account</button></div></div>`);
  const s = sheet({ title: 'Delete your account?', content });
  const input = $('#del-confirm', content), btn = $('[data-del]', content);
  input.oninput = () => { btn.disabled = input.value.trim().toUpperCase() !== 'DELETE'; };
  $('[data-cancel]', content).onclick = () => s.close(null);
  btn.onclick = async () => {
    btn.disabled = true; btn.textContent = 'Deleting…';
    try {
      await api.deleteAccount();
      s.close(null);
      state.me = null;
      resetTo(AuthScreen);
      toast('Your account and everything in it were deleted.', 4000);
    } catch (e) { btn.disabled = false; btn.textContent = 'Delete account'; fail(e); }
  };
  setTimeout(() => input.focus(), 250);
}

function BlockedScreen() {
  const root = el(`<div>${topbar('Blocked accounts')}<div class="scroll"><div class="list"><div class="spinner"></div></div></div></div>`);
  wireBack(root);
  const list = $('.list', root);
  api.blockedUsers().then(users => {
    list.innerHTML = users.length ? '<p class="sub" style="padding:10px 16px">Blocked people can\'t find your profile, see your posts or message you. They aren\'t told when you block them.</p>' : '<div class="empty">You haven\'t blocked anyone.</div>';
    users.forEach(u => {
      const r = el(`<div class="list-item">${avatarImg(u, 's44')}<div class="grow"><div class="uname">${esc(u.username)}</div><div class="sub">${esc(u.full_name)}</div></div><button class="btn">Unblock</button></div>`);
      $('button', r).onclick = async () => { try { await api.unblock(u.id); r.remove(); toast(`Unblocked ${u.username}`); } catch (e) { fail(e); } };
      list.appendChild(r);
    });
  }).catch(fail);
  return { el: root };
}

function AboutScreen() {
  const root = el(`<div>${topbar('About')}<div class="scroll"><div class="about">
    <span class="logo">Mosaic</span>
    <p>Version ${APP_VERSION}</p>
    <p>Share photos, videos and stories, follow friends, and chat in real time.</p>
    <p style="margin-top:28px">© ${new Date().getFullYear()} RM Software. All rights reserved.</p>
  </div></div></div>`);
  wireBack(root);
  return { el: root };
}
