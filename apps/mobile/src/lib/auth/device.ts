// Device identity and secure token storage (spec 1.1, 8.2).
//
// iPhone/Android: the device ID and the session are kept in the Keychain / Keystore through
// expo-secure-store with WHEN_UNLOCKED_THIS_DEVICE_ONLY — the strictest option that works on
// every phone (WHEN_PASSCODE_SET_THIS_DEVICE_ONLY would fail outright without a passcode), never
// restored to another device from a backup. Web: nothing here — the web server in front of the
// app keeps the session and the device ID in httpOnly cookies (decision 10).
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const DEVICE_KEY = 'lifeos.device_id';
const SESSION_KEY = 'lifeos.session';

export function base64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let deviceId: string | null = null;

/** A random 128-bit ID kept on this device (spec 1.1). Only its SHA-256 is stored server-side. */
export async function getDeviceId(): Promise<string> {
  if (deviceId) return deviceId;
  const stored = await SecureStore.getItemAsync(DEVICE_KEY, OPTIONS);
  if (stored) return (deviceId = stored);
  deviceId = base64Url(Crypto.getRandomBytes(16));
  await SecureStore.setItemAsync(DEVICE_KEY, deviceId, OPTIONS);
  return deviceId;
}

export function devicePlatform(): 'ios' | 'android' | 'web' {
  return Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
}

/** "iPhone", "iPad", "Android phone" — what S-4 shows. No model fingerprinting. */
export function deviceLabel(): string {
  if (Platform.OS === 'ios') return (Platform as { isPad?: boolean }).isPad ? 'iPad' : 'iPhone';
  if (Platform.OS === 'android') return 'Android phone';
  return 'Web browser';
}

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  /** Seconds since epoch. */
  expiresAt: number;
}

export const tokenStore = {
  async load(): Promise<StoredSession | null> {
    const raw = await SecureStore.getItemAsync(SESSION_KEY, OPTIONS);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredSession;
    } catch {
      return null;
    }
  },
  async save(s: StoredSession): Promise<void> {
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(s), OPTIONS);
  },
  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(SESSION_KEY, OPTIONS);
  },
};

/** SHA-256 hex (Apple native nonce, PKCE). */
export function sha256Hex(text: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text);
}

export async function sha256Base64Url(text: string): Promise<string> {
  const b64 = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomToken(): string {
  return base64Url(Crypto.getRandomBytes(32));
}
