// Mosaic — story viewer and full-screen photo viewer.  (c) RM Software
'use strict';

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

