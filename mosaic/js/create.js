// Mosaic — new posts (photos, videos, carousels, tags) and the story editor.  (c) RM Software
'use strict';

const MAX_ITEMS = 10, MAX_VIDEO_SECONDS = 90, MAX_VIDEO_BYTES = 50 * 1024 * 1024;

function CreateScreen(mode = 'post', opts = {}) {
  let items = [];          // { type: 'image', img } | { type: 'video', file, info }
  let filter = 'none', cur = 0, tags = [];
  const root = el(`<div>${topbar('New post', { right: '<button class="linkbtn" data-share style="padding:0 12px">Share</button>' })}
    <div class="scroll">
      <div class="seg"><button data-m="post">Post</button><button data-m="story">Story</button></div>
      <div class="pick">${icon('image')}<div class="pick-msg"></div>
        <div class="row" style="flex-wrap:wrap;justify-content:center"><button class="btn primary" data-pick>Gallery</button><button class="btn" data-cam>Take photo</button><button class="btn post-only" data-rec>Record video</button></div></div>
      <div class="editor hidden">
        <div class="post-only" style="padding:12px 14px 0">
          <label class="lbl" for="c-caption" style="margin-top:0">Caption</label>
          <textarea class="field" id="c-caption" placeholder="Write a caption… (add #tags or @mention people)" maxlength="2200" style="min-height:70px"></textarea>
        </div>
        <div class="preview" style="margin-top:12px"><div class="pv-stage"></div>
          <span class="counter hidden"></span>
          <button class="pv-del hidden" aria-label="Remove this item">${icon('close')}</button>
          <button class="pv-nav prev hidden" aria-label="Previous">${icon('back')}</button><button class="pv-nav next hidden" aria-label="Next" style="transform:scaleX(-1)">${icon('back')}</button></div>
        <div class="filters"></div>
        <div class="post-only" style="padding:4px 14px 20px;display:flex;flex-direction:column;gap:12px">
          <div class="row" style="flex-wrap:wrap"><button class="btn" data-add>${icon('plus')} Add more</button><button class="btn" data-tag>${icon('tag')} Tag people</button></div>
          <div class="chips tagchips"></div>
          <p class="sub">Up to ${MAX_ITEMS} photos and videos per post. Videos can be up to ${MAX_VIDEO_SECONDS} seconds.</p>
        </div>
      </div>
    </div></div>`);
  wireBack(root);
  const shareBtn = $('[data-share]', root), stage = $('.pv-stage', root);
  const paintMode = () => {
    $('h1', root).textContent = mode === 'post' ? (opts.video ? 'New reel' : 'New post') : 'New story';
    $$('.seg button', root).forEach(b => b.classList.toggle('on', b.dataset.m === mode));
    $$('.post-only', root).forEach(x => x.classList.toggle('hidden', mode !== 'post'));
    $('.pick-msg', root).textContent = mode === 'post' ? 'Choose photos and videos from your gallery, take a photo, or record a video.' : 'Choose a photo for your story. You can add text, drawings and stickers next.';
    shareBtn.style.visibility = mode === 'post' ? 'visible' : 'hidden';
    shareBtn.style.opacity = items.length ? 1 : .4;
    if (mode === 'post' && items.length) showItem(cur);
  };
  function showItem(i) {
    cur = Math.max(0, Math.min(i, items.length - 1));
    const it = items[cur];
    stage.innerHTML = '';
    if (!it) return;
    if (it.type === 'image') {
      const c = renderImage(it.img, { max: 1080, square: true, filter });
      stage.appendChild(c);
    } else {
      const v = el(`<video src="${it.info.url}" playsinline muted loop autoplay controls></video>`);
      stage.appendChild(v);
    }
    const multi = items.length > 1;
    $('.counter', root).classList.toggle('hidden', !multi);
    $('.counter', root).textContent = `${cur + 1}/${items.length}`;
    $('.pv-del', root).classList.toggle('hidden', !multi);
    $('.prev', root).classList.toggle('hidden', !multi || cur === 0);
    $('.next', root).classList.toggle('hidden', !multi || cur === items.length - 1);
    $('.filters', root).classList.toggle('hidden', it.type !== 'image');
    $('[data-add]', root).disabled = items.length >= MAX_ITEMS;
  }
  function buildFilters() {
    const firstImg = items.find(x => x.type === 'image');
    const fl = $('.filters', root); fl.innerHTML = '';
    if (!firstImg) return;
    const thumb = renderImage(firstImg.img, { max: 160, square: true }).toDataURL('image/jpeg', .7);
    FILTERS.forEach(([name, f]) => {
      const b = el(`<button class="${f === filter ? 'on' : ''}"><img src="${thumb}" style="filter:${f}" alt=""><span>${name}</span></button>`);
      b.onclick = () => { filter = f; $$('button', fl).forEach(x => x.classList.remove('on')); b.classList.add('on'); showItem(cur); };
      fl.appendChild(b);
    });
  }
  async function addFiles(files) {
    if (!files.length) return;
    const room = MAX_ITEMS - items.length;
    if (files.length > room) toast(`Only ${MAX_ITEMS} items fit in one post; the first ${room} were added.`);
    for (const f of files.slice(0, room)) {
      try {
        if (f.type.startsWith('video/')) {
          if (f.size > MAX_VIDEO_BYTES) { toast(`"${f.name}" is larger than 50 MB.`); continue; }
          const info = await videoInfo(f);
          if (info.duration > MAX_VIDEO_SECONDS + 0.5) { toast(`Videos can be up to ${MAX_VIDEO_SECONDS} seconds; that one is ${fmtDuration(info.duration)}.`); continue; }
          items.push({ type: 'video', file: f, info });
        } else {
          const url = URL.createObjectURL(f);
          items.push({ type: 'image', img: await loadImage(url) });
        }
      } catch (e) { toast(e.message || "That file couldn't be opened"); }
    }
    if (!items.length) return;
    $('.pick', root).classList.add('hidden'); $('.editor', root).classList.remove('hidden');
    buildFilters();
    showItem(items.length - 1);
    paintMode();
  }
  async function choose(kind) {
    if (mode === 'story') {
      const f = (await pickFiles({ accept: 'image/*', capture: kind === 'cam' }))[0];
      if (!f) return;
      try { const img = await loadImage(URL.createObjectURL(f)); push(StoryEditor, img); } catch { toast("That photo couldn't be opened"); }
      return;
    }
    const accept = kind === 'rec' ? 'video/*' : kind === 'cam' ? 'image/*' : (opts.video ? 'video/*' : 'image/*,video/*');
    addFiles(await pickFiles({ accept, multiple: kind === 'gallery', capture: kind !== 'gallery' }));
  }
  $('[data-pick]', root).onclick = () => choose('gallery');
  $('[data-cam]', root).onclick = () => choose('cam');
  $('[data-rec]', root).onclick = () => choose('rec');
  $('[data-add]', root).onclick = async () => addFiles(await pickFiles({ accept: 'image/*,video/*', multiple: true }));
  $('.prev', root).onclick = () => showItem(cur - 1);
  $('.next', root).onclick = () => showItem(cur + 1);
  $('.pv-del', root).onclick = () => { items.splice(cur, 1); buildFilters(); showItem(cur); paintMode(); };
  $('[data-tag]', root).onclick = async () => { tags = await pickPeople('Tag people', tags); paintTags(); };
  function paintTags() {
    const box = $('.tagchips', root); box.innerHTML = '';
    tags.forEach(u => {
      const c = el(`<button class="chip">${esc(u.username)} ✕</button>`);
      c.onclick = () => { tags = tags.filter(t => t.id !== u.id); paintTags(); };
      box.appendChild(c);
    });
  }
  $$('.seg button', root).forEach(b => b.onclick = () => { mode = b.dataset.m; paintMode(); if (mode === 'story' && items.find(x => x.type === 'image')) push(StoryEditor, items.find(x => x.type === 'image').img); });
  shareBtn.onclick = async () => {
    if (!items.length) { toast('Choose a photo or video first'); return; }
    shareBtn.disabled = true; shareBtn.textContent = 'Sharing…';
    try {
      const media = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (items.length > 1 || it.type === 'video') toast(`Uploading ${i + 1} of ${items.length}…`, 60000);
        if (it.type === 'image') {
          const c = renderImage(it.img, { max: 1080, square: true, filter });
          media.push({ type: 'image', url: await api.uploadImage(await canvasToBlob(c, 0.86)) });
        } else {
          const poster = await api.uploadImage(await canvasToBlob(it.info.poster, 0.82));
          const url = await api.uploadFile(it.file, extFromType(it.file.type, 'mp4'), it.file.type || 'video/mp4');
          media.push({ type: 'video', url, poster, duration: Math.round(it.info.duration * 10) / 10 });
        }
      }
      await api.createPost({ media, caption: $('#c-caption', root).value.trim(), tags: tags.map(t => t.id) });
      toast(media.some(m => m.type === 'video') ? 'Shared — it also appears in Reels' : 'Shared to your profile');
      pop();
      stack[0].show?.('home');
      reloadHome();
      stack[0].reload?.('profile');
      stack[0].reload?.('reels');
    } catch (e) { fail(e); shareBtn.disabled = false; shareBtn.textContent = 'Share'; }
  };
  paintMode();
  return { el: root, onDestroy: () => pauseAllVideos(root) };
}

