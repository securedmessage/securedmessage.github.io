// Mosaic — demo backend. Everything lives in this device's local storage so the
// app can be tried with no server. Sample accounts post, follow and reply to DMs.
'use strict';

class Emitter {
  constructor() { this.h = {}; }
  on(ev, fn) { (this.h[ev] ||= new Set()).add(fn); return () => this.h[ev].delete(fn); }
  emit(ev, data) { (this.h[ev] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); }
}

const DEMO_KEY = 'mosaic_demo_v1';
const DEMO_SESSION = 'mosaic_demo_session';

const DEMO_PEOPLE = [
  ['maya.lens', 'Maya Torres', 'Chasing golden hour 🌅 | film + digital', ['Golden hour never misses', 'Took the long way home today', 'Colors of the weekend', 'Found this on my morning walk']],
  ['dev.k', 'Devon Kim', 'Coffee, code, cycling. In that order.', ['New desk setup finally done', 'Sunday ride ✔️ 42 miles', 'Abstract mood']],
  ['priya.cooks', 'Priya Shah', 'Home cook. Spice collector. Recipes in DMs 🍛', ['Experimenting with color again', 'Weeknight dinner energy', 'Farmers market haul']],
  ['the.jonas', 'Jonas Becker', 'Architecture nerd 🏛️ Berlin → Chicago', ['Lines and light', 'Geometry everywhere you look', 'City shapes']],
  ['lila.draws', 'Lila Moreau', 'Illustrator ✏️ commissions open', ['Work in progress — thoughts?', 'Palette study #12', 'Late night sketch session', 'Trying a new style']],
  ['sam.outdoors', 'Sam Okafor', 'Trails > treadmills 🏔️', ['Summit views', 'Lake was glass this morning', 'Camp setup at dusk']],
];
const DEMO_REPLIES = [
  "Haha love that 😄", "No way! Tell me more", "That's awesome 🙌", "Totally agree", "Sounds good to me!",
  "Ooh, when?", "Ha, I was just thinking the same thing", "Sending good vibes ✨", "Let's do it 🔥", "Wait really?? 😮",
  "That made my day", "Same here honestly", "100%", "I'm in 👍",
];
const DEMO_COMMENTS = ['Stunning 😍', 'These colors!!', 'Love this', 'Wow 🔥', 'Frame-worthy', 'Need this as a wallpaper', 'So good', 'Obsessed 👏'];

class DemoAPI extends Emitter {
  constructor() {
    super();
    this.mode = 'demo';
    this.db = this._load();
    this.userId = store.getItem(DEMO_SESSION);
    if (this.userId && !this.db.profiles.find(p => p.id === this.userId)) this.userId = null;
  }
  _load() {
    try { const d = JSON.parse(store.getItem(DEMO_KEY)); if (d && d.v === 1) return d; } catch {}
    return this._seed();
  }
  _save() {
    try { store.setItem(DEMO_KEY, JSON.stringify(this.db)); }
    catch (e) { console.warn('Demo storage full', e); throw new Error('Device storage is full. Remove some posts or reset demo data in Settings.'); }
  }
  _seed() {
    const now = Date.now(), H = 3600e3;
    const db = { v: 1, accounts: [], profiles: [], posts: [], likes: [], saves: [], comments: [], follows: [], stories: [], notifications: [],
      conversations: [], members: [], messages: [], reactions: [] };
    const ids = DEMO_PEOPLE.map(() => uid());
    DEMO_PEOPLE.forEach(([username, full_name, bio, captions], i) => {
      db.profiles.push({ id: ids[i], username, full_name, bio, avatar_url: '', created_at: new Date(now - 400 * 86400e3).toISOString(), bot: true });
      captions.forEach((caption, j) => {
        const pid = uid();
        db.posts.push({ id: pid, user_id: ids[i], image_url: demoArt(username + j), caption, created_at: new Date(now - (i * 7 + j * 19 + 2) * H).toISOString() });
        ids.forEach((u, k) => { if (k !== i && (hashStr(pid + u) % 3)) db.likes.push({ post_id: pid, user_id: u, created_at: new Date(now - H).toISOString() }); });
        const commenter = ids[(i + j + 1) % ids.length];
        db.comments.push({ id: uid(), post_id: pid, user_id: commenter, body: DEMO_COMMENTS[(i + j) % DEMO_COMMENTS.length], created_at: new Date(now - (i * 7 + j * 19 + 1) * H).toISOString() });
      });
      ids.forEach((u, k) => { if (k !== i && (k + i) % 2) db.follows.push({ follower_id: ids[i], following_id: u, created_at: new Date(now - 100 * H).toISOString() }); });
      if (i % 2 === 0 || i === 3) for (let s = 0; s < 1 + (i % 3); s++)
        db.stories.push({ id: uid(), user_id: ids[i], image_url: demoArt(username + 'story' + s, 1080, 1920), created_at: new Date(now - (s * 3 + i + 1) * H).toISOString() });
    });
    store.setItem(DEMO_KEY, JSON.stringify(db));
    return db;
  }
  reset() { store.removeItem(DEMO_KEY); store.removeItem(DEMO_SESSION); this.db = this._seed(); this.userId = null; }

