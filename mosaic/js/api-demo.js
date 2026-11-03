// Mosaic — demo backend. Everything lives in this device's local storage so the
// app can be tried with no server. Sample accounts post, follow and reply to DMs.
'use strict';

class Emitter {
  constructor() { this.h = {}; }
  on(ev, fn) { (this.h[ev] ||= new Set()).add(fn); return () => this.h[ev].delete(fn); }
  emit(ev, data) { (this.h[ev] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); }
}

const DEMO_KEY = 'mosaic_demo_v2';
const DEMO_SESSION = 'mosaic_demo_session';

const DEMO_PEOPLE = [
  ['maya.lens', 'Maya Torres', 'Chasing golden hour 🌅 | film + digital', ['Golden hour never misses #sunset', 'Took the long way home today', 'Colors of the weekend #weekend', 'Found this on my morning walk']],
  ['dev.k', 'Devon Kim', 'Coffee, code, cycling. In that order.', ['New desk setup finally done', 'Sunday ride ✔️ 42 miles #cycling', 'Abstract mood']],
  ['priya.cooks', 'Priya Shah', 'Home cook. Spice collector. Recipes in DMs 🍛', ['Experimenting with color again', 'Weeknight dinner energy #food', 'Farmers market haul #weekend']],
  ['the.jonas', 'Jonas Becker', 'Architecture nerd 🏛️ Berlin → Chicago', ['Lines and light', 'Geometry everywhere you look', 'City shapes']],
  ['lila.draws', 'Lila Moreau', 'Illustrator ✏️ commissions open', ['Work in progress — thoughts? #art', 'Palette study #12 #art', 'Late night sketch session', 'Trying a new style']],
  ['sam.outdoors', 'Sam Okafor', 'Trails > treadmills 🏔️', ['Summit views #hiking', 'Lake was glass this morning #sunset', 'Camp setup at dusk']],
];
const DEMO_PRIVATE = 'the.jonas';
const DEMO_REPLIES = [
  "Haha love that 😄", "No way! Tell me more", "That's awesome 🙌", "Totally agree", "Sounds good to me!",
  "Ooh, when?", "Ha, I was just thinking the same thing", "Sending good vibes ✨", "Let's do it 🔥", "Wait really?? 😮",
  "That made my day", "Same here honestly", "100%", "I'm in 👍",
];
const DEMO_COMMENTS = ['Stunning 😍', 'These colors!!', 'Love this', 'Wow 🔥', 'Frame-worthy', 'Need this as a wallpaper', 'So good', 'Obsessed 👏'];
const DEMO_EMOJI = ['❤️', '😂', '🔥', '👍', '😮'];