// Pick several people (used for photo tags and new group chats).
function pickPeople(title, selected = [], { doneLabel = 'Done' } = {}) {
  return new Promise(async resolve => {
    let chosen = [...selected];
    const content = el(`<div><div class="chips sel" style="padding:8px 14px 0"></div>
      <div class="searchbar">${icon('search')}<input placeholder="Search people" autocapitalize="none"></div><div class="res"></div>
      <div style="padding:10px 14px"><button class="btn primary big" data-done>${esc(doneLabel)}</button></div></div>`);
    const res = $('.res', content);
    const paintSel = () => {
      const s = $('.sel', content); s.innerHTML = '';
      chosen.forEach(u => { const c = el(`<button class="chip">${esc(u.username)} ✕</button>`); c.onclick = () => { chosen = chosen.filter(x => x.id !== u.id); paintSel(); showList(lastList); }; s.appendChild(c); });
    };
    let lastList = [];
    const showList = (people) => {
      lastList = people;
      res.innerHTML = people.length ? '' : '<div class="empty" style="padding:20px">No one found</div>';
      people.filter(u => u && u.id !== state.me.id).forEach(u => {
        const on = chosen.some(c => c.id === u.id);
        const row = el(`<button class="list-item">${avatarImg(u, 's44')}<div class="grow"><div class="uname">${esc(u.username)}</div><div class="sub">${esc(u.full_name)}</div></div><span class="check ${on ? 'on' : ''}">${on ? icon('check') : ''}</span></button>`);
        row.onclick = () => { chosen = on ? chosen.filter(c => c.id !== u.id) : [...chosen, u]; paintSel(); showList(lastList); };
        res.appendChild(row);
      });
    };
    const initial = async () => showList(await api.following(state.me.id).catch(() => []));
    $('input', content).oninput = debounce(async e => { const q = e.target.value.trim(); q ? showList(await api.searchUsers(q)) : initial(); }, 250);
    const s = sheet({ title, content });
    $('[data-done]', content).onclick = () => s.close('done');
    paintSel(); initial();
    const v = await s;
    resolve(v === 'done' ? chosen : selected);
  });
}

