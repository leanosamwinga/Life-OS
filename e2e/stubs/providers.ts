// What the fake Apple sheet and Google page hand back in the e2e test. The test sets these;
// the expo-apple-authentication and expo-web-browser stand-ins read them. Kept on globalThis so
// every "phone" (each one a fresh module graph, see newPhone) sees the same controls.
export interface FakeProviders {
  /** Apple's native sheet: gets the SHA-256 of auth-api's nonce, returns an ID token. */
  apple: ((hashedNonce: string) => Promise<string>) | null;
  /** Google's page: gets auth-api's raw nonce, returns the ID token the code exchange yields. */
  google: ((nonce: string) => Promise<string>) | null;
  /** Authorisation code → ID token, for the fake https://oauth2.googleapis.com/token. */
  googleCodes: Map<string, string>;
}

const g = globalThis as unknown as { __lifeosFakeProviders?: FakeProviders };
export const fakeProviders: FakeProviders = (g.__lifeosFakeProviders ??= {
  apple: null,
  google: null,
  googleCodes: new Map(),
});