  // ---------- helpers ----------
  _p(id) { return this.db.profiles.find(p => p.id === id); }
  _pub(p) { return p && { id: p.id, username: p.username, full_name: p.full_name, bio: p.bio, avatar_url: p.avatar_url }; }
  _enrichPost(p) {
    return { ...p, author: this._pub(this._p(p.user_id)),
      like_count: this.db.likes.filter(l => l.post_id === p.id).length,
      comment_count: this.db.comments.filter(c => c.post_id === p.id).length,
      liked: this.db.likes.some(l => l.post_id === p.id && l.user_id === this.userId),
      saved: this.db.saves.some(s => s.post_id === p.id && s.user_id === this.userId) };
  }
  _notify(user_id, actor_id, type, extra = {}) {
    if (user_id === actor_id) return;
    const n = { id: uid(), user_id, actor_id, type, post_id: extra.post_id || null, body: extra.body || null, read: false, created_at: new Date().toISOString() };
    this.db.notifications.push(n);
    if (user_id === this.userId) this.emit('notification', n);
  }
  _bots() { return this.db.profiles.filter(p => p.bot); }
  _sorted(arr) { return [...arr].sort((a, b) => b.created_at.localeCompare(a.created_at)); }
  _delay(ms = 120) { return new Promise(r => setTimeout(r, ms)); }

  // ---------- auth ----------
  async session() { return this.userId ? this._pub(this._p(this.userId)) : null; }
  async signUp(email, password, username, full_name) {
    await this._delay();
    email = email.trim().toLowerCase(); username = username.trim().toLowerCase();
    if (!/^[a-z0-9._]{3,30}$/.test(username)) throw new Error('Usernames are 3–30 letters, numbers, periods or underscores.');
    if (password.length < 6) throw new Error('Password must be at least 6 characters.');
    if (this.db.accounts.some(a => a.email === email)) throw new Error('An account with that email already exists.');
    if (this.db.profiles.some(p => p.username === username)) throw new Error('That username is taken.');
    const id = uid();
    this.db.accounts.push({ id, email, password });
    this.db.profiles.push({ id, username, full_name: full_name.trim(), bio: '', avatar_url: '', created_at: new Date().toISOString() });
    // Start the new account off following everyone, with a few followers and a welcome chat.
    const bots = this._bots();
    bots.forEach((b, i) => {
      this.db.follows.push({ follower_id: id, following_id: b.id, created_at: new Date().toISOString() });
      if (i < 4) this.db.follows.push({ follower_id: b.id, following_id: id, created_at: new Date(Date.now() - i * 60e3).toISOString() });
    });
    this.userId = id;
    bots.slice(0, 3).forEach((b, i) => this._notify(id, b.id, 'follow'));
    const conv = this._ensureDM(id, bots[0].id);
    this._insertMsg(conv, bots[0].id, { body: `Hey ${full_name.split(' ')[0] || username}! Welcome to Mosaic 👋 Send me a message — I'll reply.` }, Date.now() - 5000);
    this._save();
    store.setItem(DEMO_SESSION, id);
    return this._pub(this._p(id));
  }
  async signIn(email, password) {
    await this._delay();
    const a = this.db.accounts.find(a => a.email === email.trim().toLowerCase());
    if (!a || a.password !== password) throw new Error('Incorrect email or password.');
    this.userId = a.id; store.setItem(DEMO_SESSION, a.id);
    return this._pub(this._p(a.id));
  }
  async signOut() { this.userId = null; store.removeItem(DEMO_SESSION); }

