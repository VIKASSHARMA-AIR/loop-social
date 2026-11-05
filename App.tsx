import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Session } from '@supabase/supabase-js';
import { isBackendConfigured, Post, Profile, supabase } from './lib/supabase';

type Page = 'home' | 'discover' | 'upload' | 'wallet' | 'profile' | 'moderation';
const theme = { ink: '#22221f', muted: '#85857d', line: '#ecece7', paper: '#fff', canvas: '#f7f7f4', lime: '#d9f36a', violet: '#7957ed', amber: '#fff6d8' };
const alertUser = (title: string, message: string) => Platform.OS === 'web' ? window.alert(`${title}\n\n${message}`) : Alert.alert(title, message);

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [page, setPage] = useState<Page>('home');
  const [posts, setPosts] = useState<Post[]>([]);
  const [following, setFollowing] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [authMode, setAuthMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [caption, setCaption] = useState('');
  const [picked, setPicked] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [commentPost, setCommentPost] = useState<Post | null>(null);
  const [commentText, setCommentText] = useState('');
  const [commentRows, setCommentRows] = useState<any[]>([]);
  const [searchProfiles, setSearchProfiles] = useState<Profile[]>([]);
  const [walletCount, setWalletCount] = useState(0);
  const [reports, setReports] = useState<any[]>([]);
  const [profileName, setProfileName] = useState('');
  const [profileBio, setProfileBio] = useState('');

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => listener.subscription.unsubscribe();
  }, []);

  const load = useCallback(async () => {
    if (!supabase || !session?.user) return;
    setRefreshing(true);
    const [profileResult, postsResult, followsResult] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle(),
      supabase.from('posts').select('id,user_id,media_path,media_type,caption,created_at,status,profiles!posts_user_id_fkey(id,username,display_name,avatar_url,bio,is_admin),likes(user_id),comments(id)').in('status', ['approved', 'pending']).order('created_at', { ascending: false }).limit(50),
      supabase.from('follows').select('followed_id').eq('follower_id', session.user.id),
    ]);
    if (profileResult.data) {
      setProfile(profileResult.data as Profile);
      setProfileName(profileResult.data.display_name ?? '');
      setProfileBio(profileResult.data.bio ?? '');
      if (profileResult.data.is_admin) {
        const reportResult = await supabase.from('reports').select('id,target_type,target_id,reason,status,created_at').eq('status', 'open').order('created_at');
        setReports(reportResult.data ?? []);
      }
    }
    if (postsResult.data) {
      const withMedia = await Promise.all((postsResult.data as any[]).map(async row => {
        const signed = await supabase.storage.from('loop-media').createSignedUrl(row.media_path, 3600);
        return { ...row, media_url: signed.data?.signedUrl ?? '' };
      }));
      setPosts(withMedia as Post[]);
    }
    if (followsResult.data) setFollowing(followsResult.data.map(x => x.followed_id));
    setRefreshing(false);
  }, [session]);

  useEffect(() => { load(); }, [load]);

  const filteredPosts = useMemo(() => posts.filter(p => {
    const pendingMine = p.status === 'pending' && p.user_id === session?.user.id;
    const visible = p.status === 'approved' || pendingMine || (profile?.is_admin && p.status === 'pending');
    return visible && `${p.caption} ${p.profiles?.username ?? ''} ${p.profiles?.display_name ?? ''}`.toLowerCase().includes(query.toLowerCase());
  }), [posts, query, session, profile]);

  async function authenticate() {
    if (!supabase) return;
    setBusy(true);
    try {
      if (authMode === 'up') {
        if (username.trim().length < 3) throw new Error('Choose a username with at least 3 characters.');
        const { error } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { username: username.toLowerCase().replace(/[^a-z0-9_]/g, ''), display_name: username.trim() } } });
        if (error) throw error;
        alertUser('Check your email', 'Confirm your email to finish creating your Loop account.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      }
    } catch (e: any) { alertUser('Could not continue', e.message ?? 'Please try again.'); }
    finally { setBusy(false); }
  }

  async function signOut() { await supabase?.auth.signOut(); setProfile(null); setPage('home'); }

  async function chooseMedia() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return alertUser('Allow photo access', 'Loop needs access to your media library to attach a photo or short video.');
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsEditing: true, quality: 0.85, videoMaxDuration: 90 });
    if (!result.canceled) setPicked(result.assets[0]);
  }

  async function publishPost() {
    if (!supabase || !session?.user || !picked) return alertUser('Add media first', 'Choose a photo or video before sharing.');
    setBusy(true);
    try {
      const response = await fetch(picked.uri);
      const bytes = await response.arrayBuffer();
      const ext = picked.fileName?.split('.').pop() || (picked.type === 'video' ? 'mp4' : 'jpg');
      const path = `${session.user.id}/${Date.now()}.${ext}`;
      const contentType = picked.mimeType || (picked.type === 'video' ? 'video/mp4' : 'image/jpeg');
      const { error: uploadError } = await supabase.storage.from('loop-media').upload(path, bytes, { contentType, upsert: false });
      if (uploadError) throw uploadError;
      const { error } = await supabase.from('posts').insert({ user_id: session.user.id, media_path: path, media_type: picked.type === 'video' ? 'video' : 'image', caption: caption.trim(), status: 'pending' });
      if (error) throw error;
      setPicked(null); setCaption(''); setPage('home'); await load();
      alertUser('Sent for review', 'Your post is uploaded and will appear publicly after a moderator approves it.');
    } catch (e: any) { alertUser('Upload did not finish', e.message ?? 'Check your connection and try again.'); }
    finally { setBusy(false); }
  }

  async function toggleLike(post: Post) {
    if (!supabase || !session) return;
    const mine = post.likes?.some(x => x.user_id === session.user.id);
    const change = mine
      ? await supabase.from('likes').delete().eq('post_id', post.id).eq('user_id', session.user.id)
      : await supabase.from('likes').insert({ post_id: post.id, user_id: session.user.id });
    if (change.error) return alertUser('Like did not save', change.error.message);
    setPosts(old => old.map(p => p.id !== post.id ? p : { ...p, likes: mine ? p.likes?.filter(x => x.user_id !== session.user.id) : [...(p.likes ?? []), { user_id: session.user.id }] }));
  }

  async function toggleFollow(userId: string) {
    if (!supabase || !session) return;
    const isFollowing = following.includes(userId);
    const result = isFollowing
      ? await supabase.from('follows').delete().eq('follower_id', session.user.id).eq('followed_id', userId)
      : await supabase.from('follows').insert({ follower_id: session.user.id, followed_id: userId });
    if (result.error) return alertUser('Follow did not save', result.error.message);
    setFollowing(old => isFollowing ? old.filter(id => id !== userId) : [...old, userId]);
  }

  async function openComments(post: Post) {
    setCommentPost(post); setCommentRows([]);
    if (!supabase) return;
    const { data, error } = await supabase.from('comments').select('id,body,created_at,profiles(username,display_name)').eq('post_id', post.id).order('created_at');
    if (error) alertUser('Comments unavailable', error.message); else setCommentRows(data ?? []);
  }

  async function addComment() {
    if (!supabase || !session || !commentPost || !commentText.trim()) return;
    const { error } = await supabase.from('comments').insert({ post_id: commentPost.id, user_id: session.user.id, body: commentText.trim() });
    if (error) return alertUser('Comment did not post', error.message);
    setCommentText(''); await openComments(commentPost); await load();
  }

  async function reportPost(post: Post) {
    if (!supabase || !session) return;
    const { error } = await supabase.from('reports').insert({ reporter_id: session.user.id, target_type: 'post', target_id: post.id, reason: 'Community guidelines' });
    alertUser(error ? 'Report did not send' : 'Thanks for reporting', error?.message ?? 'Our moderation team will review this post.');
  }

  async function searchUsers(text: string) {
    setQuery(text);
    if (!supabase || text.trim().length < 2) return setSearchProfiles([]);
    const { data } = await supabase.from('profiles').select('id,username,display_name,avatar_url,bio,is_admin').ilike('username', `%${text.trim()}%`).limit(10);
    setSearchProfiles((data ?? []) as Profile[]);
  }

  async function moderate(post: Post, status: 'approved' | 'rejected') {
    if (!supabase) return;
    const { error } = await supabase.from('posts').update({ status }).eq('id', post.id);
    if (error) return alertUser('Update failed', error.message);
    await load();
  }

  async function saveProfile() {
    if (!supabase || !session) return;
    const { error } = await supabase.from('profiles').update({ display_name: profileName.trim(), bio: profileBio.trim() }).eq('id', session.user.id);
    if (error) return alertUser('Profile did not save', error.message);
    await load(); alertUser('Profile saved', 'Your changes are live.');
  }

  async function closeReport(id: string, status: 'reviewed' | 'dismissed') {
    const { error } = await supabase!.from('reports').update({ status }).eq('id', id);
    if (error) return alertUser('Report update failed', error.message);
    setReports(old => old.filter(r => r.id !== id));
  }

  if (!isBackendConfigured) return <SetupScreen />;
  if (!session) return <AuthScreen mode={authMode} setMode={setAuthMode} email={email} setEmail={setEmail} password={password} setPassword={setPassword} username={username} setUsername={setUsername} busy={busy} onSubmit={authenticate} />;

  return <SafeAreaView style={s.safe}><StatusBar barStyle="dark-content" backgroundColor={theme.canvas} />
    <View style={s.header}><View style={s.brand}><Text style={s.brandMark}>↗</Text><Text style={s.brandName}>loop</Text></View><Pressable onPress={() => setPage('wallet')} style={s.coinPill}><Text>✦</Text><Text style={{ fontWeight: '800' }}> 0</Text></Pressable></View>
    <ScrollView style={s.main} contentContainerStyle={{ paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
      {page === 'home' && <><View style={s.headingRow}><View><Text style={s.h1}>Your feed</Text><Text style={s.sub}>Small moments from your people.</Text></View><Pressable onPress={load}><Text style={s.actionText}>{refreshing ? '…' : '↻'}</Text></Pressable></View><Feed posts={filteredPosts} userId={session.user.id} following={following} onLike={toggleLike} onComment={openComments} onReport={reportPost} onFollow={toggleFollow} onRemove={async p => { const yes = Platform.OS === 'web' ? window.confirm('Delete this post?') : true; if (!yes) return; await supabase!.from('posts').delete().eq('id', p.id); await load(); }} />
      </>}
      {page === 'discover' && <><Text style={s.h1}>Discover</Text><TextInput value={query} onChangeText={searchUsers} placeholder="Search people and posts" style={s.input} placeholderTextColor={theme.muted} />{searchProfiles.length > 0 && <View style={s.card}><Text style={s.cardTitle}>People</Text>{searchProfiles.map(p => <View key={p.id} style={s.personRow}><Avatar url={p.avatar_url} name={p.display_name} /><View style={{ flex: 1 }}><Text style={s.bold}>{p.display_name}</Text><Text style={s.sub}>@{p.username}</Text></View><FollowButton following={following.includes(p.id)} onPress={() => toggleFollow(p.id)} /></View>)}</View>}<Feed posts={filteredPosts} userId={session.user.id} following={following} onLike={toggleLike} onComment={openComments} onReport={reportPost} onFollow={toggleFollow} onRemove={async p => { await supabase!.from('posts').delete().eq('id', p.id); await load(); }} />
      </>}
      {page === 'upload' && <><Text style={s.h1}>Create a post</Text><Text style={s.sub}>Photos and short videos up to 90 seconds.</Text><Pressable style={s.mediaPicker} onPress={chooseMedia}><Text style={s.pickIcon}>▧</Text><Text style={s.bold}>{picked?.fileName || (picked?.type === 'video' ? 'Video selected' : 'Choose photo or video')}</Text><Text style={s.sub}>Select from your device</Text>{picked?.uri && <Image source={{ uri: picked.uri }} style={s.pickedPreview} />}</Pressable><TextInput value={caption} onChangeText={setCaption} multiline placeholder="Write a caption…" style={[s.input, { minHeight: 100, textAlignVertical: 'top' }]} placeholderTextColor={theme.muted} maxLength={500} /><Pressable onPress={publishPost} style={s.primaryButton}><Text style={s.primaryText}>{busy ? 'Uploading…' : 'Share for review'}</Text></Pressable><Text style={s.smallNote}>New posts enter review before they appear in the public feed.</Text></>}
      {page === 'wallet' && <><Text style={s.h1}>Rewards</Text><View style={s.rewardCard}><Text style={s.rewardLabel}>COIN WALLET</Text><Text style={s.rewardBalance}>✦ {walletCount}</Text><Text style={s.rewardDescription}>Rewards are disabled while the earning model is reviewed.</Text></View><View style={s.card}><Text style={s.cardTitle}>A safer launch plan</Text><Text style={s.body}>We’ll first launch the community features and moderation tools. We can revisit in-app points only after confirming the rules for the exact reward. Cash, gift cards, transferable points, and revenue sharing are not enabled.</Text><View style={s.warning}><Text style={s.warningText}>No ads are served and no coins are paid out in this build.</Text></View></View></>}
      {page === 'profile' && <><View style={s.profileTop}><Avatar url={profile?.avatar_url} name={profile?.display_name ?? 'You'} large /><View style={{ flex: 1 }}><Text style={s.h1}>{profile?.display_name ?? 'Your profile'}</Text><Text style={s.sub}>@{profile?.username ?? ''}</Text></View><Pressable onPress={signOut}><Text style={s.actionText}>Sign out</Text></Pressable></View><View style={s.card}><Text style={s.cardTitle}>Edit profile</Text><TextInput value={profileName} onChangeText={setProfileName} placeholder="Display name" style={s.input} maxLength={50} /><TextInput value={profileBio} onChangeText={setProfileBio} placeholder="A little about you" style={[s.input, { minHeight: 80, textAlignVertical: 'top' }]} multiline maxLength={300} /><Pressable style={s.primaryButton} onPress={saveProfile}><Text style={s.primaryText}>Save profile</Text></Pressable></View><Text style={s.cardTitle}>Your posts</Text><Feed posts={posts.filter(p => p.user_id === session.user.id)} userId={session.user.id} following={following} onLike={toggleLike} onComment={openComments} onReport={reportPost} onFollow={toggleFollow} onRemove={async p => { await supabase!.from('posts').delete().eq('id', p.id); await load(); }} /></>}
      {page === 'moderation' && profile?.is_admin && <><Text style={s.h1}>Review queue</Text><Text style={s.sub}>Approve appropriate posts; reject content that breaks the rules.</Text><Feed posts={posts.filter(p => p.status === 'pending')} userId={session.user.id} following={following} onLike={toggleLike} onComment={openComments} onReport={reportPost} onFollow={toggleFollow} onRemove={async p => { await moderate(p, 'rejected'); }} onApprove={p => moderate(p, 'approved')} admin /><View style={s.card}><Text style={s.cardTitle}>Open reports ({reports.length})</Text>{reports.map(r => <View key={r.id} style={s.personRow}><View style={{ flex: 1 }}><Text style={s.bold}>{r.target_type} report</Text><Text style={s.sub}>{r.reason} · {r.target_id.slice(0, 8)}</Text></View><Pressable onPress={() => closeReport(r.id, 'reviewed')}><Text style={s.approveText}>Review</Text></Pressable><Pressable onPress={() => closeReport(r.id, 'dismissed')}><Text style={s.rejectText}>Dismiss</Text></Pressable></View>)}{reports.length === 0 && <Text style={s.sub}>No open reports.</Text>}</View></>}
      {page === 'moderation' && !profile?.is_admin && <Text style={s.sub}>This page is only available to moderators.</Text>}
    </ScrollView>
    <View style={s.tabbar}>{([['home', '⌂', 'Home'], ['discover', '⌕', 'Explore'], ['upload', '+', 'Post'], ['wallet', '✦', 'Rewards'], ['profile', '◯', 'Profile']] as [Page, string, string][]).map(([key, icon, label]) => <Pressable key={key} onPress={() => setPage(key)} style={s.tab}><Text style={[s.tabIcon, page === key && s.tabIconActive]}>{icon}</Text><Text style={[s.tabLabel, page === key && s.tabLabelActive]}>{label}</Text></Pressable>)}{profile?.is_admin && <Pressable onPress={() => setPage('moderation')} style={s.tab}><Text style={s.tabIcon}>✓</Text><Text style={s.tabLabel}>Review</Text></Pressable>}</View>
    {commentPost && <View style={s.modalShade}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.modalCard}><View style={s.headingRow}><Text style={s.cardTitle}>Comments</Text><Pressable onPress={() => setCommentPost(null)}><Text style={s.actionText}>Close</Text></Pressable></View><ScrollView style={{ maxHeight: 280 }}>{commentRows.map(row => <View key={row.id} style={s.commentRow}><Text style={s.bold}>@{row.profiles?.username ?? 'member'} </Text><Text style={s.body}>{row.body}</Text></View>)}{commentRows.length === 0 && <Text style={s.sub}>No comments yet.</Text>}</ScrollView><View style={s.commentComposer}><TextInput value={commentText} onChangeText={setCommentText} placeholder="Write a comment" style={[s.input, { flex: 1, marginBottom: 0 }]} /><Pressable onPress={addComment} style={s.commentSend}><Text style={s.primaryText}>Post</Text></Pressable></View></KeyboardAvoidingView></View>}
  </SafeAreaView>;
}

