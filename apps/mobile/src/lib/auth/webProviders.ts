// Apple and Google on the web need settings a local web build usually doesn't have:
//   Apple   an Apple Services ID (EXPO_PUBLIC_APPLE_SERVICES_ID) and an HTTPS return address
//           (EXPO_PUBLIC_APPLE_WEB_REDIRECT_URI) registered with Apple — never http://localhost;
//   Google  a Google web client id (EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID).
// Without them the provider can't even open, so a development build says what's missing instead
// of ending on 0b-8g (the same pattern as Google in Expo Go, expoGo.ts). Release builds keep the
// spec's 0b-8g. Real ids on an HTTPS address arrive with the web hosting work (Q-HOSTING, phase 7).
import { Platform } from 'react-native';
import type { Provider } from '../backend/types';

export interface WebProviderEnv {
  appleServicesId?: string;
  appleRedirectUri?: string;
  googleWebClientId?: string;
}

// Expo inlines EXPO_PUBLIC_* at build time only when they're read like this.
const BUILD_ENV: WebProviderEnv = {
  appleServicesId: process.env.EXPO_PUBLIC_APPLE_SERVICES_ID,
  appleRedirectUri: process.env.EXPO_PUBLIC_APPLE_WEB_REDIRECT_URI,
  googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
};

export type WebSetupCode = 'WEB_APPLE_SETUP' | 'WEB_GOOGLE_SETUP';

/** What a development web build is missing to open `provider`, or null if it can go ahead. */
export function webProviderSetupMissing(
  provider: Provider,
  env: WebProviderEnv = BUILD_ENV,
  dev: boolean = __DEV__,
  os: string = Platform.OS,
): WebSetupCode | null {
  if (os !== 'web' || !dev) return null;
  if (provider === 'APPLE') {
    const redirect = env.appleRedirectUri ?? '';
    const ok = !!env.appleServicesId && redirect.startsWith('https://');
    return ok ? null : 'WEB_APPLE_SETUP';
  }
  return env.googleWebClientId ? null : 'WEB_GOOGLE_SETUP';
}