  // ---------- profiles ----------
  async getProfile(id) { return this._pub(this._p(id)); }
  async getProfileByUsername(u) { return this._pub(this.db.profiles.find(p => p.username === String(u).toLowerCase())); }
  async updateProfile(f) {
    const p = this._p(this.userId);
    if (f.username != null) {
      const u = f.username.trim().toLowerCase();
      if (!/^[a-z0-9._]{3,30}$/.test(u)) throw new Error('Usernames are 3–30 letters, numbers, periods or underscores.');
      if (this.db.profiles.some(x => x.username === u && x.id !== p.id)) throw new Error('That username is taken.');
      p.username = u;
    }
    ['full_name', 'bio', 'avatar_url'].forEach(k => { if (f[k] != null) p[k] = f[k]; });
    this._save();
    return this._pub(p);
  }
  async uploadImage(blob) {
    const c = renderImage(await loadImage(URL.createObjectURL(blob)), { max: 720 });
    return c.toDataURL('image/jpeg', 0.72);
  }
  async searchUsers(q) {
    q = q.trim().toLowerCase().replace(/^@/, '');
    if (!q) return [];
    return this.db.profiles.filter(p => p.username.includes(q) || p.full_name.toLowerCase().includes(q)).slice(0, 30).map(p => this._pub(p));
  }
  async suggestedUsers() {
    const f = new Set(this.db.follows.filter(x => x.follower_id === this.userId).map(x => x.following_id));
    return this.db.profiles.filter(p => p.id !== this.userId && !f.has(p.id)).slice(0, 10).map(p => this._pub(p));
  }
  async stats(id) {
    return { posts: this.db.posts.filter(p => p.user_id === id).length,
      followers: this.db.follows.filter(f => f.following_id === id).length,
      following: this.db.follows.filter(f => f.follower_id === id).length };
  }
  async isFollowing(id) { return this.db.follows.some(f => f.follower_id === this.userId && f.following_id === id); }
  async followsMe(id) { return this.db.follows.some(f => f.follower_id === id && f.following_id === this.userId); }
  async follow(id) {
    if (await this.isFollowing(id)) return;
    this.db.follows.push({ follower_id: this.userId, following_id: id, created_at: new Date().toISOString() });
    this._notify(id, this.userId, 'follow');
    this._save();
    const bot = this._p(id);
    if (bot?.bot && !(await this.followsMe(id))) setTimeout(() => {
      this.db.follows.push({ follower_id: id, following_id: this.userId, created_at: new Date().toISOString() });
      this._notify(this.userId, id, 'follow'); this._save();
    }, 4000);
  }
  async unfollow(id) { this.db.follows = this.db.follows.filter(f => !(f.follower_id === this.userId && f.following_id === id)); this._save(); }
  async followers(id) { return this.db.follows.filter(f => f.following_id === id).map(f => this._pub(this._p(f.follower_id))).filter(Boolean); }
  async following(id) { return this.db.follows.filter(f => f.follower_id === id).map(f => this._pub(this._p(f.following_id))).filter(Boolean); }