// =====================================================================
// Story editor: text, drawing and emoji stickers over a photo (9:16)
// =====================================================================
const STORY_COLORS = ['#ffffff', '#111111', '#f0325a', '#ff8a3d', '#ffd23f', '#3ddc84', '#3d9cff', '#8f3cf2'];
const STORY_STICKERS = ['😍', '😂', '🔥', '❤️', '✨', '🎉', '😎', '🥳', '👏', '🙌', '💯', '🌅', '☀️', '🌈', '🍕', '☕', '🏔️', '🌊', '🐶', '🐱', '🌸', '⭐', '📍', '🎶', '💪', '😴', '🤔', '👀', '🙏', '✌️'];

function StoryEditor(img) {
  const root = el(`<div class="story-editor">
    <div class="se-top">
      <button class="iconbtn" data-back aria-label="Back">${icon('back')}</button><span style="flex:1"></span>
      <button class="iconbtn" data-undo aria-label="Undo drawing" hidden>${icon('undo')}</button>
      <button class="iconbtn" data-text aria-label="Add text">${icon('text')}</button>
      <button class="iconbtn" data-draw aria-label="Draw">${icon('pen')}</button>
      <button class="iconbtn" data-sticker aria-label="Add sticker">${icon('smile')}</button>
    </div>
    <div class="se-stage-wrap"><div class="se-stage">
      <canvas class="se-bg"></canvas><canvas class="se-draw"></canvas><div class="se-layer"></div>
      <button class="se-trash" hidden aria-label="Delete">${icon('trash')}</button>
    </div></div>
    <div class="se-colors" hidden></div>
    <div class="se-bottom"><span class="sub" style="color:#ccc">Drag text and stickers to move them. Tap text to edit.</span><button class="btn primary" data-share>Share to story</button></div>
  </div>`);
  wireBack(root);
  const stageEl = $('.se-stage', root), bg = $('.se-bg', root), draw = $('.se-draw', root), layer = $('.se-layer', root), colors = $('.se-colors', root);
  const W = 1080, H = 1920;
  bg.width = draw.width = W; bg.height = draw.height = H;
  // Background: photo fills the frame (cover crop).
  {
    const ctx = bg.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    const w = img.naturalWidth * s, h = img.naturalHeight * s;
    ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
  }
  let drawing = false, penColor = STORY_COLORS[2], strokes = [], current = null, selected = null;
  const dctx = draw.getContext('2d');
  function redraw() {
    dctx.clearRect(0, 0, W, H);
    dctx.lineCap = dctx.lineJoin = 'round';
    strokes.forEach(s => { dctx.strokeStyle = s.color; dctx.lineWidth = s.width; dctx.beginPath(); s.pts.forEach((p, i) => i ? dctx.lineTo(p[0], p[1]) : dctx.moveTo(p[0], p[1])); dctx.stroke(); });
    $('[data-undo]', root).hidden = !strokes.length;
  }
  const toCanvas = e => { const r = draw.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H]; };
  draw.addEventListener('pointerdown', e => { if (!drawing) return; draw.setPointerCapture(e.pointerId); current = { color: penColor, width: 14, pts: [toCanvas(e)] }; strokes.push(current); });
  draw.addEventListener('pointermove', e => { if (!drawing || !current) return; current.pts.push(toCanvas(e)); redraw(); });
  draw.addEventListener('pointerup', () => { current = null; });
  $('[data-undo]', root).onclick = () => { strokes.pop(); redraw(); };

  function paintColors(onPick, active) {
    colors.innerHTML = '';
    STORY_COLORS.forEach(c => {
      const b = el(`<button class="sw ${c === active ? 'on' : ''}" style="background:${c}" aria-label="Color ${c}"></button>`);
      b.onclick = () => { onPick(c); paintColors(onPick, c); };
      colors.appendChild(b);
    });
  }
  $('[data-draw]', root).onclick = () => {
    drawing = !drawing;
    $('[data-draw]', root).classList.toggle('active', drawing);
    draw.style.pointerEvents = drawing ? 'auto' : 'none';
    layer.style.pointerEvents = drawing ? 'none' : 'auto';
    if (drawing) { selected = null; sizeBar(false); }
    colors.hidden = !drawing;
    if (drawing) paintColors(c => penColor = c, penColor);
  };

  // Text and stickers are positioned in % of the frame so they export at any size.
  function addItem(item) {
    const n = el(`<div class="se-item"></div>`);
    n._item = item;
    layer.appendChild(n);
    paintItem(n);
    makeDraggable(n);
    return n;
  }
  function paintItem(n) {
    const it = n._item;
    n.style.left = it.x + '%'; n.style.top = it.y + '%';
    n.style.fontSize = (it.size * stageEl.clientWidth / W) + 'px';
    if (it.kind === 'text') {
      n.textContent = it.text;
      n.style.color = it.color; n.style.fontFamily = it.font;
      n.classList.toggle('boxed', it.boxed);
      n.style.background = it.boxed ? (it.color === '#ffffff' ? '#111' : '#fff') : 'transparent';
    } else n.textContent = it.text;
  }
  function makeDraggable(n) {
    let sx, sy, ox, oy, moved = false, pid = null;
    n.addEventListener('pointerdown', e => {
      if (drawing) return;
      e.stopPropagation(); pid = e.pointerId; n.setPointerCapture(pid);
      sx = e.clientX; sy = e.clientY; ox = n._item.x; oy = n._item.y; moved = false;
      selected = n; $('.se-trash', root).hidden = false; sizeBar(true);
    });
    n.addEventListener('pointermove', e => {
      if (e.pointerId !== pid) return;
      const dx = (e.clientX - sx) / stageEl.clientWidth * 100, dy = (e.clientY - sy) / stageEl.clientHeight * 100;
      if (Math.abs(dx) + Math.abs(dy) > 1) moved = true;
      n._item.x = Math.max(-10, Math.min(110, ox + dx)); n._item.y = Math.max(-5, Math.min(105, oy + dy));
      paintItem(n);
      const t = $('.se-trash', root).getBoundingClientRect();
      $('.se-trash', root).classList.toggle('hot', e.clientX > t.left - 20 && e.clientX < t.right + 20 && e.clientY > t.top - 20);
    });
    n.addEventListener('pointerup', e => {
      if (e.pointerId !== pid) return; pid = null;
      if ($('.se-trash', root).classList.contains('hot')) { n.remove(); selected = null; sizeBar(false); }
      $('.se-trash', root).classList.remove('hot');
      if (!moved && n._item.kind === 'text') editText(n);
    });
  }
  function sizeBar(on) {
    let bar = $('.se-size', root);
    if (!on) { bar?.remove(); $('.se-trash', root).hidden = true; return; }
    if (!bar) {
      bar = el(`<div class="se-size"><button aria-label="Smaller">A−</button><button aria-label="Bigger">A+</button><button data-del aria-label="Delete">${icon('trash')}</button></div>`);
      $('.se-stage-wrap', root).appendChild(bar);
      const [smaller, bigger, del] = $$('button', bar);
      smaller.onclick = () => { if (selected) { selected._item.size = Math.max(36, selected._item.size * 0.85); paintItem(selected); } };
      bigger.onclick = () => { if (selected) { selected._item.size = Math.min(400, selected._item.size * 1.18); paintItem(selected); } };
      del.onclick = () => { selected?.remove(); selected = null; sizeBar(false); };
    }
  }
  layer.addEventListener('pointerdown', e => { if (e.target === layer) { selected = null; sizeBar(false); } });

  function editText(existing) {
    const it = existing ? { ...existing._item } : { kind: 'text', text: '', x: 50, y: 45, size: 84, color: '#ffffff', font: 'Roboto, system-ui, sans-serif', boxed: false };
    const ov = el(`<div class="se-textedit">
      <div class="row" style="justify-content:space-between;align-items:center;padding:10px 12px">
        <button class="btn" data-font>Aa</button><button class="btn" data-box>Background</button><button class="btn primary" data-ok>Done</button></div>
      <textarea placeholder="Type something…" maxlength="200"></textarea>
      <div class="se-colors"></div></div>`);
    const ta = $('textarea', ov);
    ta.value = it.text;
    const paint = () => { ta.style.color = it.color; ta.style.fontFamily = it.font; ta.style.background = it.boxed ? (it.color === '#ffffff' ? '#111' : '#fff') : 'transparent'; };
    const fonts = ['Roboto, system-ui, sans-serif', '"Pacifico", cursive', 'Georgia, serif', '"Courier New", monospace'];
    $('[data-font]', ov).onclick = () => { it.font = fonts[(fonts.indexOf(it.font) + 1) % fonts.length]; paint(); };
    $('[data-box]', ov).onclick = () => { it.boxed = !it.boxed; paint(); };
    const cl = $('.se-colors', ov);
    const pc = active => { cl.innerHTML = ''; STORY_COLORS.forEach(c => { const b = el(`<button class="sw ${c === active ? 'on' : ''}" style="background:${c}" aria-label="Color"></button>`); b.onclick = () => { it.color = c; paint(); pc(c); }; cl.appendChild(b); }); };
    pc(it.color);
    const finish = () => {
      ov.remove(); overlays.splice(overlays.indexOf(entry), 1);
      it.text = ta.value.trim();
      if (existing) { if (!it.text) existing.remove(); else { existing._item = it; paintItem(existing); } }
      else if (it.text) addItem(it);
    };
    const entry = { close: finish };
    overlays.push(entry);
    $('[data-ok]', ov).onclick = finish;
    root.appendChild(ov);
    paint();
    setTimeout(() => ta.focus(), 50);
  }
  $('[data-text]', root).onclick = () => { if (drawing) $('[data-draw]', root).click(); editText(null); };
  $('[data-sticker]', root).onclick = async () => {
    if (drawing) $('[data-draw]', root).click();
    const grid = el(`<div class="sticker-grid">${STORY_STICKERS.map(s => `<button>${s}</button>`).join('')}</div>`);
    const s = sheet({ title: 'Stickers', content: grid });
    $$('button', grid).forEach(b => b.onclick = () => { addItem({ kind: 'sticker', text: b.textContent, x: 50, y: 40, size: 200 }); s.close(null); });
  };

  function exportCanvas() {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.drawImage(bg, 0, 0); ctx.drawImage(draw, 0, 0);
    $$('.se-item', layer).forEach(n => {
      const it = n._item;
      const x = it.x / 100 * W, y = it.y / 100 * H;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (it.kind === 'sticker') { ctx.font = `${it.size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`; ctx.fillText(it.text, x, y); return; }
      ctx.font = `700 ${it.size}px ${it.font}`;
      const lines = it.text.split('\n'), lh = it.size * 1.2;
      const width = Math.max(...lines.map(l => ctx.measureText(l).width));
      const top = y - (lines.length - 1) * lh / 2;
      if (it.boxed) {
        ctx.fillStyle = it.color === '#ffffff' ? '#111' : '#fff';
        const pad = it.size * 0.35, r = it.size * 0.3;
        const bx = x - width / 2 - pad, by = top - lh / 2 - pad * 0.4, bw = width + pad * 2, bh = lines.length * lh + pad * 0.8;
        ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, bw, bh, r) : ctx.rect(bx, by, bw, bh); ctx.fill();
      } else { ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = it.size * 0.12; }
      ctx.fillStyle = it.color;
      lines.forEach((l, i) => ctx.fillText(l, x, top + i * lh));
      ctx.shadowBlur = 0;
    });
    return c;
  }
  $('[data-share]', root).onclick = async () => {
    const btn = $('[data-share]', root); btn.disabled = true; btn.textContent = 'Sharing…';
    try {
      const url = await api.uploadImage(await canvasToBlob(exportCanvas(), 0.86));
      await api.addStory(url);
      toast('Added to your story');
      while (stack.length > 1) pop();
      reloadHome();
    } catch (e) { fail(e); btn.disabled = false; btn.textContent = 'Share to story'; }
  };
  const onResize = () => $$('.se-item', layer).forEach(paintItem);
  window.addEventListener('resize', onResize);
  return { el: root, onShow: () => requestAnimationFrame(onResize), onDestroy: () => window.removeEventListener('resize', onResize) };
}