class DemoAPI extends Emitter {
  constructor() {
    super();
    this.mode = 'demo';
    this.blobs = new Map();
    this.db = this._load();
    this.userId = store.getItem(DEMO_SESSION);
    if (this.userId && !this.db.profiles.find(p => p.id === this.userId)) this.userId = null;
  }
  _load() {
    try { const d = JSON.parse(store.getItem(DEMO_KEY)); if (d && d.v === 2) return d; } catch {}
    return this._seed();
  }
  _save() {
    try { store.setItem(DEMO_KEY, JSON.stringify(this.db)); }
    catch (e) { console.warn('Demo storage full', e); throw new Error('Device storage is full. Remove some posts or reset demo data in Settings.'); }
  }
  _seed() {
    const now = Date.now(), H = 3600e3;
    const db = { v: 2, accounts: [], profiles: [], posts: [], likes: [], saves: [], comments: [], comment_likes: [], post_tags: [], follows: [], follow_requests: [],
      blocks: [], reports: [], stories: [], notifications: [], conversations: [], members: [], messages: [], reactions: [] };
    const ids = DEMO_PEOPLE.map(() => uid());
    DEMO_PEOPLE.forEach(([username, full_name, bio, captions], i) => {
      db.profiles.push({ id: ids[i], username, full_name, bio, avatar_url: '', is_private: username === DEMO_PRIVATE, show_activity: true,
        last_seen_at: new Date(now - [0.5, 4, 40, 300, 1.5, 900][i] * 60e3).toISOString(), created_at: new Date(now - 400 * 86400e3).toISOString(), bot: true });
      captions.forEach((caption, j) => {
        const pid = uid();
        const media = [{ type: 'image', url: demoArt(username + j) }];
        if (j === 0) media.push({ type: 'image', url: demoArt(username + j + 'b') }, { type: 'image', url: demoArt(username + j + 'c') });
        db.posts.push({ id: pid, user_id: ids[i], image_url: media[0].url, media, caption, created_at: new Date(now - (i * 7 + j * 19 + 2) * H).toISOString() });
        ids.forEach((u, k) => { if (k !== i && (hashStr(pid + u) % 3)) db.likes.push({ post_id: pid, user_id: u, created_at: new Date(now - H).toISOString() }); });
        const commenter = ids[(i + j + 1) % ids.length];
        const cid = uid();
        db.comments.push({ id: cid, post_id: pid, user_id: commenter, parent_id: null, body: DEMO_COMMENTS[(i + j) % DEMO_COMMENTS.length], created_at: new Date(now - (i * 7 + j * 19 + 1) * H).toISOString() });
        if (j === 0) db.comments.push({ id: uid(), post_id: pid, user_id: ids[i], parent_id: cid, body: `@${DEMO_PEOPLE[(i + j + 1) % ids.length][0]} thank you!`, created_at: new Date(now - (i * 7 + 1) * H + 600e3).toISOString() });
        if (j === 1) db.post_tags.push({ post_id: pid, user_id: ids[(i + 2) % ids.length], created_at: new Date().toISOString() });
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
  _pub(p) { return p && { id: p.id, username: p.username, full_name: p.full_name, bio: p.bio, avatar_url: p.avatar_url, is_private: !!p.is_private, show_activity: p.show_activity !== false, last_seen_at: p.show_activity === false ? null : p.last_seen_at }; }
  _blockedBetween(a, b) { return this.db.blocks.some(x => (x.blocker_id === a && x.blocked_id === b) || (x.blocker_id === b && x.blocked_id === a)); }
  _hasBlockedMe(id) { return this.db.blocks.some(x => x.blocker_id === id && x.blocked_id === this.userId); }
  _canView(owner) {
    if (owner === this.userId) return true;
    if (this._blockedBetween(this.userId, owner)) return false;
    const p = this._p(owner);
    return !p?.is_private || this.db.follows.some(f => f.follower_id === this.userId && f.following_id === owner);
  }
  _vis(posts) { return posts.filter(p => this._canView(p.user_id)); }
  _enrichPost(p) {
    return { ...p, media: p.media?.length ? p.media : [{ type: 'image', url: p.image_url }], author: this._pub(this._p(p.user_id)),
      like_count: this.db.likes.filter(l => l.post_id === p.id).length,
      comment_count: this.db.comments.filter(c => c.post_id === p.id && !this._blockedBetween(this.userId, c.user_id)).length,
      liked: this.db.likes.some(l => l.post_id === p.id && l.user_id === this.userId),
      saved: this.db.saves.some(s => s.post_id === p.id && s.user_id === this.userId),
      tags: this.db.post_tags.filter(t => t.post_id === p.id).map(t => this._pub(this._p(t.user_id))).filter(Boolean) };
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
    this.db.profiles.push({ id, username, full_name: full_name.trim(), bio: '', avatar_url: '', is_private: false, show_activity: true, last_seen_at: new Date().toISOString(), created_at: new Date().toISOString() });
    const bots = this._bots();
    bots.forEach((b, i) => {
      if (!b.is_private) this.db.follows.push({ follower_id: id, following_id: b.id, created_at: new Date().toISOString() });
      if (i < 4) this.db.follows.push({ follower_id: b.id, following_id: id, created_at: new Date(Date.now() - i * 60e3).toISOString() });
    });
    this.userId = id;
    bots.slice(0, 3).forEach(b => this._notify(id, b.id, 'follow'));
    const conv = this._ensureDM(id, bots[0].id);
    this._insertMsg(conv, bots[0].id, { body: `Hey ${full_name.split(' ')[0] || username}! Welcome to Mosaic 👋 Send me a message — I'll reply.` }, Date.now() - 5000);
    const g = this._newConv(true, 'Weekend crew', bots[1].id, [bots[1].id, bots[2].id, bots[5].id, id]);
    this._insertMsg(g, bots[1].id, { body: 'created the group', system: true }, Date.now() - 4000);
    this._insertMsg(g, bots[2].id, { body: 'Who is in for the farmers market Saturday? 🍓' }, Date.now() - 3000);
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

  // ---------- profiles & relationships ----------
  async getProfile(id) { return this._hasBlockedMe(id) ? null : this._pub(this._p(id)); }
  async getProfileByUsername(u) { const p = this.db.profiles.find(p => p.username === String(u).toLowerCase()); return p && !this._hasBlockedMe(p.id) ? this._pub(p) : null; }
  async updateProfile(f) {
    const p = this._p(this.userId);
    if (f.username != null) {
      const u = f.username.trim().toLowerCase();
      if (!/^[a-z0-9._]{3,30}$/.test(u)) throw new Error('Usernames are 3–30 letters, numbers, periods or underscores.');
      if (this.db.profiles.some(x => x.username === u && x.id !== p.id)) throw new Error('That username is taken.');
      p.username = u;
    }
    ['full_name', 'bio', 'avatar_url', 'is_private', 'show_activity'].forEach(k => { if (f[k] != null) p[k] = f[k]; });
    if (f.is_private === false) {
      this.db.follow_requests.filter(r => r.target_id === p.id).forEach(r => this.db.follows.push({ follower_id: r.requester_id, following_id: p.id, created_at: new Date().toISOString() }));
      this.db.follow_requests = this.db.follow_requests.filter(r => r.target_id !== p.id);
    }
    if (p.show_activity === false) p.last_seen_at = null;
    this._save();
    return this._pub(p);
  }
  async uploadFile(blob, ext, contentType) {
    if (contentType.startsWith('image/')) return this.uploadImage(blob);
    // Videos and voice notes are too large for local storage; they last until the page reloads.
    const url = URL.createObjectURL(blob);
    this.blobs.set(url, blob);
    return url;
  }
  async uploadImage(blob) {
    const c = renderImage(await loadImage(URL.createObjectURL(blob)), { max: 720 });
    return c.toDataURL('image/jpeg', 0.72);
  }
  async searchUsers(q) {
    q = q.trim().toLowerCase().replace(/^@/, '');
    if (!q) return [];
    return this.db.profiles.filter(p => p.id !== this.userId && !this._hasBlockedMe(p.id) && (p.username.includes(q) || p.full_name.toLowerCase().includes(q))).slice(0, 30).map(p => this._pub(p));
  }
  async suggestedUsers() {
    const f = new Set(this.db.follows.filter(x => x.follower_id === this.userId).map(x => x.following_id));
    return this.db.profiles.filter(p => p.id !== this.userId && !f.has(p.id) && !this._blockedBetween(this.userId, p.id)).slice(0, 10).map(p => this._pub(p));
  }
  async stats(id) {
    return { posts: this.db.posts.filter(p => p.user_id === id).length,
      followers: this.db.follows.filter(f => f.following_id === id).length,
      following: this.db.follows.filter(f => f.follower_id === id).length };
  }
  async relationship(id) {
    return { following: this.db.follows.some(f => f.follower_id === this.userId && f.following_id === id),
      followsMe: this.db.follows.some(f => f.follower_id === id && f.following_id === this.userId),
      requested: this.db.follow_requests.some(r => r.requester_id === this.userId && r.target_id === id),
      blocked: this.db.blocks.some(b => b.blocker_id === this.userId && b.blocked_id === id) };
  }
  async isFollowing(id) { return (await this.relationship(id)).following; }
  async followsMe(id) { return (await this.relationship(id)).followsMe; }
  async follow(id) {
    const r = await this.relationship(id);
    if (r.following || r.requested) return r.following ? 'following' : 'requested';
    if (this._blockedBetween(this.userId, id)) throw new Error("You can't follow this account.");
    const target = this._p(id);
    if (target.is_private) {
      this.db.follow_requests.push({ requester_id: this.userId, target_id: id, created_at: new Date().toISOString() });
      this._save();
      if (target.bot) setTimeout(() => {
        if (!this.db.follow_requests.some(x => x.requester_id === this.userId && x.target_id === id)) return;
        this.db.follow_requests = this.db.follow_requests.filter(x => !(x.requester_id === this.userId && x.target_id === id));
        this.db.follows.push({ follower_id: this.userId, following_id: id, created_at: new Date().toISOString() });
        this._notify(this.userId, id, 'follow_accept'); this._save();
      }, 5000);
      return 'requested';
    }
    this.db.follows.push({ follower_id: this.userId, following_id: id, created_at: new Date().toISOString() });
    this._notify(id, this.userId, 'follow');
    this._save();
    if (target.bot && !(await this.followsMe(id))) setTimeout(() => {
      this.db.follows.push({ follower_id: id, following_id: this.userId, created_at: new Date().toISOString() });
      this._notify(this.userId, id, 'follow'); this._save();
    }, 4000);
    return 'following';
  }
  async unfollow(id) {
    this.db.follows = this.db.follows.filter(f => !(f.follower_id === this.userId && f.following_id === id));
    this.db.follow_requests = this.db.follow_requests.filter(r => !(r.requester_id === this.userId && r.target_id === id));
    this._save();
  }
  async removeFollower(id) { this.db.follows = this.db.follows.filter(f => !(f.follower_id === id && f.following_id === this.userId)); this._save(); }
  async followRequests() { return this.db.follow_requests.filter(r => r.target_id === this.userId).map(r => this._pub(this._p(r.requester_id))).filter(Boolean); }
  async acceptRequest(id) {
    this.db.follow_requests = this.db.follow_requests.filter(r => !(r.requester_id === id && r.target_id === this.userId));
    this.db.follows.push({ follower_id: id, following_id: this.userId, created_at: new Date().toISOString() });
    this._notify(id, this.userId, 'follow_accept'); this._save();
  }
  async declineRequest(id) { this.db.follow_requests = this.db.follow_requests.filter(r => !(r.requester_id === id && r.target_id === this.userId)); this._save(); }
  async followers(id) { return this._canView(id) ? this.db.follows.filter(f => f.following_id === id).map(f => this._pub(this._p(f.follower_id))).filter(Boolean) : []; }
  async following(id) { return this._canView(id) ? this.db.follows.filter(f => f.follower_id === id).map(f => this._pub(this._p(f.following_id))).filter(Boolean) : []; }
  async block(id) {
    if (!this.db.blocks.some(b => b.blocker_id === this.userId && b.blocked_id === id)) this.db.blocks.push({ blocker_id: this.userId, blocked_id: id, created_at: new Date().toISOString() });
    const me = this.userId;
    this.db.follows = this.db.follows.filter(f => !((f.follower_id === me && f.following_id === id) || (f.follower_id === id && f.following_id === me)));
    this.db.follow_requests = this.db.follow_requests.filter(r => !((r.requester_id === me && r.target_id === id) || (r.requester_id === id && r.target_id === me)));
    this._save();
  }
  async unblock(id) { this.db.blocks = this.db.blocks.filter(b => !(b.blocker_id === this.userId && b.blocked_id === id)); this._save(); }
  async blockedUsers() { return this.db.blocks.filter(b => b.blocker_id === this.userId).map(b => this._pub(this._p(b.blocked_id))).filter(Boolean); }
  async report(kind, target_id, reason, details = '') { this.db.reports.push({ id: uid(), reporter_id: this.userId, kind, target_id, reason, details, created_at: new Date().toISOString() }); this._save(); }
  async touchPresence() { const p = this._p(this.userId); if (p) { p.last_seen_at = p.show_activity === false ? null : new Date().toISOString(); this._save(); } }

  // ---------- posts ----------
  async feed() {
    await this._delay(80);
    const ids = new Set([this.userId, ...this.db.follows.filter(f => f.follower_id === this.userId).map(f => f.following_id)]);
    return this._sorted(this._vis(this.db.posts.filter(p => ids.has(p.user_id)))).slice(0, 60).map(p => this._enrichPost(p));
  }
  async explore() { return this._sorted(this._vis(this.db.posts.filter(p => p.user_id !== this.userId))).slice(0, 60).map(p => this._enrichPost(p)); }
  async reels() { return this._sorted(this._vis(this.db.posts.filter(p => (p.media || []).some(m => m.type === 'video')))).slice(0, 40).map(p => this._enrichPost(p)); }
  async userPosts(id) { return this._sorted(this._vis(this.db.posts.filter(p => p.user_id === id))).map(p => this._enrichPost(p)); }
  async hashtagPosts(tag) {
    tag = tag.replace(/^#/, '').toLowerCase();
    const re = new RegExp(`#${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.])`, 'i');
    return this._sorted(this._vis(this.db.posts.filter(p => re.test(p.caption || '')))).map(p => this._enrichPost(p));
  }
  async taggedPosts(id) {
    const ids = new Set(this.db.post_tags.filter(t => t.user_id === id).map(t => t.post_id));
    return this._sorted(this._vis(this.db.posts.filter(p => ids.has(p.id)))).map(p => this._enrichPost(p));
  }
  async savedPosts() {
    const s = this._sorted(this.db.saves.filter(x => x.user_id === this.userId));
    return this._vis(s.map(x => this.db.posts.find(p => p.id === x.post_id)).filter(Boolean)).map(p => this._enrichPost(p));
  }
  async getPost(id) { const p = this.db.posts.find(p => p.id === id); return p && this._canView(p.user_id) ? this._enrichPost(p) : null; }
  async createPost({ media, caption, tags = [] }) {
    const first = media[0];
    const p = { id: uid(), user_id: this.userId, image_url: first.type === 'video' ? first.poster : first.url, media, caption, created_at: new Date().toISOString() };
    this.db.posts.push(p);
    tags.forEach(user_id => { this.db.post_tags.push({ post_id: p.id, user_id, created_at: p.created_at }); this._notify(user_id, this.userId, 'tag', { post_id: p.id }); });
    this._save();
    this._bots().slice(0, 4).forEach((b, i) => setTimeout(() => {
      if (!this.db.posts.find(x => x.id === p.id)) return;
      this.db.likes.push({ post_id: p.id, user_id: b.id, created_at: new Date().toISOString() });
      this._notify(this.userId, b.id, 'like', { post_id: p.id });
      if (i === 1) {
        const body = DEMO_COMMENTS[Math.floor(Math.random() * DEMO_COMMENTS.length)];
        this.db.comments.push({ id: uid(), post_id: p.id, user_id: b.id, parent_id: null, body, created_at: new Date().toISOString() });
        this._notify(this.userId, b.id, 'comment', { post_id: p.id, body });
      }
      this._save();
    }, 3000 + i * 2500));
    return this._enrichPost(p);
  }
  async updatePost(id, caption) {
    const p = this.db.posts.find(p => p.id === id && p.user_id === this.userId);
    if (!p) throw new Error('You can only edit your own posts.');
    p.caption = caption; this._save();
  }
  async deletePost(id) {
    this.db.posts = this.db.posts.filter(p => p.id !== id);
    const cids = new Set(this.db.comments.filter(c => c.post_id === id).map(c => c.id));
    this.db.comment_likes = this.db.comment_likes.filter(l => !cids.has(l.comment_id));
    ['likes', 'saves', 'comments', 'post_tags'].forEach(t => this.db[t] = this.db[t].filter(x => x.post_id !== id));
    this.db.notifications = this.db.notifications.filter(n => n.post_id !== id);
    this._save();
  }
  async removeTag(postId, userId = this.userId) { this.db.post_tags = this.db.post_tags.filter(t => !(t.post_id === postId && t.user_id === userId)); this._save(); }
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

  // ---------- comments ----------
  async comments(postId) {
    return this.db.comments.filter(c => c.post_id === postId && !this._blockedBetween(this.userId, c.user_id)).sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map(c => ({ ...c, author: this._pub(this._p(c.user_id)),
        like_count: this.db.comment_likes.filter(l => l.comment_id === c.id).length,
        liked: this.db.comment_likes.some(l => l.comment_id === c.id && l.user_id === this.userId) }));
  }
  async addComment(postId, body, parentId = null) {
    const c = { id: uid(), post_id: postId, user_id: this.userId, parent_id: parentId, body, created_at: new Date().toISOString() };
    this.db.comments.push(c);
    const p = this.db.posts.find(p => p.id === postId);
    if (p) this._notify(p.user_id, this.userId, 'comment', { post_id: postId, body });
    const parent = parentId && this.db.comments.find(x => x.id === parentId);
    if (parent && parent.user_id !== p?.user_id) this._notify(parent.user_id, this.userId, 'reply', { post_id: postId, body });
    this._save();
    return { ...c, author: this._pub(this._p(this.userId)), like_count: 0, liked: false };
  }
  async deleteComment(id) {
    const gone = new Set([id, ...this.db.comments.filter(c => c.parent_id === id).map(c => c.id)]);
    this.db.comments = this.db.comments.filter(c => !gone.has(c.id));
    this.db.comment_likes = this.db.comment_likes.filter(l => !gone.has(l.comment_id));
    this._save();
  }
  async likeComment(id) {
    if (this.db.comment_likes.some(l => l.comment_id === id && l.user_id === this.userId)) return;
    this.db.comment_likes.push({ comment_id: id, user_id: this.userId, created_at: new Date().toISOString() });
    const c = this.db.comments.find(c => c.id === id);
    if (c) this._notify(c.user_id, this.userId, 'comment_like', { post_id: c.post_id, body: c.body });
    this._save();
  }
  async unlikeComment(id) { this.db.comment_likes = this.db.comment_likes.filter(l => !(l.comment_id === id && l.user_id === this.userId)); this._save(); }

  // ---------- stories ----------
  async stories() {
    const since = Date.now() - 24 * 3600e3;
    const ids = [this.userId, ...this.db.follows.filter(f => f.follower_id === this.userId).map(f => f.following_id)];
    const groups = [];
    ids.forEach(id => {
      if (!this._canView(id)) return;
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
    return this._sorted(this.db.notifications.filter(n => n.user_id === this.userId && !this._hasBlockedMe(n.actor_id))).slice(0, 100).map(n => {
      const post = n.post_id && this.db.posts.find(p => p.id === n.post_id);
      return { ...n, actor: this._pub(this._p(n.actor_id)), post_image: post ? post.image_url : null };
    });
  }
  async unreadNotifications() { return this.db.notifications.filter(n => n.user_id === this.userId && !n.read).length; }
  async markNotificationsRead() { this.db.notifications.forEach(n => { if (n.user_id === this.userId) n.read = true; }); this._save(); }

  // ---------- messaging ----------
  _newConv(is_group, title, created_by, memberIds) {
    const id = uid(), t = new Date().toISOString();
    this.db.conversations.push({ id, is_group, title, created_by, created_at: t, updated_at: t, last_message: '', last_sender_id: null });
    memberIds.forEach(u => this.db.members.push({ conversation_id: id, user_id: u, last_read_at: t }));
    return id;
  }
  _ensureDM(a, b) {
    const mine = new Set(this.db.members.filter(m => m.user_id === a).map(m => m.conversation_id));
    const found = this.db.members.find(m => m.user_id === b && mine.has(m.conversation_id) && !this.db.conversations.find(c => c.id === m.conversation_id)?.is_group);
    return found ? found.conversation_id : this._newConv(false, '', a, [a, b]);
  }
  _preview(m) {
    if (m.system) return `${this._p(m.sender_id)?.username || 'Someone'} ${m.body}`;
    return m.body ? m.body : m.audio_url ? 'Sent a voice message' : m.post_id ? 'Shared a post' : m.story_url ? 'Replied to a story' : m.image_url ? 'Sent a photo' : '';
  }
  _insertMsg(convId, sender, f, at = Date.now()) {
    const m = { id: uid(), conversation_id: convId, sender_id: sender, body: f.body || null, image_url: f.image_url || null, post_id: f.post_id || null,
      story_url: f.story_url || null, reply_to: f.reply_to || null, audio_url: f.audio_url || null, audio_duration: f.audio_duration || null,
      system: !!f.system, created_at: new Date(at).toISOString() };
    this.db.messages.push(m);
    const c = this.db.conversations.find(c => c.id === convId);
    c.updated_at = m.created_at; c.last_message = this._preview(m); c.last_sender_id = sender;
    const mem = this.db.members.find(x => x.conversation_id === convId && x.user_id === sender);
    if (mem) mem.last_read_at = m.created_at;
    return m;
  }
  _enrichMsg(m) {
    const out = { ...m, reactions: this.db.reactions.filter(r => r.message_id === m.id).map(r => ({ user_id: r.user_id, emoji: r.emoji })) };
    if (m.post_id) { const p = this.db.posts.find(p => p.id === m.post_id); out.post = p && this._canView(p.user_id) ? { id: p.id, image_url: p.image_url, caption: p.caption, media: p.media, author: this._pub(this._p(p.user_id)) } : null; }
    return out;
  }
  _shapeConv(c) {
    const mem = this.db.members.filter(m => m.conversation_id === c.id);
    const mine = mem.find(m => m.user_id === this.userId);
    const others = mem.filter(m => m.user_id !== this.userId).map(m => ({ ...this._pub(this._p(m.user_id)), last_read_at: m.last_read_at })).filter(o => o.id);
    return { id: c.id, is_group: c.is_group, title: c.title, created_by: c.created_by,
      members: mem.map(m => ({ ...this._pub(this._p(m.user_id)), last_read_at: m.last_read_at })),
      others, other: c.is_group ? null : (others[0] && !this._hasBlockedMe(others[0].id) ? others[0] : null),
      other_last_read: others.map(o => o.last_read_at).sort().at(c.is_group ? -1 : 0) || null,
      last_message: c.last_message, last_sender_id: c.last_sender_id, updated_at: c.updated_at,
      unread: !!c.last_sender_id && c.last_sender_id !== this.userId && !!mine && c.updated_at > mine.last_read_at };
  }
  async conversations() {
    const mine = new Set(this.db.members.filter(m => m.user_id === this.userId).map(m => m.conversation_id));
    return this.db.conversations.filter(c => mine.has(c.id)).map(c => this._shapeConv(c))
      .filter(c => c.last_message && (c.is_group || c.other)).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
  async conversation(id) {
    if (!this.db.members.some(m => m.conversation_id === id && m.user_id === this.userId)) return null;
    const c = this.db.conversations.find(c => c.id === id);
    return c && this._shapeConv(c);
  }
  async unreadChats() { return (await this.conversations()).filter(c => c.unread).length; }
  async openDM(userId) {
    if (this._blockedBetween(this.userId, userId)) throw new Error("You can't message this account.");
    const id = this._ensureDM(this.userId, userId); this._save(); return id;
  }
  async createGroup(title, ids) {
    ids = ids.filter(i => i !== this.userId && !this._blockedBetween(this.userId, i));
    if (!ids.length) throw new Error('Add at least one person.');
    const id = this._newConv(true, (title || '').slice(0, 60), this.userId, [this.userId, ...ids]);
    this._insertMsg(id, this.userId, { body: 'created the group', system: true });
    this._save(); return id;
  }
  async addMembers(convId, ids) {
    const have = new Set(this.db.members.filter(m => m.conversation_id === convId).map(m => m.user_id));
    const add = ids.filter(i => !have.has(i) && !this._blockedBetween(this.userId, i));
    if (!add.length) return;
    add.forEach(u => this.db.members.push({ conversation_id: convId, user_id: u, last_read_at: new Date().toISOString() }));
    const m = this._insertMsg(convId, this.userId, { body: 'added ' + add.map(u => this._p(u).username).join(', '), system: true });
    this._save(); this.emit('message', this._enrichMsg(m));
  }
  async leaveGroup(convId) {
    this._insertMsg(convId, this.userId, { body: 'left the group', system: true });
    this.db.members = this.db.members.filter(m => !(m.conversation_id === convId && m.user_id === this.userId));
    this._save();
  }
  async renameGroup(convId, title) {
    const c = this.db.conversations.find(c => c.id === convId); c.title = title.slice(0, 60);
    const m = this._insertMsg(convId, this.userId, { body: `named the group "${c.title}"`, system: true });
    this._save(); this.emit('message', this._enrichMsg(m));
  }
  async messages(convId) {
    return this.db.messages.filter(m => m.conversation_id === convId).sort((a, b) => a.created_at.localeCompare(b.created_at)).map(m => this._enrichMsg(m));
  }
  async sendMessage(convId, f) {
    const conv = this._shapeConv(this.db.conversations.find(c => c.id === convId));
    if (!conv.is_group && conv.others.some(o => this._blockedBetween(this.userId, o.id))) throw new Error("You can't send messages in this chat.");
    const m = this._insertMsg(convId, this.userId, f);
    this._save();
    const out = this._enrichMsg(m);
    this.emit('message', out);
    this._botReply(convId, m.id);
    return out;
  }
  _botReply(convId, msgId) {
    const conv = this.db.conversations.find(c => c.id === convId);
    const bots = this.db.members.filter(m => m.conversation_id === convId && m.user_id !== this.userId).map(m => this._p(m.user_id)).filter(p => p?.bot && !this._blockedBetween(this.userId, p.id));
    if (!bots.length) return;
    const bot = bots[Math.floor(Math.random() * bots.length)];
    clearTimeout(this._replyT?.[convId]); this._replyT ||= {};
    this._replyT[convId] = setTimeout(() => {
      const at = new Date().toISOString();
      bots.forEach(b => { const mem = this.db.members.find(m => m.conversation_id === convId && m.user_id === b.id); if (mem) mem.last_read_at = at; this.emit('read', { conversation_id: convId, user_id: b.id, at }); });
      bot.last_seen_at = at; this._save();
      setTimeout(() => {
        this.emit('typing', { conversation_id: convId, user_id: bot.id });
        setTimeout(() => {
          if (!this.db.conversations.find(c => c.id === convId)) return;
          if (Math.random() < 0.4 && this.db.messages.some(m => m.id === msgId)) {
            const emoji = DEMO_EMOJI[Math.floor(Math.random() * DEMO_EMOJI.length)];
            this.db.reactions.push({ message_id: msgId, user_id: bot.id, emoji });
            this.emit('reaction', { message_id: msgId, conversation_id: convId, user_id: bot.id, emoji });
          }
          const reply = { body: DEMO_REPLIES[Math.floor(Math.random() * DEMO_REPLIES.length)] };
          if (conv.is_group && Math.random() < 0.5 && this.db.messages.some(m => m.id === msgId)) reply.reply_to = msgId;
          const m = this._insertMsg(convId, bot.id, reply);
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
    this.db.messages.forEach(x => { if (x.reply_to === id) x.reply_to = null; });
    this.db.reactions = this.db.reactions.filter(r => r.message_id !== id);
    const c = this.db.conversations.find(c => c.id === m.conversation_id);
    const last = this.db.messages.filter(x => x.conversation_id === c.id).sort((a, b) => a.created_at.localeCompare(b.created_at)).pop();
    c.last_message = last ? this._preview(last) : ''; c.last_sender_id = last ? last.sender_id : null;
    this._save();
    this.emit('message_delete', { id, conversation_id: m.conversation_id });
  }
  async react(messageId, emoji, convId) {
    this.db.reactions = this.db.reactions.filter(r => !(r.message_id === messageId && r.user_id === this.userId));
    if (emoji) this.db.reactions.push({ message_id: messageId, user_id: this.userId, emoji });
    this._save();
    this.emit('reaction', { message_id: messageId, conversation_id: convId, user_id: this.userId, emoji });
  }
  async markRead(convId) {
    const m = this.db.members.find(m => m.conversation_id === convId && m.user_id === this.userId);
    if (m) { m.last_read_at = new Date().toISOString(); this._save(); }
  }
  joinChat() { return { typing: () => {}, leave: () => {} }; }
  start() {}
  stop() {}
}