function AuthScreen(props: { mode: 'in' | 'up'; setMode: (v: 'in' | 'up') => void; email: string; setEmail: (v: string) => void; password: string; setPassword: (v: string) => void; username: string; setUsername: (v: string) => void; busy: boolean; onSubmit: () => void }) {
  return <SafeAreaView style={s.safe}><View style={s.authWrap}><View style={s.brand}><Text style={s.brandMark}>↗</Text><Text style={s.brandName}>loop</Text></View><Text style={s.authTitle}>{props.mode === 'in' ? 'Good to see you.' : 'Make a little space.'}</Text><Text style={[s.sub, { marginBottom: 22 }]}>{props.mode === 'in' ? 'Sign in to your community.' : 'Create an account to join the community.'}</Text>{props.mode === 'up' && <TextInput value={props.username} onChangeText={props.setUsername} autoCapitalize="none" placeholder="Username" style={s.input} placeholderTextColor={theme.muted} />}<TextInput value={props.email} onChangeText={props.setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="Email address" style={s.input} placeholderTextColor={theme.muted} /><TextInput value={props.password} onChangeText={props.setPassword} secureTextEntry placeholder="Password" style={s.input} placeholderTextColor={theme.muted} /><Pressable disabled={props.busy} onPress={props.onSubmit} style={s.primaryButton}><Text style={s.primaryText}>{props.busy ? 'One moment…' : props.mode === 'in' ? 'Sign in' : 'Create account'}</Text></Pressable><Pressable onPress={() => props.setMode(props.mode === 'in' ? 'up' : 'in')} style={{ padding: 15 }}><Text style={s.centerText}>{props.mode === 'in' ? 'New here? Create an account' : 'Already have an account? Sign in'}</Text></Pressable><Text style={s.smallNote}>By continuing, you agree to follow the community guidelines.</Text></View></SafeAreaView>;
}

function SetupScreen() { return <SafeAreaView style={s.safe}><View style={s.authWrap}><View style={s.brand}><Text style={s.brandMark}>↗</Text><Text style={s.brandName}>loop</Text></View><Text style={s.authTitle}>Cloud setup needed</Text><Text style={s.body}>The app is ready for shared accounts, posts, likes, comments, follows, uploads, search, and review. Connect a Supabase project to enable them.</Text><View style={s.card}><Text style={s.cardTitle}>To connect your project</Text><Text style={s.body}>1. Create a Supabase project.{ '\n' }2. Copy .env.example to .env and add its Project URL and publishable key.{ '\n' }3. Run supabase/schema.sql in the project SQL editor.{ '\n' }4. Start the app with npm install, then npm run web or npm run android.</Text></View><Text style={s.smallNote}>Only the public publishable key belongs in the app. Never place a service role key here.</Text></View></SafeAreaView>; }

function Avatar({ url, name, large = false }: { url?: string | null; name: string; large?: boolean }) { return url ? <Image source={{ uri: url }} style={[s.avatar, large && s.avatarLarge]} /> : <View style={[s.avatar, large && s.avatarLarge, s.avatarFallback]}><Text style={s.avatarInitial}>{name.slice(0, 1).toUpperCase()}</Text></View>; }
function FollowButton({ following, onPress }: { following: boolean; onPress: () => void }) { return <Pressable onPress={onPress} style={[s.followButton, following && s.followingButton]}><Text style={[s.followText, following && s.followingText]}>{following ? 'Following' : 'Follow'}</Text></Pressable>; }

function PostVideo({ uri }: { uri: string }) { const player = useVideoPlayer(uri, p => { p.loop = false; }); return <VideoView player={player} style={s.postImage} contentFit="cover" nativeControls playsInline />; }

function Feed({ posts, userId, following, onLike, onComment, onReport, onFollow, onRemove, onApprove, admin = false }: { posts: Post[]; userId: string; following: string[]; onLike: (p: Post) => void; onComment: (p: Post) => void; onReport: (p: Post) => void; onFollow: (id: string) => void; onRemove: (p: Post) => void; onApprove?: (p: Post) => void; admin?: boolean }) {
  if (!posts.length) return <View style={s.empty}><Text style={s.emptyIcon}>◌</Text><Text style={s.cardTitle}>Your feed starts here</Text><Text style={s.sub}>Search for people or share your first photo or video.</Text></View>;
  return <FlatList data={posts} keyExtractor={item => item.id} scrollEnabled={false} renderItem={({ item }) => { const liked = item.likes?.some(x => x.user_id === userId); const mine = item.user_id === userId; return <View style={s.post}><View style={s.postHeader}><Avatar url={item.profiles?.avatar_url} name={item.profiles?.display_name ?? 'Member'} /><View style={{ flex: 1 }}><Text style={s.bold}>{item.profiles?.display_name ?? 'Loop member'}</Text><Text style={s.sub}>@{item.profiles?.username ?? 'member'} · {item.status === 'pending' ? 'Under review' : new Date(item.created_at).toLocaleDateString()}</Text></View>{!mine && <FollowButton following={following.includes(item.user_id)} onPress={() => onFollow(item.user_id)} />}{mine && <Pressable onPress={() => onRemove(item)}><Text style={s.actionText}>···</Text></Pressable>}</View>{item.media_type === 'video' ? <PostVideo uri={item.media_url} /> : <Image source={{ uri: item.media_url }} style={s.postImage} resizeMode="cover" />}<Text style={s.caption}>{item.caption || 'A little moment.'}</Text><View style={s.postActions}><Pressable onPress={() => onLike(item)}><Text style={[s.actionText, liked && { color: '#ec5271' }]}>{liked ? '♥' : '♡'} {item.likes?.length ?? 0}</Text></Pressable><Pressable onPress={() => onComment(item)}><Text style={s.actionText}>▢ {item.comments?.length ?? 0}</Text></Pressable><Pressable onPress={() => onReport(item)}><Text style={s.sub}>Report</Text></Pressable>{admin && onApprove && <><Pressable onPress={() => onApprove(item)}><Text style={s.approveText}>Approve</Text></Pressable><Pressable onPress={() => onRemove(item)}><Text style={s.rejectText}>Reject</Text></Pressable></>}</View></View>; }} />;
}

const s = StyleSheet.create({ safe: { flex: 1, backgroundColor: theme.canvas }, header: { height: 58, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomColor: theme.line, borderBottomWidth: 1, backgroundColor: theme.canvas }, brand: { flexDirection: 'row', alignItems: 'center', gap: 8 }, brandMark: { width: 32, height: 32, textAlign: 'center', textAlignVertical: 'center', borderRadius: 11, overflow: 'hidden', backgroundColor: theme.lime, fontSize: 19, fontWeight: '800', color: theme.ink }, brandName: { fontSize: 25, fontWeight: '900', letterSpacing: -1.5, color: theme.ink }, coinPill: { backgroundColor: '#fff', borderRadius: 99, paddingVertical: 9, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center' }, main: { flex: 1, width: '100%', maxWidth: 680, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 18 }, headingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }, h1: { color: theme.ink, fontSize: 25, fontWeight: '800', letterSpacing: -0.6 }, sub: { fontSize: 12, color: theme.muted, marginTop: 4 }, actionText: { color: theme.ink, fontSize: 17, fontWeight: '700', padding: 4 }, tabbar: { minHeight: 62, paddingBottom: Platform.OS === 'web' ? 4 : 6, borderTopWidth: 1, borderTopColor: theme.line, backgroundColor: '#fff', flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' }, tab: { flex: 1, alignItems: 'center', gap: 1 }, tabIcon: { fontSize: 20, color: theme.muted, height: 25 }, tabIconActive: { color: theme.ink }, tabLabel: { fontSize: 10, color: theme.muted }, tabLabelActive: { color: theme.ink, fontWeight: '800' }, post: { backgroundColor: '#fff', borderWidth: 1, borderColor: theme.line, borderRadius: 19, overflow: 'hidden', marginBottom: 15 }, postHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13 }, avatar: { width: 38, height: 38, borderRadius: 50, backgroundColor: '#e9e9e3' }, avatarLarge: { width: 70, height: 70 }, avatarFallback: { justifyContent: 'center', alignItems: 'center', backgroundColor: '#e7e4fb' }, avatarInitial: { color: theme.violet, fontSize: 17, fontWeight: '800' }, bold: { fontSize: 13, fontWeight: '800', color: theme.ink }, postImage: { width: '100%', aspectRatio: 1, backgroundColor: '#eee' }, videoTag: { position: 'absolute', top: 70, right: 14, color: '#fff', backgroundColor: '#0009', overflow: 'hidden', borderRadius: 9, padding: 7, fontSize: 11 }, caption: { color: theme.ink, fontSize: 13, lineHeight: 19, paddingHorizontal: 14, paddingTop: 12 }, postActions: { flexDirection: 'row', alignItems: 'center', gap: 20, padding: 14, paddingTop: 12 }, card: { backgroundColor: '#fff', borderColor: theme.line, borderWidth: 1, borderRadius: 17, padding: 17, marginVertical: 10 }, cardTitle: { fontWeight: '800', fontSize: 16, color: theme.ink, marginBottom: 9 }, body: { color: '#5d5d56', fontSize: 13, lineHeight: 20 }, input: { backgroundColor: '#fff', borderWidth: 1, borderColor: theme.line, borderRadius: 13, padding: 13, fontSize: 14, color: theme.ink, marginBottom: 11 }, personRow: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 8 }, followButton: { paddingHorizontal: 12, paddingVertical: 8, backgroundColor: theme.ink, borderRadius: 10 }, followText: { color: '#fff', fontWeight: '800', fontSize: 11 }, followingButton: { backgroundColor: '#f0f0eb' }, followingText: { color: '#66665f' }, mediaPicker: { borderWidth: 1, borderColor: '#d9d9d0', borderStyle: 'dashed', borderRadius: 18, padding: 24, backgroundColor: '#fff', alignItems: 'center', marginVertical: 17, gap: 8 }, pickIcon: { fontSize: 35, color: theme.violet }, pickedPreview: { width: 150, height: 150, borderRadius: 14, marginTop: 9 }, primaryButton: { backgroundColor: theme.ink, borderRadius: 13, padding: 15, alignItems: 'center', marginTop: 6 }, primaryText: { color: '#fff', fontWeight: '800', fontSize: 13 }, smallNote: { color: theme.muted, fontSize: 11, textAlign: 'center', marginTop: 13, lineHeight: 17 }, rewardCard: { borderRadius: 22, backgroundColor: theme.ink, padding: 23, marginTop: 20, marginBottom: 10 }, rewardLabel: { color: '#c7c7c0', fontSize: 10, letterSpacing: 1.4, fontWeight: '700' }, rewardBalance: { color: theme.lime, fontSize: 34, fontWeight: '900', marginVertical: 10 }, rewardDescription: { color: '#d2d2cc', fontSize: 12, lineHeight: 18 }, warning: { backgroundColor: theme.amber, borderRadius: 11, padding: 12, marginTop: 14 }, warningText: { color: '#75622c', fontSize: 11, lineHeight: 16 }, profileTop: { flexDirection: 'row', alignItems: 'center', gap: 13, marginVertical: 14 }, empty: { alignItems: 'center', backgroundColor: '#fff', padding: 30, borderRadius: 18, marginTop: 10 }, emptyIcon: { fontSize: 28, color: theme.violet, marginBottom: 8 }, modalShade: { position: 'absolute', top: 0, left: 0, bottom: 0, right: 0, backgroundColor: '#0007', justifyContent: 'center', padding: 16 }, modalCard: { backgroundColor: '#fff', padding: 18, borderRadius: 20, maxWidth: 500, width: '100%', alignSelf: 'center' }, commentRow: { flexDirection: 'row', marginVertical: 9 }, commentComposer: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 12 }, commentSend: { backgroundColor: theme.ink, paddingHorizontal: 15, paddingVertical: 12, borderRadius: 12 }, approveText: { color: '#287445', fontWeight: '800', fontSize: 12 }, rejectText: { color: '#b44242', fontWeight: '800', fontSize: 12 }, authWrap: { width: '100%', maxWidth: 440, alignSelf: 'center', padding: 22, paddingTop: 48 }, authTitle: { color: theme.ink, fontSize: 29, letterSpacing: -1, fontWeight: '900', marginTop: 35, marginBottom: 5 }, centerText: { color: theme.violet, fontWeight: '700', textAlign: 'center' } });

