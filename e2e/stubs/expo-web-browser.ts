// Google's sign-in page in ASWebAuthenticationSession, for the e2e test: "signs in" at once and
// returns to the app with an authorisation code. The test's fetch answers the code exchange.
import { fakeProviders } from './providers';

let n = 0;

export async function openAuthSessionAsync(url: string, redirectUri: string) {
  const next = fakeProviders.google;
  if (!next) return { type: 'cancel' as const };
  const q = new URL(url).searchParams;
  const code = `fake-google-code-${++n}`;
  fakeProviders.googleCodes.set(code, await next(q.get('nonce') ?? ''));
  return {
    type: 'success' as const,
    url: `${redirectUri}?code=${code}&state=${encodeURIComponent(q.get('state') ?? '')}`,
  };
}

export function maybeCompleteAuthSession() {}