  // ---------- posts ----------
  async feed() {
    await this._delay(80);
    const ids = new Set([this.userId, ...this.db.follows.filter(f => f.follower_id === this.userId).map(f => f.following_id)]);
    return this._sorted(this.db.posts.filter(p => ids.has(p.user_id))).slice(0, 60).map(p => this._enrichPost(p));
  }
  async explore() { return this._sorted(this.db.posts.filter(p => p.user_id !== this.userId)).slice(0, 60).map(p => this._enrichPost(p)); }
  async userPosts(id) { return this._sorted(this.db.posts.filter(p => p.user_id === id)).map(p => this._enrichPost(p)); }
  async savedPosts() {
    const s = this._sorted(this.db.saves.filter(x => x.user_id === this.userId));
    return s.map(x => this.db.posts.find(p => p.id === x.post_id)).filter(Boolean).map(p => this._enrichPost(p));
  }
  async getPost(id) { const p = this.db.posts.find(p => p.id === id); return p ? this._enrichPost(p) : null; }
  async createPost(image_url, caption) {
    const p = { id: uid(), user_id: this.userId, image_url, caption, created_at: new Date().toISOString() };
    this.db.posts.push(p); this._save();
    // Sample accounts react to new posts after a moment.
    this._bots().slice(0, 4).forEach((b, i) => setTimeout(() => {
      if (!this.db.posts.find(x => x.id === p.id)) return;
      this.db.likes.push({ post_id: p.id, user_id: b.id, created_at: new Date().toISOString() });
      this._notify(this.userId, b.id, 'like', { post_id: p.id });
      if (i === 1) {
        const body = DEMO_COMMENTS[Math.floor(Math.random() * DEMO_COMMENTS.length)];
        this.db.comments.push({ id: uid(), post_id: p.id, user_id: b.id, body, created_at: new Date().toISOString() });
        this._notify(this.userId, b.id, 'comment', { post_id: p.id, body });
      }
      this._save();
    }, 3000 + i * 2500));
    return this._enrichPost(p);
  }
  async deletePost(id) {
    this.db.posts = this.db.posts.filter(p => p.id !== id);
    ['likes', 'saves', 'comments'].forEach(t => this.db[t] = this.db[t].filter(x => x.post_id !== id));
    this.db.notifications = this.db.notifications.filter(n => n.post_id !== id);
    this._save();
  }
  async like(id) {
    if (this.db.likes.some(l => l.post_id === id && l.user_id === this.userId)) return;
    this.db.likes.push({ post_id: id, user_id: this.userId, created_at: new Date().toISOString() });
    const p = this.db.posts.find(p => p.id === id); if (p) this._notify(p.user_id, this.userId, 'like', { post_id: id });
    this._save();
  }
  async unlike(id) { this.db.likes = this.db.likes.filter(l => !(l.post_id === id && l.user_id === this.userId)); this._save(); }
  async likers(id) { return this.db.likes.filter(l => l.post_id === id).map(l => this._pub(this._p(l.user_id))).filter(Boolean); }
  async save(id) { if (!this.db.saves.some(s => s.post_id === id && s.user_id === this.userId)) { this.db.saves.push({ post_id: id, user_id: this.userId, created_at: new Date().toISOString() }); this._save(); } }
  async unsave(id) { this.db.saves = this.db.saves.filter(s => !(s.post_id === id && s.user_id === this.userId)); this._save(); }
  async comments(postId) {
    return this.db.comments.filter(c => c.post_id === postId).sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map(c => ({ ...c, author: this._pub(this._p(c.user_id)) }));
  }
  async addComment(postId, body) {
    const c = { id: uid(), post_id: postId, user_id: this.userId, body, created_at: new Date().toISOString() };
    this.db.comments.push(c);
    const p = this.db.posts.find(p => p.id === postId); if (p) this._notify(p.user_id, this.userId, 'comment', { post_id: postId, body });
    this._save();
    return { ...c, author: this._pub(this._p(this.userId)) };
  }
  async deleteComment(id) { this.db.comments = this.db.comments.filter(c => c.id !== id); this._save(); }

