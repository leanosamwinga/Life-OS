// The native Apple sheet, for the e2e test: signs an ID token with the local fake Apple key
// (scripts/local-auth/fakes.mjs) bound to the nonce the app passes in, like Apple does.
import { fakeProviders } from './providers';

export const AppleAuthenticationScope = { FULL_NAME: 0, EMAIL: 1 } as const;

export async function signInAsync(o: { nonce?: string }) {
  const next = fakeProviders.apple;
  if (!next) throw Object.assign(new Error('cancelled'), { code: 'ERR_REQUEST_CANCELED' });
  return {
    identityToken: await next(o.nonce ?? ''),
    authorizationCode: null,
    fullName: { givenName: 'Sam' },
  };
}
