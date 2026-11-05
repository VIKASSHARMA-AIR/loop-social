import 'react-native-url-polyfill/auto';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const isBackendConfigured = Boolean(url && key && !url.includes('your-project') && !key.includes('your-supabase'));
export const supabase = isBackendConfigured
  ? createClient(url!, key!, { auth: { storage: Platform.OS === 'web' ? undefined : AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: Platform.OS === 'web' } })
  : null;

export type Profile = { id: string; username: string; display_name: string; avatar_url: string | null; bio: string | null; is_admin?: boolean };
export type Post = { id: string; user_id: string; media_path: string; media_url: string; media_type: 'image' | 'video'; caption: string; created_at: string; status: string; profiles: Profile; likes?: { user_id: string }[]; comments?: { id: string }[] };

