import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { AuthClient } from './auth/client';
import { defaultDeviceCheck } from './auth/deviceCheck';
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

export interface Connection {
  client: LifeOsClient;
  auth: AuthClient;
}

/**
 * Sign-in goes through auth-api (src/lib/auth/client.ts), not supabase-js auth: the Data API
 * client just asks AuthClient for the current access token (`accessToken`).
 * - iPhone: straight to Supabase, Bearer token from the Keychain.
 * - Web: everything through the web server in front of the app (/api/supabase, /api/auth),
 *   which adds the token from its httpOnly cookie, so this code never holds one.
 */
export function createConnection(env: SupabaseEnv = readSupabaseEnv()): Connection | null {
  if (!isConfigured(env)) return null;
  const web = Platform.OS === 'web';
  const origin = web && typeof window !== 'undefined' ? window.location.origin : '';
  const auth = new AuthClient({
    mode: web ? 'web' : 'native',
    baseUrl: web ? `${origin}/api/auth` : `${env.url}/functions/v1/auth-api`,
    anonKey: env.anonKey,
    deviceCheck: defaultDeviceCheck(),
  });
  const client = createClient<Database>(web ? `${origin}/api/supabase` : env.url, env.anonKey, {
    accessToken: async () => (web ? null : auth.accessToken()),
    global: web
      ? { fetch: (input, init) => fetch(input, { ...init, credentials: 'same-origin' }) }
      : undefined,
  });
  return { client, auth };
}

export const connection: Connection | null = createConnection();
export const isSupabaseConnected = connection !== null;
