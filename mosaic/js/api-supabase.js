// Mosaic — live backend on Supabase (accounts, database, file storage, real-time).
// Every embedded relationship names its foreign key, so queries stay unambiguous as tables grow.
'use strict';

const P = {
  postAuthor: 'author:profiles!posts_user_id_fkey(*)',
  post: '*, author:profiles!posts_user_id_fkey(*), likes!likes_post_id_fkey(count), comments!comments_post_id_fkey(count)',
};

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
  _dup(error) { if (error && !/duplicate|unique/i.test(error.message)) this._err(error); }

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
    const { data, error } = await this.sb.auth.signUp({ email: email.trim(), password, options: { data: { username, full_name: full_name.trim() } } });
    this._err(error);
    if (!data.session) throw Object.assign(new Error('Check your email to confirm your account, then log in.'), { info: true });
    this.userId = data.user.id;
    const me = await this.getProfile(this.userId);
    if (me && me.username !== username) throw Object.assign(new Error(`That username was taken, so you're @${me.username}. You can change it in Edit profile.`), { info: true, signedIn: true });
    return me;
  }
  async signIn(email, password) {
    const { data, error } = await this.sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(/invalid/i.test(error.message) ? 'Incorrect email or password.' : error.message);
    this.userId = data.user.id;
    return this.getProfile(this.userId);
  }
  async signOut() { this.stop(); await this.sb.auth.signOut(); this.userId = null; }
  // Permanently deletes the signed-in account: uploaded files first, then everything in the database.
  async deleteAccount() {
    const bucket = this.sb.storage.from('media');
    for (;;) {
      const { data, error } = await bucket.list(this.userId, { limit: 1000 });
      this._err(error);
      const paths = (data || []).filter(f => f.name && f.id).map(f => `${this.userId}/${f.name}`);
      if (!paths.length) break;
      this._err((await bucket.remove(paths)).error);
      if (paths.length < 1000) break;
    }
    this._err((await this.sb.rpc('delete_my_account')).error);
    this.stop();
    await this.sb.auth.signOut({ scope: 'local' }).catch(() => {});
    this.userId = null;
  }

  // ---------- profiles & relationships ----------
  async getProfile(id) { return this._data(this.sb.from('profiles').select('*').eq('id', id).maybeSingle()); }
  async getProfileByUsername(u) { return this._data(this.sb.from('profiles').select('*').eq('username', String(u).toLowerCase()).maybeSingle()); }
  async updateProfile(f) {
    const upd = {};
    if (f.username != null) {
      upd.username = f.username.trim().toLowerCase();
      if (!/^[a-z0-9._]{3,30}$/.test(upd.username)) throw new Error('Usernames are 3–30 letters, numbers, periods or underscores.');
    }
    ['full_name', 'bio', 'avatar_url', 'is_private', 'show_activity'].forEach(k => { if (f[k] != null) upd[k] = f[k]; });
    const { data, error } = await this.sb.from('profiles').update(upd).eq('id', this.userId).select().single();
    if (error && /duplicate|unique/i.test(error.message)) throw new Error('That username is taken.');
    this._err(error);
    return data;
  }
  async uploadFile(blob, ext, contentType) {
    const path = `${this.userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await this.sb.storage.from('media').upload(path, blob, { contentType, cacheControl: '31536000' });
    if (error && /exceeded|too large|size/i.test(error.message)) throw new Error('That file is too large (the limit is 50 MB).');
    this._err(error);
    return this.sb.storage.from('media').getPublicUrl(path).data.publicUrl;
  }
  uploadImage(blob) { return this.uploadFile(blob, 'jpg', 'image/jpeg'); }
  async searchUsers(q) {
    q = q.trim().toLowerCase().replace(/^@/, '').replace(/[%_,()]/g, '');
    if (!q) return [];
    return this._data(this.sb.from('profiles').select('*').or(`username.ilike.%${q}%,full_name.ilike.%${q}%`).neq('id', this.userId).limit(30));
  }
  async _followingIds() {
    return (await this._data(this.sb.from('follows').select('following_id').eq('follower_id', this.userId))).map(r => r.following_id);
  }
  async suggestedUsers() {
    const skip = new Set([this.userId, ...(await this._followingIds()), ...(await this._blockedIds())]);
    const rows = await this._data(this.sb.from('profiles').select('*').order('created_at', { ascending: false }).limit(50));
    return rows.filter(p => !skip.has(p.id)).slice(0, 10);
  }
  async stats(id) { return this._data(this.sb.rpc('profile_stats', { uid: id })); }
  async relationship(id) {
    const [f1, f2, req, blk] = await Promise.all([
      this._data(this.sb.from('follows').select('follower_id').eq('follower_id', this.userId).eq('following_id', id).maybeSingle()),
      this._data(this.sb.from('follows').select('follower_id').eq('follower_id', id).eq('following_id', this.userId).maybeSingle()),
      this._data(this.sb.from('follow_requests').select('requester_id').eq('requester_id', this.userId).eq('target_id', id).maybeSingle()),
      this._data(this.sb.from('blocks').select('blocker_id').eq('blocker_id', this.userId).eq('blocked_id', id).maybeSingle()),
    ]);
    return { following: !!f1, followsMe: !!f2, requested: !!req, blocked: !!blk };
  }
  async isFollowing(id) { return (await this.relationship(id)).following; }
  async followsMe(id) { return (await this.relationship(id)).followsMe; }
  // Returns 'following' or 'requested' (private accounts approve followers first).
  async follow(id) {
    const p = await this.getProfile(id);
    if (p?.is_private) {
      const { error } = await this.sb.from('follow_requests').insert({ requester_id: this.userId, target_id: id });
      this._dup(error); return 'requested';
    }
    const { error } = await this.sb.from('follows').insert({ follower_id: this.userId, following_id: id });
    this._dup(error); return 'following';
  }
  async unfollow(id) {
    this._err((await this.sb.from('follows').delete().eq('follower_id', this.userId).eq('following_id', id)).error);
    this._err((await this.sb.from('follow_requests').delete().eq('requester_id', this.userId).eq('target_id', id)).error);
  }
  async removeFollower(id) { this._err((await this.sb.from('follows').delete().eq('follower_id', id).eq('following_id', this.userId)).error); }
  async followRequests() {
    return (await this._data(this.sb.from('follow_requests').select('created_at, p:profiles!follow_requests_requester_id_fkey(*)')
      .eq('target_id', this.userId).order('created_at', { ascending: false }))).map(r => r.p).filter(Boolean);
  }
  async acceptRequest(id) { this._err((await this.sb.rpc('accept_follow_request', { requester: id })).error); }
  async declineRequest(id) { this._err((await this.sb.from('follow_requests').delete().eq('requester_id', id).eq('target_id', this.userId)).error); }
  async followers(id) { return (await this._data(this.sb.from('follows').select('p:profiles!follows_follower_id_fkey(*)').eq('following_id', id).order('created_at', { ascending: false }))).map(r => r.p).filter(Boolean); }
  async following(id) { return (await this._data(this.sb.from('follows').select('p:profiles!follows_following_id_fkey(*)').eq('follower_id', id).order('created_at', { ascending: false }))).map(r => r.p).filter(Boolean); }

  async _blockedIds() { return (await this._data(this.sb.from('blocks').select('blocked_id').eq('blocker_id', this.userId))).map(r => r.blocked_id); }
  async block(id) { const { error } = await this.sb.from('blocks').insert({ blocker_id: this.userId, blocked_id: id }); this._dup(error); }
  async unblock(id) { this._err((await this.sb.from('blocks').delete().eq('blocker_id', this.userId).eq('blocked_id', id)).error); }
  async blockedUsers() { return (await this._data(this.sb.from('blocks').select('p:profiles!blocks_blocked_id_fkey(*)').eq('blocker_id', this.userId))).map(r => r.p).filter(Boolean); }
  async report(kind, target_id, reason, details = '') {
    this._err((await this.sb.from('reports').insert({ reporter_id: this.userId, kind, target_id, reason, details })).error);
  }
  async touchPresence() { await this.sb.rpc('touch_presence'); }

  // ---------- posts ----------
  async _enrich(rows) {
    rows = rows.filter(Boolean);
    if (!rows.length) return [];
    const ids = rows.map(r => r.id);
    const [liked, saved, tags] = await Promise.all([
      this._data(this.sb.from('likes').select('post_id').eq('user_id', this.userId).in('post_id', ids)),
      this._data(this.sb.from('saves').select('post_id').eq('user_id', this.userId).in('post_id', ids)),
      this._data(this.sb.from('post_tags').select('post_id, p:profiles!post_tags_user_id_fkey(*)').in('post_id', ids)),
    ]);
    const L = new Set(liked.map(r => r.post_id)), S = new Set(saved.map(r => r.post_id));
    return rows.map(r => ({
      id: r.id, user_id: r.user_id, image_url: r.image_url, caption: r.caption, created_at: r.created_at, author: r.author,
      media: (r.media && r.media.length) ? r.media : [{ type: 'image', url: r.image_url }],
      like_count: r.likes?.[0]?.count || 0, comment_count: r.comments?.[0]?.count || 0, liked: L.has(r.id), saved: S.has(r.id),
      tags: tags.filter(t => t.post_id === r.id && t.p).map(t => t.p),
    }));
  }
  _posts() { return this.sb.from('posts').select(P.post); }
  async feed() {
    const ids = [this.userId, ...(await this._followingIds())];
    return this._enrich(await this._data(this._posts().in('user_id', ids).order('created_at', { ascending: false }).limit(60)));
  }
  async explore() { return this._enrich(await this._data(this._posts().neq('user_id', this.userId).order('created_at', { ascending: false }).limit(60))); }
  async reels() { return this._enrich(await this._data(this._posts().eq('has_video', true).order('created_at', { ascending: false }).limit(40))); }
  async userPosts(id) { return this._enrich(await this._data(this._posts().eq('user_id', id).order('created_at', { ascending: false }).limit(120))); }
  async hashtagPosts(tag) {
    tag = tag.replace(/^#/, '').replace(/[%_,()]/g, '');
    const rows = await this._data(this._posts().ilike('caption', `%#${tag}%`).order('created_at', { ascending: false }).limit(90));
    const re = new RegExp(`#${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.])`, 'i');
    return this._enrich(rows.filter(r => re.test(r.caption)));
  }
  async taggedPosts(id) {
    const rows = await this._data(this.sb.from('post_tags').select(`post:posts!post_tags_post_id_fkey(${P.post})`).eq('user_id', id).order('created_at', { ascending: false }).limit(90));
    return this._enrich(rows.map(r => r.post));
  }
  async savedPosts() {
    const rows = await this._data(this.sb.from('saves').select(`post:posts!saves_post_id_fkey(${P.post})`).eq('user_id', this.userId).order('created_at', { ascending: false }).limit(120));
    return this._enrich(rows.map(r => r.post));
  }
  async getPost(id) {
    const r = await this._data(this._posts().eq('id', id).maybeSingle());
    return r ? (await this._enrich([r]))[0] : null;
  }
  // media: [{ type: 'image'|'video', url, poster?, duration? }]
  async createPost({ media, caption, tags = [] }) {
    const first = media[0];
    const image_url = first.type === 'video' ? first.poster : first.url;
    const r = await this._data(this.sb.from('posts').insert({ user_id: this.userId, image_url, caption, media }).select(P.post).single());
    if (tags.length) await this.sb.from('post_tags').insert(tags.map(user_id => ({ post_id: r.id, user_id })));
    return (await this._enrich([r]))[0];
  }
  async updatePost(id, caption) { this._err((await this.sb.from('posts').update({ caption }).eq('id', id)).error); }
  async deletePost(id) { this._err((await this.sb.from('posts').delete().eq('id', id)).error); }
  async removeTag(postId, userId = this.userId) { this._err((await this.sb.from('post_tags').delete().eq('post_id', postId).eq('user_id', userId)).error); }
  async like(id) { const { error } = await this.sb.from('likes').insert({ post_id: id, user_id: this.userId }); this._dup(error); }
  async unlike(id) { this._err((await this.sb.from('likes').delete().eq('post_id', id).eq('user_id', this.userId)).error); }
  async likers(id) { return (await this._data(this.sb.from('likes').select('p:profiles!likes_user_id_fkey(*)').eq('post_id', id).order('created_at', { ascending: false }).limit(200))).map(r => r.p).filter(Boolean); }
  async save(id) { const { error } = await this.sb.from('saves').insert({ post_id: id, user_id: this.userId }); this._dup(error); }
  async unsave(id) { this._err((await this.sb.from('saves').delete().eq('post_id', id).eq('user_id', this.userId)).error); }

  // ---------- comments ----------
  async comments(postId) {
    const rows = await this._data(this.sb.from('comments')
      .select('*, author:profiles!comments_user_id_fkey(*), comment_likes!comment_likes_comment_id_fkey(user_id)')
      .eq('post_id', postId).order('created_at'));
    return rows.filter(c => c.author).map(({ comment_likes, ...c }) => ({ ...c, like_count: comment_likes.length, liked: comment_likes.some(l => l.user_id === this.userId) }));
  }
  async addComment(postId, body, parentId = null) {
    const c = await this._data(this.sb.from('comments').insert({ post_id: postId, user_id: this.userId, body, parent_id: parentId }).select('*, author:profiles!comments_user_id_fkey(*)').single());
    return { ...c, like_count: 0, liked: false };
  }
  async deleteComment(id) { this._err((await this.sb.from('comments').delete().eq('id', id)).error); }
  async likeComment(id) { const { error } = await this.sb.from('comment_likes').insert({ comment_id: id, user_id: this.userId }); this._dup(error); }
  async unlikeComment(id) { this._err((await this.sb.from('comment_likes').delete().eq('comment_id', id).eq('user_id', this.userId)).error); }

  // ---------- stories ----------
  async stories() {
    const ids = [this.userId, ...(await this._followingIds())];
    const since = new Date(Date.now() - 24 * 3600e3).toISOString();
    const rows = await this._data(this.sb.from('stories').select('*, author:profiles!stories_user_id_fkey(*)').in('user_id', ids).gt('created_at', since).order('created_at'));
    const map = new Map();
    rows.forEach(r => { if (!r.author) return; if (!map.has(r.user_id)) map.set(r.user_id, { user: r.author, items: [] }); map.get(r.user_id).items.push({ id: r.id, user_id: r.user_id, image_url: r.image_url, created_at: r.created_at }); });
    const groups = [...map.values()];
    groups.sort((a, b) => (a.user.id === this.userId ? -1 : b.user.id === this.userId ? 1 : b.items.at(-1).created_at.localeCompare(a.items.at(-1).created_at)));
    return groups;
  }
  async addStory(image_url) { return this._data(this.sb.from('stories').insert({ user_id: this.userId, image_url }).select().single()); }
  async deleteStory(id) { this._err((await this.sb.from('stories').delete().eq('id', id)).error); }

  // ---------- notifications ----------
  async notifications() {
    const rows = await this._data(this.sb.from('notifications')
      .select('*, actor:profiles!notifications_actor_id_fkey(*), post:posts!notifications_post_id_fkey(image_url)')
      .eq('user_id', this.userId).order('created_at', { ascending: false }).limit(100));
    return rows.filter(r => r.actor).map(r => ({ ...r, post_image: r.post?.image_url || null }));
  }
  async unreadNotifications() {
    const { count } = await this.sb.from('notifications').select('*', { count: 'exact', head: true }).eq('user_id', this.userId).eq('read', false);
    return count || 0;
  }
  async markNotificationsRead() { await this.sb.from('notifications').update({ read: true }).eq('user_id', this.userId).eq('read', false); }

  // ---------- messaging ----------
  _shapeConv(c, myRead) {
    const members = (c.members || []).filter(m => m.profile);
    const others = members.filter(m => m.user_id !== this.userId);
    return {
      id: c.id, is_group: c.is_group, title: c.title, created_by: c.created_by,
      members: members.map(m => ({ ...m.profile, last_read_at: m.last_read_at })),
      others: others.map(m => ({ ...m.profile, last_read_at: m.last_read_at })),
      other: c.is_group ? null : others[0]?.profile || null,
      other_last_read: others.length ? others.map(m => m.last_read_at).sort().at(c.is_group ? -1 : 0) : null,
      last_message: c.last_message, last_sender_id: c.last_sender_id, updated_at: c.updated_at,
      unread: !!c.last_sender_id && c.last_sender_id !== this.userId && myRead != null && c.updated_at > myRead,
    };
  }
  _convSelect() {
    return 'id, is_group, title, created_by, updated_at, last_message, last_sender_id, members:conversation_members!conversation_members_conversation_id_fkey(user_id, last_read_at, profile:profiles!conversation_members_user_id_fkey(*))';
  }
  async conversations() {
    const rows = await this._data(this.sb.from('conversation_members')
      .select(`last_read_at, conversation:conversations!conversation_members_conversation_id_fkey(${this._convSelect()})`).eq('user_id', this.userId));
    return rows.filter(r => r.conversation).map(r => this._shapeConv(r.conversation, r.last_read_at))
      .filter(c => c.last_message && (c.is_group || c.other)).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
  async conversation(id) {
    const c = await this._data(this.sb.from('conversations').select(this._convSelect()).eq('id', id).maybeSingle());
    if (!c) return null;
    const mine = c.members.find(m => m.user_id === this.userId);
    return this._shapeConv(c, mine?.last_read_at);
  }
  async unreadChats() { return (await this.conversations()).filter(c => c.unread).length; }
  async openDM(userId) { return this._data(this.sb.rpc('start_dm', { other: userId })); }
  async createGroup(title, ids) { return this._data(this.sb.rpc('create_group', { group_title: title, member_ids: ids })); }
  async addMembers(convId, ids) { this._err((await this.sb.rpc('add_group_members', { conv: convId, member_ids: ids })).error); }
  async leaveGroup(convId) { this._err((await this.sb.rpc('leave_group', { conv: convId })).error); }
  async renameGroup(convId, title) { this._err((await this.sb.rpc('rename_group', { conv: convId, new_title: title })).error); }
  _msgSelect() { return '*, post:posts!messages_post_id_fkey(id, image_url, caption, media, author:profiles!posts_user_id_fkey(*)), reactions:message_reactions!message_reactions_message_id_fkey(user_id, emoji)'; }
  _shapeMsg(m) { return { ...m, reactions: m.reactions || [] }; }
  async messages(convId) {
    const rows = await this._data(this.sb.from('messages').select(this._msgSelect()).eq('conversation_id', convId).order('created_at', { ascending: false }).limit(300));
    return rows.reverse().map(m => this._shapeMsg(m));
  }
  async _fetchMsg(id) { const r = await this._data(this.sb.from('messages').select(this._msgSelect()).eq('id', id).maybeSingle()); return r && this._shapeMsg(r); }
  async sendMessage(convId, f) {
    const row = { conversation_id: convId, sender_id: this.userId };
    ['body', 'image_url', 'post_id', 'story_url', 'reply_to', 'audio_url', 'audio_duration'].forEach(k => { if (f[k] != null && f[k] !== '') row[k] = f[k]; });
    const { data, error } = await this.sb.from('messages').insert(row).select(this._msgSelect()).single();
    if (error && /row-level security/i.test(error.message)) throw new Error("You can't send messages in this chat.");
    this._err(error);
    const m = this._shapeMsg(data);
    this.emit('message', m);
    return m;
  }
  async deleteMessage(id, convId) {
    this._err((await this.sb.from('messages').delete().eq('id', id)).error);
    this.emit('message_delete', { id, conversation_id: convId });
  }
  // emoji null removes your reaction
  async react(messageId, emoji, convId) {
    if (emoji) this._err((await this.sb.from('message_reactions').upsert({ message_id: messageId, user_id: this.userId, conversation_id: convId, emoji }, { onConflict: 'message_id,user_id' })).error);
    else this._err((await this.sb.from('message_reactions').delete().eq('message_id', messageId).eq('user_id', this.userId)).error);
    this.emit('reaction', { message_id: messageId, conversation_id: convId, user_id: this.userId, emoji });
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
        if (m.sender_id === this.userId && !m.system) return;
        const full = await this._fetchMsg(m.id).catch(() => null);
        this.emit('message', full || { ...m, reactions: [] });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, ({ old }) => this.emit('message_delete', { id: old.id, conversation_id: old.conversation_id }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, ({ eventType, new: n, old }) => {
        const r = eventType === 'DELETE' ? old : n;
        if (r.user_id === this.userId) return;
        this.emit('reaction', { message_id: r.message_id, conversation_id: r.conversation_id, user_id: r.user_id, emoji: eventType === 'DELETE' ? null : r.emoji });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_members' }, ({ new: n }) => {
        if (n.user_id !== this.userId) this.emit('read', { conversation_id: n.conversation_id, user_id: n.user_id, at: n.last_read_at });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations' }, ({ new: c }) => this.emit('conversation', c))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${this.userId}` }, ({ new: n }) => this.emit('notification', n))
      .subscribe();
  }
  stop() { if (this.channel) { this.sb.removeChannel(this.channel); this.channel = null; } }
}
