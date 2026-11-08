// Development-only notes that explain local set-up instead of a confusing screen:
//   B4  0b-8i after a local database reset ("We don't recognise that account" is right, but
//       surprising: the reset erased the account).
//   D2  Apple/Google tapped on a local web build without their web ids → a note, not 0b-8g.
// Release builds keep the wireframes' copy exactly.
import path from 'node:path';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { DB_RESET_NOTE } from '@/features/auth/TicketScreen';
import type * as WebProviders from '@/lib/auth/webProviders';
import { createMemoryBackend, type MemoryBackend } from '@/test/memoryBackend';
import type { MemoryAuthState } from '@/test/memoryAuth';

const APP_DIR = path.resolve(__dirname, '../app');
let mockBackend: MemoryBackend;
let mockWebSetup: 'WEB_APPLE_SETUP' | 'WEB_GOOGLE_SETUP' | null = null;
jest.mock('@/lib/backend/current', () => ({ getBackend: () => mockBackend }));
jest.mock('@/lib/notifications', () => ({ requestNotificationPermission: async () => 'granted' }));
jest.mock('@/lib/auth/webProviders', () => ({
  ...jest.requireActual('@/lib/auth/webProviders'),
  webProviderSetupMissing: jest.fn((p: 'APPLE' | 'GOOGLE') =>
    mockWebSetup && mockWebSetup.includes(p) ? mockWebSetup : null,
  ),
}));

const g = globalThis as unknown as { __DEV__: boolean };
const realDev = g.__DEV__;
afterEach(() => {
  g.__DEV__ = realDev;
  mockWebSetup = null;
});

async function start(auth: Partial<MemoryAuthState>, url: string) {
  mockBackend = createMemoryBackend({}, auth);
  await renderRouter(APP_DIR, { initialUrl: url });
  await screen.findByTestId(/^screen-/, undefined, { timeout: 10_000 });
}
const press = (name: string | RegExp) => fireEvent.press(screen.getByRole('button', { name }));

describe('B4: 0b-8i after a local database reset', () => {
  it('development: explains that a db reset erases every account', async () => {
    await start({ provider: { email: 'reset@example.test', sub: 'a-after-reset' } }, '/sign-in');
    await press('Continue with Apple');
    expect(await screen.findByTestId('screen-0b-8i')).toBeTruthy();
    expect(screen.getByTestId('dev-note-db-reset')).toBeTruthy();
    expect(
      screen.getByText(
        'Local data was reset? `supabase db reset` erases every account — create it again.',
      ),
    ).toBeTruthy();
    // The wireframe copy is still there, unchanged.
    expect(screen.getByText("We don't recognise that account")).toBeTruthy();
    expect(
      screen.getByText('Picked the wrong Apple account? Try again and choose another.'),
    ).toBeTruthy();
  });

  it('release build: the wireframe copy only, no development note', async () => {
    g.__DEV__ = false;
    await start({ provider: { email: 'reset@example.test', sub: 'a-after-reset' } }, '/sign-in');
    await press('Continue with Apple');
    expect(await screen.findByTestId('screen-0b-8i')).toBeTruthy();
    expect(screen.queryByTestId('dev-note-db-reset')).toBeNull();
    expect(screen.queryByText(DB_RESET_NOTE)).toBeNull();
  });

  it('0b-8h (account exists) never shows it', async () => {
    await start(
      {
        accounts: [{ id: 'a', email: 'x@example.test', method: 'APPLE', confirmed: true }],
        provider: { email: 'x@example.test', sub: 'a' },
      },
      '/sign-up',
    );
    await press('Continue with Apple');
    expect(await screen.findByTestId('screen-0b-8h')).toBeTruthy();
    expect(screen.queryByTestId('dev-note-db-reset')).toBeNull();
  });
});

describe('D2: Apple/Google on a local web build without their web ids', () => {
  it.each([
    [
      'APPLE',
      'Continue with Apple',
      'Apple sign-in on the web needs an Apple Services ID and an HTTPS address — see README. Use email here.',
    ],
    [
      'GOOGLE',
      'Continue with Google',
      'Google sign-in on the web needs a Google web client id — see README. Use email here.',
    ],
  ] as const)(
    '%s: a development note instead of 0b-8g; the provider is never called',
    async (p, button, body) => {
      mockWebSetup = p === 'APPLE' ? 'WEB_APPLE_SETUP' : 'WEB_GOOGLE_SETUP';
      await start({ provider: { email: 'web@example.test', sub: 'w1' } }, '/sign-up');
      await act(async () => {
        press(button);
      });
      expect(await screen.findByText(body)).toBeTruthy();
      expect(screen.queryByTestId('screen-0b-8g')).toBeNull();
      expect(screen.getByTestId('screen-0b-1')).toBeTruthy();
      expect(mockBackend.auth.auth.calls.filter((c) => c.includes(p))).toEqual([]);
    },
  );

  it('with the ids set, the provider goes ahead as usual', async () => {
    mockWebSetup = null;
    await start({ provider: { email: 'web@example.test', sub: 'w2' } }, '/sign-up');
    press('Continue with Apple');
    expect(await screen.findByTestId('screen-onboarding-consent', undefined, { timeout: 10_000 }));
  });
});

describe('D2: webProviderSetupMissing', () => {
  const { webProviderSetupMissing } =
    jest.requireActual<typeof WebProviders>('@/lib/auth/webProviders');
  const full = {
    appleServicesId: 'test.lifeos.web',
    appleRedirectUri: 'https://lifeos.example.test/auth/apple',
    googleWebClientId: 'web.apps.example.test',
  };
  it('only on a development web build', () => {
    expect(webProviderSetupMissing('APPLE', {}, true, 'ios')).toBeNull();
    expect(webProviderSetupMissing('APPLE', {}, false, 'web')).toBeNull();
    expect(webProviderSetupMissing('APPLE', {}, true, 'web')).toBe('WEB_APPLE_SETUP');
    expect(webProviderSetupMissing('GOOGLE', {}, true, 'web')).toBe('WEB_GOOGLE_SETUP');
  });
  it('Apple needs the Services ID and an HTTPS return address; Google its web client id', () => {
    expect(webProviderSetupMissing('APPLE', full, true, 'web')).toBeNull();
    expect(webProviderSetupMissing('GOOGLE', full, true, 'web')).toBeNull();
    expect(webProviderSetupMissing('APPLE', { ...full, appleServicesId: '' }, true, 'web')).toBe(
      'WEB_APPLE_SETUP',
    );
    expect(
      webProviderSetupMissing(
        'APPLE',
        { ...full, appleRedirectUri: 'http://localhost:8081/auth/apple' },
        true,
        'web',
      ),
    ).toBe('WEB_APPLE_SETUP');
    expect(
      webProviderSetupMissing('GOOGLE', { ...full, googleWebClientId: undefined }, true, 'web'),
    ).toBe('WEB_GOOGLE_SETUP');
  });
});