  // ---------- stories ----------
  async stories() {
    const since = Date.now() - 24 * 3600e3;
    const ids = [this.userId, ...this.db.follows.filter(f => f.follower_id === this.userId).map(f => f.following_id)];
    const groups = [];
    ids.forEach(id => {
      const items = this.db.stories.filter(s => s.user_id === id && new Date(s.created_at).getTime() > since).sort((a, b) => a.created_at.localeCompare(b.created_at));
      if (items.length) groups.push({ user: this._pub(this._p(id)), items });
    });
    return groups;
  }
  async addStory(image_url) {
    const s = { id: uid(), user_id: this.userId, image_url, created_at: new Date().toISOString() };
    this.db.stories.push(s); this._save(); return s;
  }
  async deleteStory(id) { this.db.stories = this.db.stories.filter(s => s.id !== id); this._save(); }

  // ---------- notifications ----------
  async notifications() {
    return this._sorted(this.db.notifications.filter(n => n.user_id === this.userId)).slice(0, 100).map(n => {
      const post = n.post_id && this.db.posts.find(p => p.id === n.post_id);
      return { ...n, actor: this._pub(this._p(n.actor_id)), post_image: post ? post.image_url : null };
    });
  }
  async unreadNotifications() { return this.db.notifications.filter(n => n.user_id === this.userId && !n.read).length; }
  async markNotificationsRead() { this.db.notifications.forEach(n => { if (n.user_id === this.userId) n.read = true; }); this._save(); }

