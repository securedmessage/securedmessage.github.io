// Mosaic — live backend on Supabase (accounts, database, photo storage, real-time).
'use strict';

class SupabaseAPI extends Emitter {
  constructor(url, key) {
    super();
    this.mode = 'live';
    this.sb = supabase.createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'mosaic_auth' } });
    this.userId = null;
    this.channel = null;
  }
  _err(error) { if (error) throw new Error(error.message || String(error)); }
  async _data(q) { const { data, error } = await q; this._err(error); return data; }

  // ---------- auth ----------
  async session() {
    const { data } = await this.sb.auth.getSession();
    const u = data.session?.user;
    if (!u) return null;
    this.userId = u.id;
    return this.getProfile(u.id);
  }
  async signUp(email, password, username, full_name) {
    username = username.trim().toLowerCase();
    if (!/^[a-z0-9._]{3,30}$/.test(username)) throw new Error('Usernames are 3–30 letters, numbers, periods or underscores.');
    const taken = await this._data(this.sb.from('profiles').select('id').eq('username', username).maybeSingle()).catch(() => null);
    if (taken) throw new Error('That username is taken.');
    const { data, error } = await this.sb.auth.signUp({ email: email.trim(), password, options: { data: { username, full_name: full_name.trim() } } });
    this._err(error);
    if (!data.session) throw Object.assign(new Error('Check your email to confirm your account, then log in.'), { info: true });
    this.userId = data.user.id;
    return this.getProfile(this.userId);
  }
  async signIn(email, password) {
    const { data, error } = await this.sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(/invalid/i.test(error.message) ? 'Incorrect email or password.' : error.message);
    this.userId = data.user.id;
    return this.getProfile(this.userId);
  }
  async signOut() { this.stop(); await this.sb.auth.signOut(); this.userId = null; }

  // ---------- profiles ----------
  async getProfile(id) { return this._data(this.sb.from('profiles').select('*').eq('id', id).maybeSingle()); }
  async getProfileByUsername(u) { return this._data(this.sb.from('profiles').select('*').eq('username', String(u).toLowerCase()).maybeSingle()); }
  async updateProfile(f) {
    const upd = {};
    if (f.username != null) {
      upd.username = f.username.trim().toLowerCase();
      if (!/^[a-z0-9._]{3,30}$/.test(upd.username)) throw new Error('Usernames are 3–30 letters, numbers, periods or underscores.');
    }
    ['full_name', 'bio', 'avatar_url'].forEach(k => { if (f[k] != null) upd[k] = f[k]; });
    const { data, error } = await this.sb.from('profiles').update(upd).eq('id', this.userId).select().single();
    if (error && /duplicate|unique/i.test(error.message)) throw new Error('That username is taken.');
    this._err(error);
    return data;
  }
  async uploadImage(blob) {
    const path = `${this.userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const { error } = await this.sb.storage.from('media').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
    this._err(error);
    return this.sb.storage.from('media').getPublicUrl(path).data.publicUrl;
  }
  async searchUsers(q) {
    q = q.trim().toLowerCase().replace(/^@/, '').replace(/[%_,()]/g, '');
    if (!q) return [];
    return this._data(this.sb.from('profiles').select('*').or(`username.ilike.%${q}%,full_name.ilike.%${q}%`).limit(30));
  }
  async _followingIds() {
    const rows = await this._data(this.sb.from('follows').select('following_id').eq('follower_id', this.userId));
    return rows.map(r => r.following_id);
  }
  async suggestedUsers() {
    const f = new Set([this.userId, ...(await this._followingIds())]);
    const rows = await this._data(this.sb.from('profiles').select('*').order('created_at', { ascending: false }).limit(40));
    return rows.filter(p => !f.has(p.id)).slice(0, 10);
  }
  async _count(table, col, val) {
    const { count, error } = await this.sb.from(table).select('*', { count: 'exact', head: true }).eq(col, val);
    this._err(error); return count || 0;
  }
  async stats(id) {
    const [posts, followers, following] = await Promise.all([this._count('posts', 'user_id', id), this._count('follows', 'following_id', id), this._count('follows', 'follower_id', id)]);
    return { posts, followers, following };
  }
  async isFollowing(id) { return !!(await this._data(this.sb.from('follows').select('follower_id').eq('follower_id', this.userId).eq('following_id', id).maybeSingle())); }
  async followsMe(id) { return !!(await this._data(this.sb.from('follows').select('follower_id').eq('follower_id', id).eq('following_id', this.userId).maybeSingle())); }
  async follow(id) {
    const { error } = await this.sb.from('follows').insert({ follower_id: this.userId, following_id: id });
    if (error && !/duplicate/i.test(error.message)) this._err(error);
  }
  async unfollow(id) { this._err((await this.sb.from('follows').delete().eq('follower_id', this.userId).eq('following_id', id)).error); }
  async followers(id) { return (await this._data(this.sb.from('follows').select('p:profiles!follows_follower_id_fkey(*)').eq('following_id', id).order('created_at', { ascending: false }))).map(r => r.p); }
  async following(id) { return (await this._data(this.sb.from('follows').select('p:profiles!follows_following_id_fkey(*)').eq('follower_id', id).order('created_at', { ascending: false }))).map(r => r.p); }

  // ---------- posts ----------
  _postSelect() { return '*, author:profiles!posts_user_id_fkey(*), likes(count), comments(count)'; }
  async _enrich(rows) {
    if (!rows.length) return [];
    const ids = rows.map(r => r.id);
    const [liked, saved] = await Promise.all([
      this._data(this.sb.from('likes').select('post_id').eq('user_id', this.userId).in('post_id', ids)),
      this._data(this.sb.from('saves').select('post_id').eq('user_id', this.userId).in('post_id', ids)),
    ]);
    const L = new Set(liked.map(r => r.post_id)), S = new Set(saved.map(r => r.post_id));
    return rows.map(r => ({ id: r.id, user_id: r.user_id, image_url: r.image_url, caption: r.caption, created_at: r.created_at, author: r.author,
      like_count: r.likes?.[0]?.count || 0, comment_count: r.comments?.[0]?.count || 0, liked: L.has(r.id), saved: S.has(r.id) }));
  }
  async feed() {
    const ids = [this.userId, ...(await this._followingIds())];
    return this._enrich(await this._data(this.sb.from('posts').select(this._postSelect()).in('user_id', ids).order('created_at', { ascending: false }).limit(60)));
  }
  async explore() {
    return this._enrich(await this._data(this.sb.from('posts').select(this._postSelect()).neq('user_id', this.userId).order('created_at', { ascending: false }).limit(60)));
  }
  async userPosts(id) {
    return this._enrich(await this._data(this.sb.from('posts').select(this._postSelect()).eq('user_id', id).order('created_at', { ascending: false }).limit(120)));
  }
  async savedPosts() {
    const rows = await this._data(this.sb.from('saves').select(`post:posts(${this._postSelect()})`).eq('user_id', this.userId).order('created_at', { ascending: false }).limit(120));
    return this._enrich(rows.map(r => r.post).filter(Boolean));
  }
  async getPost(id) {
    const r = await this._data(this.sb.from('posts').select(this._postSelect()).eq('id', id).maybeSingle());
    return r ? (await this._enrich([r]))[0] : null;
  }
  async createPost(image_url, caption) {
    const r = await this._data(this.sb.from('posts').insert({ user_id: this.userId, image_url, caption }).select(this._postSelect()).single());
    return (await this._enrich([r]))[0];
  }
  async updatePost(id, caption) { this._err((await this.sb.from('posts').update({ caption }).eq('id', id)).error); }
  async deletePost(id) { this._err((await this.sb.from('posts').delete().eq('id', id)).error); }
  async like(id) { const { error } = await this.sb.from('likes').insert({ post_id: id, user_id: this.userId }); if (error && !/duplicate/i.test(error.message)) this._err(error); }
  async unlike(id) { this._err((await this.sb.from('likes').delete().eq('post_id', id).eq('user_id', this.userId)).error); }
  async likers(id) { return (await this._data(this.sb.from('likes').select('p:profiles(*)').eq('post_id', id).order('created_at', { ascending: false }).limit(200))).map(r => r.p); }
  async save(id) { const { error } = await this.sb.from('saves').insert({ post_id: id, user_id: this.userId }); if (error && !/duplicate/i.test(error.message)) this._err(error); }
  async unsave(id) { this._err((await this.sb.from('saves').delete().eq('post_id', id).eq('user_id', this.userId)).error); }
  async comments(postId) { return this._data(this.sb.from('comments').select('*, author:profiles(*)').eq('post_id', postId).order('created_at')); }
  async addComment(postId, body) { return this._data(this.sb.from('comments').insert({ post_id: postId, user_id: this.userId, body }).select('*, author:profiles(*)').single()); }
  async deleteComment(id) { this._err((await this.sb.from('comments').delete().eq('id', id)).error); }

  // ---------- stories ----------
  async stories() {
    const ids = [this.userId, ...(await this._followingIds())];
    const since = new Date(Date.now() - 24 * 3600e3).toISOString();
    const rows = await this._data(this.sb.from('stories').select('*, author:profiles(*)').in('user_id', ids).gt('created_at', since).order('created_at'));
    const map = new Map();
    rows.forEach(r => { if (!map.has(r.user_id)) map.set(r.user_id, { user: r.author, items: [] }); map.get(r.user_id).items.push({ id: r.id, user_id: r.user_id, image_url: r.image_url, created_at: r.created_at }); });
    const groups = [...map.values()];
    groups.sort((a, b) => (a.user.id === this.userId ? -1 : b.user.id === this.userId ? 1 : b.items.at(-1).created_at.localeCompare(a.items.at(-1).created_at)));
    return groups;
  }
  async addStory(image_url) { return this._data(this.sb.from('stories').insert({ user_id: this.userId, image_url }).select().single()); }
  async deleteStory(id) { this._err((await this.sb.from('stories').delete().eq('id', id)).error); }

  // ---------- notifications ----------
  async notifications() {
    const rows = await this._data(this.sb.from('notifications').select('*, actor:profiles!notifications_actor_id_fkey(*), post:posts(image_url)').eq('user_id', this.userId).order('created_at', { ascending: false }).limit(100));
    return rows.map(r => ({ ...r, post_image: r.post?.image_url || null }));
  }
  async unreadNotifications() {
    const { count } = await this.sb.from('notifications').select('*', { count: 'exact', head: true }).eq('user_id', this.userId).eq('read', false);
    return count || 0;
  }
  async markNotificationsRead() { await this.sb.from('notifications').update({ read: true }).eq('user_id', this.userId).eq('read', false); }

  // ---------- messaging ----------
  async conversations() {
    const rows = await this._data(this.sb.from('conversation_members')
      .select('last_read_at, conversation:conversations(id, updated_at, last_message, last_sender_id, members:conversation_members(user_id, last_read_at, profile:profiles(*)))')
      .eq('user_id', this.userId));
    return rows.map(r => {
      const c = r.conversation; if (!c) return null;
      const other = c.members.find(m => m.user_id !== this.userId);
      if (!other) return null;
      return { id: c.id, other: other.profile, last_message: c.last_message, last_sender_id: c.last_sender_id, updated_at: c.updated_at,
        unread: !!c.last_sender_id && c.last_sender_id !== this.userId && c.updated_at > r.last_read_at, other_last_read: other.last_read_at };
    }).filter(c => c && c.last_message).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
  async conversation(id) {
    const rows = await this._data(this.sb.from('conversation_members').select('user_id, last_read_at, profile:profiles(*)').eq('conversation_id', id));
    const other = rows.find(r => r.user_id !== this.userId);
    return other && { id, other: other.profile, other_last_read: other.last_read_at };
  }
  async unreadChats() { return (await this.conversations()).filter(c => c.unread).length; }
  async openDM(userId) { return this._data(this.sb.rpc('start_dm', { other: userId })); }
  _msgSelect() { return '*, post:posts(id, image_url, caption, author:profiles!posts_user_id_fkey(*)), reactions:message_reactions(user_id)'; }
  _shapeMsg(m) { const { reactions, ...rest } = m; return { ...rest, hearts: (reactions || []).map(r => r.user_id) }; }
  async messages(convId) {
    const rows = await this._data(this.sb.from('messages').select(this._msgSelect()).eq('conversation_id', convId).order('created_at', { ascending: false }).limit(300));
    return rows.reverse().map(m => this._shapeMsg(m));
  }
  async _fetchMsg(id) { const r = await this._data(this.sb.from('messages').select(this._msgSelect()).eq('id', id).maybeSingle()); return r && this._shapeMsg(r); }
  async sendMessage(convId, f) {
    const row = { conversation_id: convId, sender_id: this.userId, body: f.body || null, image_url: f.image_url || null, post_id: f.post_id || null, story_url: f.story_url || null };
    const r = await this._data(this.sb.from('messages').insert(row).select(this._msgSelect()).single());
    const m = this._shapeMsg(r);
    this.emit('message', m);
    return m;
  }
  async deleteMessage(id) {
    const m = await this._data(this.sb.from('messages').select('conversation_id').eq('id', id).maybeSingle());
    this._err((await this.sb.from('messages').delete().eq('id', id)).error);
    this.emit('message_delete', { id, conversation_id: m?.conversation_id });
  }
  async toggleHeart(messageId, on, convId) {
    if (on) { const { error } = await this.sb.from('message_reactions').insert({ message_id: messageId, user_id: this.userId, conversation_id: convId }); if (error && !/duplicate/i.test(error.message)) this._err(error); }
    else this._err((await this.sb.from('message_reactions').delete().eq('message_id', messageId).eq('user_id', this.userId)).error);
    this.emit('reaction', { message_id: messageId, conversation_id: convId, user_id: this.userId, on });
  }
  async markRead(convId) { await this.sb.from('conversation_members').update({ last_read_at: new Date().toISOString() }).eq('conversation_id', convId).eq('user_id', this.userId); }

  // Typing indicators travel over a short-lived broadcast channel per chat.
  joinChat(convId) {
    const ch = this.sb.channel('typing:' + convId, { config: { broadcast: { self: false } } });
    ch.on('broadcast', { event: 'typing' }, ({ payload }) => this.emit('typing', { conversation_id: convId, user_id: payload.user_id }));
    ch.subscribe();
    let last = 0;
    return {
      typing: () => { if (Date.now() - last > 2000) { last = Date.now(); ch.send({ type: 'broadcast', event: 'typing', payload: { user_id: this.userId } }); } },
      leave: () => this.sb.removeChannel(ch),
    };
  }

  // Live database changes for this account (row security limits them to the user's own chats).
  start() {
    if (this.channel || !this.userId) return;
    this.channel = this.sb.channel('mosaic-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async ({ new: m }) => {
        if (m.sender_id === this.userId) return;
        const full = await this._fetchMsg(m.id).catch(() => null);
        this.emit('message', full || { ...m, hearts: [] });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, ({ old }) => this.emit('message_delete', { id: old.id, conversation_id: old.conversation_id }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, ({ eventType, new: n, old }) => {
        const r = eventType === 'DELETE' ? old : n;
        if (r.user_id === this.userId) return;
        this.emit('reaction', { message_id: r.message_id, conversation_id: r.conversation_id, user_id: r.user_id, on: eventType !== 'DELETE' });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_members' }, ({ new: n }) => {
        if (n.user_id !== this.userId) this.emit('read', { conversation_id: n.conversation_id, user_id: n.user_id, at: n.last_read_at });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${this.userId}` }, ({ new: n }) => this.emit('notification', n))
      .subscribe();
  }
  stop() { if (this.channel) { this.sb.removeChannel(this.channel); this.channel = null; } }
}
