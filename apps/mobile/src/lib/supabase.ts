import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import type { Database } from './database.types';

export type LifeOsClient = SupabaseClient<Database>;

export interface SupabaseEnv {
  url: string | undefined;
  anonKey: string | undefined;
}

/** EXPO_PUBLIC_* values are inlined at build time. Missing values mean "not connected". */
export function readSupabaseEnv(): SupabaseEnv {
  return {
    url: process.env.EXPO_PUBLIC_SUPABASE_URL,
    anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  };
}

export function isConfigured(env: SupabaseEnv): env is { url: string; anonKey: string } {
  return Boolean(env.url && env.anonKey);
}

/** Build a typed client, or `null` when env vars are missing so the app can still start. */
export function createSupabaseClient(env: SupabaseEnv = readSupabaseEnv()): LifeOsClient | null {
  if (!isConfigured(env)) return null;
  return createClient<Database>(env.url, env.anonKey, {
    auth: {
      // On web, supabase-js uses localStorage by default.
      ...(Platform.OS === 'web' ? {} : { storage: AsyncStorage }),
      autoRefreshToken: true,
      persistSession: true,
      // We finish magic links and OAuth ourselves in src/app/auth/callback.tsx.
      detectSessionInUrl: false,
      // PKCE: redirects carry a one-time `code` that only this device can exchange.
      flowType: 'pkce',
    },
  });
}

export const supabase: LifeOsClient | null = createSupabaseClient();
export const isSupabaseConnected = supabase !== null;
