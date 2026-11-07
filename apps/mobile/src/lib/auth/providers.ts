// Apple and Google UIs (spec 2.7). Each returns an ID token bound to auth-api's single-use nonce.
//
//   iPhone Apple   native sheet (expo-apple-authentication); request nonce = SHA256(raw nonce).
//   iPhone Google  Google's own sign-in page in ASWebAuthenticationSession: authorisation code +
//                  PKCE + nonce, exchanged for an ID token with the iOS client (no secret). The
//                  native Google SDK in this project (@react-native-google-signin v17, free
//                  "original" API) can't pass a nonce, so it isn't used (docs/SPEC-QUESTIONS.md).
//   Web Apple      Sign in with Apple JS, pop-up; raw nonce.
//   Web Google     Google Identity Services; raw nonce.
// Android: later (decision 9).
import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { AuthError } from './errors';
import { randomToken, sha256Base64Url, sha256Hex } from './device';

export class ProviderCancelled extends Error {
  override name = 'ProviderCancelled';
}

export interface ProviderResult {
  idToken: string;
  authorizationCode?: string;
  givenName?: string;
}

const env = {
  googleIos: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  googleWeb: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  appleServices: process.env.EXPO_PUBLIC_APPLE_SERVICES_ID,
  appleRedirect: process.env.EXPO_PUBLIC_APPLE_WEB_REDIRECT_URI,
};

export async function appleIdToken(nonce: string): Promise<ProviderResult> {
  if (Platform.OS === 'ios') {
    try {
      const c = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: await sha256Hex(nonce),
      });
      if (!c.identityToken) throw new AuthError('PROVIDER_ERROR');
      return {
        idToken: c.identityToken,
        authorizationCode: c.authorizationCode ?? undefined,
        // Apple only sends the name on the very first authorisation (spec 2.7.6).
        givenName: c.fullName?.givenName?.trim() || undefined,
      };
    } catch (err) {
      if ((err as { code?: string }).code === 'ERR_REQUEST_CANCELED') throw new ProviderCancelled();
      throw err;
    }
  }
  if (Platform.OS === 'web') return appleWeb(nonce);
  throw new AuthError('PROVIDER_ERROR');
}

export async function googleIdToken(nonce: string): Promise<ProviderResult> {
  if (Platform.OS === 'web') return googleWeb(nonce);
  if (Platform.OS === 'ios') return googleIos(nonce);
  throw new AuthError('PROVIDER_ERROR');
}

/** Authorisation code + PKCE in ASWebAuthenticationSession; the ID token carries our nonce. */
async function googleIos(nonce: string): Promise<ProviderResult> {
  const clientId = env.googleIos;
  if (!clientId) throw new AuthError('PROVIDER_ERROR');
  const scheme = `com.googleusercontent.apps.${clientId.replace('.apps.googleusercontent.com', '')}`;
  const redirectUri = `${scheme}:/oauth2redirect`;
  const verifier = randomToken();
  const state = randomToken();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    code_challenge: await sha256Base64Url(verifier),
    code_challenge_method: 'S256',
    nonce,
    state,
    prompt: 'select_account',
  });
  const result = await WebBrowser.openAuthSessionAsync(
    `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    redirectUri,
    { preferEphemeralSession: true },
  );
  if (result.type !== 'success') throw new ProviderCancelled();
  const back = new URL(result.url);
  if (back.searchParams.get('state') !== state) throw new AuthError('PROVIDER_ERROR');
  const code = back.searchParams.get('code');
  if (!code) throw new AuthError('PROVIDER_ERROR');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }).toString(),
  });
  if (!res.ok) throw new AuthError('PROVIDER_ERROR');
  const data = (await res.json()) as { id_token?: string };
  if (!data.id_token) throw new AuthError('PROVIDER_ERROR');
  return { idToken: data.id_token };
}

// ---------------------------------------------------------------- web

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new AuthError('NETWORK'));
    document.head.appendChild(s);
  });
}

interface GoogleId {
  accounts: {
    id: {
      initialize(o: Record<string, unknown>): void;
      prompt(cb?: (n: { isNotDisplayed(): boolean; isSkippedMoment(): boolean }) => void): void;
      cancel(): void;
    };
  };
}

async function googleWeb(nonce: string): Promise<ProviderResult> {
  if (!env.googleWeb) throw new AuthError('PROVIDER_ERROR');
  await loadScript('https://accounts.google.com/gsi/client');
  const google = (window as unknown as { google: GoogleId }).google;
  return new Promise((resolve, reject) => {
    google.accounts.id.initialize({
      client_id: env.googleWeb,
      nonce,
      use_fedcm_for_prompt: true,
      callback: (r: { credential?: string }) =>
        r.credential ? resolve({ idToken: r.credential }) : reject(new AuthError('PROVIDER_ERROR')),
    });
    google.accounts.id.prompt((n) => {
      if (n.isNotDisplayed() || n.isSkippedMoment()) reject(new ProviderCancelled());
    });
  });
}

interface AppleId {
  auth: {
    init(o: Record<string, unknown>): void;
    signIn(): Promise<{
      authorization: { id_token: string; code?: string };
      user?: { name?: { firstName?: string } };
    }>;
  };
}

async function appleWeb(nonce: string): Promise<ProviderResult> {
  if (!env.appleServices || !env.appleRedirect) throw new AuthError('PROVIDER_ERROR');
  await loadScript(
    'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_GB/appleid.auth.js',
  );
  const AppleID = (window as unknown as { AppleID: AppleId }).AppleID;
  AppleID.auth.init({
    clientId: env.appleServices,
    scope: 'name email',
    redirectURI: env.appleRedirect,
    usePopup: true,
    nonce,
  });
  try {
    const r = await AppleID.auth.signIn();
    return {
      idToken: r.authorization.id_token,
      authorizationCode: r.authorization.code,
      givenName: r.user?.name?.firstName?.trim() || undefined,
    };
  } catch (err) {
    if ((err as { error?: string }).error === 'popup_closed_by_user') throw new ProviderCancelled();
    throw new AuthError('PROVIDER_ERROR');
  }
}