  // ---------- messaging ----------
  _ensureDM(a, b) {
    const mine = new Set(this.db.members.filter(m => m.user_id === a).map(m => m.conversation_id));
    const found = this.db.members.find(m => m.user_id === b && mine.has(m.conversation_id));
    if (found) return found.conversation_id;
    const id = uid(), t = new Date().toISOString();
    this.db.conversations.push({ id, created_at: t, updated_at: t, last_message: '', last_sender_id: null });
    this.db.members.push({ conversation_id: id, user_id: a, last_read_at: t }, { conversation_id: id, user_id: b, last_read_at: t });
    return id;
  }
  _preview(m) { return m.body ? m.body : m.post_id ? 'Shared a post' : m.story_url ? 'Replied to a story' : m.image_url ? 'Sent a photo' : ''; }
  _insertMsg(convId, sender, f, at = Date.now()) {
    const m = { id: uid(), conversation_id: convId, sender_id: sender, body: f.body || null, image_url: f.image_url || null, post_id: f.post_id || null,
      story_url: f.story_url || null, created_at: new Date(at).toISOString() };
    this.db.messages.push(m);
    const c = this.db.conversations.find(c => c.id === convId);
    c.updated_at = m.created_at; c.last_message = this._preview(m); c.last_sender_id = sender;
    const mem = this.db.members.find(x => x.conversation_id === convId && x.user_id === sender);
    if (mem) mem.last_read_at = m.created_at;
    return m;
  }
  _enrichMsg(m) {
    const out = { ...m, hearts: this.db.reactions.filter(r => r.message_id === m.id).map(r => r.user_id) };
    if (m.post_id) { const p = this.db.posts.find(p => p.id === m.post_id); out.post = p ? { id: p.id, image_url: p.image_url, caption: p.caption, author: this._pub(this._p(p.user_id)) } : null; }
    return out;
  }
  async conversations() {
    const mine = this.db.members.filter(m => m.user_id === this.userId);
    return mine.map(mm => {
      const c = this.db.conversations.find(c => c.id === mm.conversation_id);
      const other = this.db.members.find(m => m.conversation_id === c.id && m.user_id !== this.userId);
      return { id: c.id, other: this._pub(this._p(other.user_id)), last_message: c.last_message, last_sender_id: c.last_sender_id,
        updated_at: c.updated_at, unread: c.last_sender_id && c.last_sender_id !== this.userId && c.updated_at > mm.last_read_at,
        other_last_read: other.last_read_at };
    }).filter(c => c.last_message).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
  async conversation(id) {
    const other = this.db.members.find(m => m.conversation_id === id && m.user_id !== this.userId);
    return other && { id, other: this._pub(this._p(other.user_id)), other_last_read: other.last_read_at };
  }
  async unreadChats() { return (await this.conversations()).filter(c => c.unread).length; }
  async openDM(userId) { const id = this._ensureDM(this.userId, userId); this._save(); return id; }
  async messages(convId) {
    return this.db.messages.filter(m => m.conversation_id === convId).sort((a, b) => a.created_at.localeCompare(b.created_at)).map(m => this._enrichMsg(m));
  }
  async sendMessage(convId, f) {
    const m = this._insertMsg(convId, this.userId, f);
    this._save();
    const out = this._enrichMsg(m);
    this.emit('message', out);
    this._botReply(convId);
    return out;
  }
  _botReply(convId) {
    const other = this.db.members.find(m => m.conversation_id === convId && m.user_id !== this.userId);
    const bot = other && this._p(other.user_id);
    if (!bot?.bot) return;
    clearTimeout(this._replyT?.[convId]); this._replyT ||= {};
    this._replyT[convId] = setTimeout(() => {
      const at = new Date().toISOString();
      other.last_read_at = at; this._save();
      this.emit('read', { conversation_id: convId, user_id: bot.id, at });
      setTimeout(() => {
        this.emit('typing', { conversation_id: convId, user_id: bot.id });
        setTimeout(() => {
          const last = this.db.messages.filter(m => m.conversation_id === convId && m.sender_id === this.userId).pop();
          if (last && Math.random() < 0.35) {
            this.db.reactions.push({ message_id: last.id, user_id: bot.id });
            this.emit('reaction', { message_id: last.id, conversation_id: convId, user_id: bot.id, on: true });
          }
          const m = this._insertMsg(convId, bot.id, { body: DEMO_REPLIES[Math.floor(Math.random() * DEMO_REPLIES.length)] });
          this._save();
          this.emit('message', this._enrichMsg(m));
        }, 1800);
      }, 700);
    }, 1200);
  }
  async deleteMessage(id) {
    const m = this.db.messages.find(m => m.id === id);
    if (!m || m.sender_id !== this.userId) return;
    this.db.messages = this.db.messages.filter(x => x.id !== id);
    this.db.reactions = this.db.reactions.filter(r => r.message_id !== id);
    const c = this.db.conversations.find(c => c.id === m.conversation_id);
    const last = this.db.messages.filter(x => x.conversation_id === c.id).sort((a, b) => a.created_at.localeCompare(b.created_at)).pop();
    c.last_message = last ? this._preview(last) : ''; c.last_sender_id = last ? last.sender_id : null;
    this._save();
    this.emit('message_delete', { id, conversation_id: m.conversation_id });
  }
  async toggleHeart(messageId, on) {
    this.db.reactions = this.db.reactions.filter(r => !(r.message_id === messageId && r.user_id === this.userId));
    if (on) this.db.reactions.push({ message_id: messageId, user_id: this.userId });
    this._save();
    const m = this.db.messages.find(m => m.id === messageId);
    this.emit('reaction', { message_id: messageId, conversation_id: m?.conversation_id, user_id: this.userId, on });
  }
  async markRead(convId) {
    const m = this.db.members.find(m => m.conversation_id === convId && m.user_id === this.userId);
    if (m) { m.last_read_at = new Date().toISOString(); this._save(); }
  }
  joinChat() { return { typing: () => {}, leave: () => {} }; }
  start() {}
  stop() {}
}
