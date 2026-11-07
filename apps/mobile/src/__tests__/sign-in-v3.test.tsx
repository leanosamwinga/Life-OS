// Sign-in v3 screens (wireframes v3 rows 1–9) against the in-memory auth fake.
// Test names carry the screen IDs.
import path from 'node:path';
import { act, fireEvent, renderRouter, screen, within } from 'expo-router/testing-library';
import { AuthError } from '@/lib/auth/errors';
import {
  BREACHED_PASSWORD,
  MEMORY_EMAIL_CODE,
  TEST_PASSWORD,
  createMemoryBackend,
  type MemoryBackend,
} from '@/test/memoryBackend';
import type { MemoryAccount, MemoryAuthState } from '@/test/memoryAuth';

const APP_DIR = path.resolve(__dirname, '../app');
let mockBackend: MemoryBackend;
jest.mock('@/lib/backend/current', () => ({ getBackend: () => mockBackend }));
jest.mock('@/lib/notifications', () => ({ requestNotificationPermission: async () => 'granted' }));

const EMAIL = 'sam@example.test';
const NEW_PASSWORD = 'another long unbreached passphrase';

async function start(
  auth: Partial<MemoryAuthState> = {},
  url = '/',
  data: Parameters<typeof createMemoryBackend>[0] = {},
) {
  mockBackend = createMemoryBackend(data, auth);
  await renderRouter(APP_DIR, { initialUrl: url });
  await screen.findByTestId(/^screen-/, undefined, { timeout: 10_000 });
}

const press = (name: string | RegExp) => fireEvent.press(screen.getByRole('button', { name }));
const type = (label: string | RegExp, text: string) =>
  fireEvent.changeText(screen.getByLabelText(label), text);
const onScreen = (id: string) => screen.findByTestId(`screen-${id}`);
const passwordAccount = (extra: Partial<MemoryAccount> = {}): MemoryAccount => ({
  id: 'user-pw',
  email: EMAIL,
  method: 'PASSWORD',
  password: TEST_PASSWORD,
  confirmed: true,
  ...extra,
});

const onboardedData = {
  healthConsent: true,
  settings: {
    ...createMemoryBackend().state.settings,
    onboardingCompletedAt: '2026-11-06T09:00:00Z',
  },
};

describe('rows 1–2: entry and method screens', () => {
  it('0a → 0b-1 offers Apple, Google and email; Apple wherever Google is; 0b-2 the same', async () => {
    await start();
    await press('Create account');
    await onScreen('0b-1');
    for (const b of ['Continue with Apple', 'Continue with Google', 'Continue with email'])
      expect(screen.getByRole('button', { name: b })).toBeTruthy();
    expect(screen.getByText(/Each email works with one sign-in method/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('link', { name: 'Sign in' }));
    await onScreen('0b-2');
    expect(screen.getByText('Welcome back')).toBeTruthy();
    for (const b of ['Continue with Apple', 'Continue with Google', 'Continue with email'])
      expect(screen.getByRole('button', { name: b })).toBeTruthy();
  });
});

describe('row 3: create with email (0b-3)', () => {
  it('password fields: secure entry, new-password autofill, Show/Hide only toggles masking', async () => {
    await start({}, '/sign-up/email');
    const pw = screen.getByTestId('field-password');
    expect(pw.props.secureTextEntry).toBe(true);
    expect(pw.props.textContentType).toBe('newPassword');
    expect(pw.props.autoComplete).toBe('new-password');
    await press('Show password');
    expect(screen.getByTestId('field-password').props.secureTextEntry).toBe(false);
    expect(screen.getByTestId('field-password').props.textContentType).toBe('newPassword');
    await press('Hide password');
    expect(screen.getByTestId('field-password').props.secureTextEntry).toBe(true);
  });

  it("0b-3d passwords don't match: checked on the device, both fields cleared, email kept", async () => {
    await start({}, '/sign-up/email');
    await type('Email', EMAIL);
    await type('Password', TEST_PASSWORD);
    await type('Confirm password', TEST_PASSWORD + 'x');
    await press('Create account');
    expect(await onScreen('0b-3d')).toBeTruthy();
    expect(screen.getByText("Passwords don't match. Type it again.")).toBeTruthy();
    expect(screen.getByTestId('field-password').props.value).toBe('');
    expect(screen.getByTestId('field-confirm').props.value).toBe('');
    expect(screen.getByTestId('field-email').props.value).toBe(EMAIL);
    expect(mockBackend.auth.auth.calls).not.toContain('createAccount');
  });

  it.each([
    ['0b-3e', 'q'.repeat(14), 'Too short. Use at least 15 characters.'],
    ['0b-3f', BREACHED_PASSWORD, 'Found in a data breach. Try another one.'],
    [
      '0b-3e',
      `my ${EMAIL} long password`,
      "Your password can't include your email. Try something else.",
    ],
  ])(
    '%s server password errors use spec copy and clear the passwords (%s)',
    async (id, password, copy) => {
      await start({}, '/sign-up/email');
      await type('Email', EMAIL);
      await type('Password', password);
      await type('Confirm password', password);
      await press('Create account');
      expect(await onScreen(id)).toBeTruthy();
      expect(screen.getByText(copy)).toBeTruthy();
      expect(screen.getByTestId('field-password').props.value).toBe('');
    },
  );

  it('0b-3g account exists → "Sign in instead" → 0b-5 with the email filled and the password empty', async () => {
    await start({ accounts: [passwordAccount()] }, '/sign-up/email');
    await type('Email', EMAIL);
    await type('Password', TEST_PASSWORD);
    await type('Confirm password', TEST_PASSWORD);
    await press('Create account');
    await onScreen('0b-3g');
    expect(screen.getByText('An account already exists for this email')).toBeTruthy();
    expect(screen.getByText("We'll fill in your email for you.")).toBeTruthy();
    await press('Sign in instead');
    await onScreen('0b-5b');
    expect(screen.getByTestId('field-email').props.value).toBe(EMAIL);
    expect(screen.getByTestId('field-password').props.value).toBe('');
  });

  it('0b-3h this email uses Google — nothing happens until the button is tapped', async () => {
    await start(
      {
        accounts: [{ id: 'g', email: EMAIL, method: 'GOOGLE', confirmed: true }],
        provider: { email: EMAIL, sub: 'g' },
      },
      '/sign-up/email',
    );
    await type('Email', EMAIL);
    await type('Password', TEST_PASSWORD);
    await type('Confirm password', TEST_PASSWORD);
    await press('Create account');
    await onScreen('0b-3h');
    expect(screen.getByText('This email uses Google to sign in')).toBeTruthy();
    expect(mockBackend.auth.auth.calls).not.toContain('signInWithProvider:GOOGLE');
    await press('Continue with Google');
    expect(mockBackend.auth.auth.calls).toContain('signInWithProvider:GOOGLE');
  });
});

describe('row 4: confirm code (0b-4)', () => {
  async function toCode() {
    await start({}, '/sign-up/email');
    await type('Email', EMAIL);
    await type('Password', TEST_PASSWORD);
    await type('Confirm password', TEST_PASSWORD);
    await press('Create account');
    return onScreen('0b-4a');
  }

  it('0b-4a resend waits 30 s; 0b-4c wrong code; 0b-4e the 5th wrong try; 0b-4d → a new code', async () => {
    await toCode();
    expect(screen.getByText(/It expires in 10 minutes/)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Resend available in/ }).props.accessibilityState.disabled,
    ).toBe(true);
    expect(screen.getByTestId('field-code').props.textContentType).toBe('oneTimeCode');
    for (let i = 0; i < 4; i++)
      await fireEvent.changeText(screen.getByTestId('field-code'), '000000');
    expect(await onScreen('0b-4c')).toBeTruthy();
    expect(
      screen.getByText("That code isn't right. Check the latest email and try again."),
    ).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('field-code'), '000001');
    await onScreen('0b-4e');
    expect(
      screen.getByText('That code no longer works. Ask for a new one. Your account is safe.'),
    ).toBeTruthy();
    await press('Send a new code');
    await onScreen('0b-4f');
    expect(screen.getByText('Use the newest code.')).toBeTruthy();
  });

  it('paste fills all six boxes and submits → 0b-4g → Continue → 0c', async () => {
    await toCode();
    await fireEvent.changeText(screen.getByTestId('field-code'), ` ${MEMORY_EMAIL_CODE} `);
    await onScreen('0b-4g');
    expect(screen.getByText('Email confirmed')).toBeTruthy();
    await press('Continue');
    expect(await screen.findByTestId('screen-onboarding-consent')).toBeTruthy();
  });

  it('expired → 0b-4d (CHALLENGE_NOT_FOUND is treated as expired)', async () => {
    await toCode();
    mockBackend.failNext('confirmEmail', new AuthError('CHALLENGE_NOT_FOUND'));
    await fireEvent.changeText(screen.getByTestId('field-code'), MEMORY_EMAIL_CODE);
    expect(await onScreen('0b-4d')).toBeTruthy();
    expect(screen.getByText('That code has expired')).toBeTruthy();
  });

  it('RESEND_LIMIT → "Too many codes"', async () => {
    await toCode();
    mockBackend.failNext('resendCode', new AuthError('RESEND_LIMIT', {}, 3600));
    mockBackend.failNext('confirmEmail', new AuthError('CODE_EXPIRED'));
    await fireEvent.changeText(screen.getByTestId('field-code'), MEMORY_EMAIL_CODE);
    await press('Send a new code');
    expect(await screen.findByText('Too many codes')).toBeTruthy();
  });
});

describe('row 5: sign in with email (0b-5)', () => {
  async function signInWith(
    accounts: MemoryAccount[],
    email: string,
    password: string,
    extra: Partial<MemoryAuthState> = {},
  ) {
    await start({ accounts, ...extra }, '/sign-in/email', onboardedData);
    await type('Email', email);
    await type('Password', password);
    await press('Sign in');
  }

  it('signs in → Today; current-password autofill', async () => {
    await start({ accounts: [passwordAccount()] }, '/sign-in/email', onboardedData);
    expect(screen.getByTestId('field-password').props.textContentType).toBe('password');
    await type('Email', EMAIL);
    await type('Password', TEST_PASSWORD);
    await press('Sign in');
    expect(await screen.findByTestId('screen-today')).toBeTruthy();
  });

  it('0b-5d wrong password: password cleared, email kept; no tries-left counter', async () => {
    await signInWith([passwordAccount()], EMAIL, 'definitely the wrong one');
    await onScreen('0b-5d');
    expect(screen.getByText("That password isn't right. Try again, or reset it.")).toBeTruthy();
    expect(screen.getByTestId('field-password').props.value).toBe('');
    expect(screen.getByTestId('field-email').props.value).toBe(EMAIL);
    expect(screen.queryByText(/left|remaining/i)).toBeNull();
  });

  it('0b-5f the 5th wrong try pauses: countdown on the button, Reset password offered', async () => {
    await signInWith([passwordAccount()], EMAIL, 'wrong 1 wrong 1');
    for (let i = 2; i <= 5; i++) {
      await type('Password', `wrong ${i} wrong ${i}`);
      await press('Sign in');
    }
    await onScreen('0b-5f');
    expect(screen.getByText('Too many tries')).toBeTruthy();
    expect(screen.getByText(/paused on this device for 15 minutes/)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Try again in 15 minutes/ }).props.accessibilityState
        .disabled,
    ).toBe(true);
    await press('Reset password');
    await onScreen('0b-7a');
    expect(screen.getByTestId('field-email').props.value).toBe(EMAIL);
  });

  it('0b-6d not recognised (real email): Apple hint, "Create account with this email" carries the email', async () => {
    await signInWith([], 'sam.taylor@outlook.example', TEST_PASSWORD);
    await onScreen('0b-6d');
    expect(screen.getByText(/Signed up with Apple and 'Hide My Email'\?/)).toBeTruthy();
    expect(screen.getByText('Typo? Fix it here and sign in again.')).toBeTruthy();
    await press('Create account with this email');
    await onScreen('0b-3a');
    expect(screen.getByTestId('field-email').props.value).toBe('sam.taylor@outlook.example');
    expect(screen.getByTestId('field-password').props.value).toBe('');
  });

  it('0b-5e not recognised (relay address) shows the short Apple note', async () => {
    await signInWith([], 'abc123@privaterelay.appleid.com', TEST_PASSWORD);
    await onScreen('0b-5e');
    expect(screen.getByText('Signed up with Apple? Try Continue with Apple instead.')).toBeTruthy();
  });

  it.each([
    [
      '0b-6a',
      { id: 'g', email: EMAIL, method: 'GOOGLE', confirmed: true } as MemoryAccount,
      EMAIL,
      'This email uses Google to sign in',
    ],
    [
      '0b-6b',
      { id: 'a', email: EMAIL, method: 'APPLE', confirmed: true } as MemoryAccount,
      EMAIL,
      'This email uses Apple to sign in',
    ],
    [
      '0b-6c',
      {
        id: 'r',
        email: 'x1@privaterelay.appleid.com',
        method: 'APPLE',
        confirmed: true,
        privateRelay: true,
      } as MemoryAccount,
      'x1@privaterelay.appleid.com',
      "This is an Apple 'Hide My Email' address. It works with Continue with Apple only.",
    ],
  ])('%s wrong method from the email form', async (id, account, email, text) => {
    await signInWith([account], email, TEST_PASSWORD);
    await onScreen(id);
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.getByTestId('field-password').props.value).toBe('');
  });

  it('0b-5g email not confirmed → Enter code → 0b-4a', async () => {
    await signInWith([passwordAccount({ confirmed: false })], EMAIL, TEST_PASSWORD);
    await onScreen('0b-5g');
    expect(screen.getByText('Confirm your email first')).toBeTruthy();
    await press('Enter code');
    expect(await onScreen('0b-4a')).toBeTruthy();
  });

  it('0b-5h new device after unusual tries → code → Today', async () => {
    await signInWith([passwordAccount({ stepUp: true })], EMAIL, TEST_PASSWORD);
    await onScreen('0b-5h');
    expect(screen.getByText("Check it's you")).toBeTruthy();
    expect(
      screen.getByText(
        'This only happens when you sign in on a new device. Nothing on your account has changed.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/password was right/i)).toBeNull();
    await fireEvent.changeText(screen.getByTestId('field-code'), MEMORY_EMAIL_CODE);
    expect(await screen.findByTestId('screen-today')).toBeTruthy();
  });

  it('shared alerts: RATE_LIMITED, DEVICE_CHECK_FAILED and network use the spec 3.4 copy', async () => {
    await start({ accounts: [passwordAccount()] }, '/sign-in/email');
    await type('Email', EMAIL);
    for (const [err, title] of [
      [new AuthError('DEVICE_CHECK_FAILED'), "We couldn't check this device"],
      [new AuthError('NETWORK'), 'Something went wrong'],
      [new AuthError('RATE_LIMITED', {}, 600), 'Too many tries'],
    ] as const) {
      mockBackend.failNext('signInWithPassword', err);
      await type('Password', TEST_PASSWORD);
      await press(/Sign in|Try again/);
      expect(await screen.findByText(title)).toBeTruthy();
    }
    expect(
      screen.getByText('Lots of attempts from this device. Wait a while, then try again.'),
    ).toBeTruthy();
  });

  it('development: the bare username "admin" means the seeded local account', async () => {
    await signInWith([passwordAccount({ email: 'admin@example.test' })], 'admin', TEST_PASSWORD);
    expect(await screen.findByTestId('screen-today')).toBeTruthy();
    expect(mockBackend.state.user?.email).toBe('admin@example.test');
  });
});

describe('rows 6 and 8: Apple and Google', () => {
  it('create with Google (new) → 0c onboarding', async () => {
    await start({ provider: { email: 'new@example.test', sub: 'g-new' } }, '/sign-up');
    await press('Continue with Google');
    expect(await screen.findByTestId('screen-onboarding-consent')).toBeTruthy();
  });

  it('cancelling the provider sheet returns quietly to the method screen', async () => {
    await start({ provider: null }, '/sign-up');
    await press('Continue with Apple');
    expect(await onScreen('0b-1')).toBeTruthy();
    expect(screen.queryByTestId('auth-alert')).toBeNull();
  });

  it('0b-8h create with an existing Google identity → one tap → Today', async () => {
    await start(
      {
        accounts: [{ id: 'g', email: EMAIL, method: 'GOOGLE', confirmed: true }],
        provider: { email: EMAIL, sub: 'g' },
      },
      '/sign-up',
      onboardedData,
    );
    await press('Continue with Google');
    await onScreen('0b-8h');
    expect(screen.getByText(/already has a Life OS account with Google/)).toBeTruthy();
    await press('Sign in with Google');
    expect(await screen.findByTestId('screen-today')).toBeTruthy();
  });

  it('0b-8i sign in with an unknown Google account → one tap create → 0c', async () => {
    await start({ provider: { email: 'fresh@example.test', sub: 'g2' } }, '/sign-in');
    await press('Continue with Google');
    await onScreen('0b-8i');
    expect(
      screen.getByText('Picked the wrong Google account? Try again and choose another.'),
    ).toBeTruthy();
    await press('Create account with Google');
    expect(await screen.findByTestId('screen-onboarding-consent')).toBeTruthy();
  });

  it('0b-6e Google tapped for a password account → Sign in with email (email filled)', async () => {
    await start(
      { accounts: [passwordAccount()], provider: { email: EMAIL, sub: 'g' } },
      '/sign-in',
    );
    await press('Continue with Google');
    await onScreen('0b-6e');
    expect(screen.getByText('This email uses a password')).toBeTruthy();
    await press('Sign in with email');
    await onScreen('0b-5b');
    expect(screen.getByTestId('field-email').props.value).toBe(EMAIL);
  });

  it.each([
    ['0b-6g', 'GOOGLE', 'APPLE', 'This email uses Apple to sign in'],
    ['0b-6h', 'APPLE', 'GOOGLE', 'This email uses Google to sign in'],
  ] as const)('%s provider ↔ provider wrong method', async (id, tapped, method, title) => {
    await start(
      {
        accounts: [{ id: 'x', email: EMAIL, method, confirmed: true }],
        provider: { email: EMAIL, sub: 'other' },
      },
      '/sign-in',
    );
    await press(`Continue with ${tapped === 'GOOGLE' ? 'Google' : 'Apple'}`);
    await onScreen(id);
    expect(screen.getByText(title)).toBeTruthy();
  });

  it('0b-8g failures and the mismatch support copy', async () => {
    await start({ provider: { email: EMAIL, sub: 's' } }, '/sign-in');
    mockBackend.failNext('signInWithProvider:GOOGLE', new AuthError('TOKEN_INVALID'));
    await press('Continue with Google');
    await onScreen('0b-8g');
    expect(
      screen.getByText(/Nothing has changed. Check your connection and try again./),
    ).toBeTruthy();
    mockBackend.failNext('signInWithProvider:GOOGLE', new AuthError('PROVIDER_ACCOUNT_MISMATCH'));
    await press('Try again');
    expect(await screen.findByText(/Contact support and we'll sort it out./)).toBeTruthy();
  });
});

describe('row 7: forgot password (0b-7)', () => {
  it('0b-7a → 0b-7c says the same thing whatever the account', async () => {
    for (const accounts of [
      [passwordAccount()],
      [{ id: 'g', email: EMAIL, method: 'GOOGLE', confirmed: true } as MemoryAccount],
      [],
    ]) {
      await start({ accounts }, `/forgot?email=${encodeURIComponent(EMAIL)}`);
      expect(screen.getByText('Filled in from the sign-in screen.')).toBeTruthy();
      await press('Send reset link');
      await onScreen('0b-7c');
      expect(
        screen.getByText(/has a Life OS password, we've sent a link to reset it/),
      ).toBeTruthy();
    }
  });

  it('0b-7f → 7i mismatch → 7k changed (never signed in) → Sign in with the email filled', async () => {
    await start(
      { accounts: [passwordAccount()], resetTokens: { 'reset-token': 'user-pw' } },
      '/reset?t=reset-token',
    );
    await onScreen('0b-7f');
    expect(screen.getByText(EMAIL)).toBeTruthy();
    await type('New password', NEW_PASSWORD);
    await type('Confirm new password', NEW_PASSWORD + '!');
    await press('Save password');
    await onScreen('0b-7i');
    await type('New password', NEW_PASSWORD);
    await type('Confirm new password', NEW_PASSWORD);
    await press('Save password');
    await onScreen('0b-7k');
    expect(mockBackend.state.user).toBeNull();
    await press('Sign in');
    await onScreen('0b-5b');
    expect(screen.getByTestId('field-email').props.value).toBe(EMAIL);
  });

  it('0b-7j an old or used link', async () => {
    await start({ accounts: [passwordAccount()] }, '/reset?t=used');
    expect(await onScreen('0b-7j')).toBeTruthy();
    expect(
      screen.getByText(
        'Reset links work once and last 30 minutes. Ask for a new one and use the latest email.',
      ),
    ).toBeTruthy();
  });
});

describe('row 9: Me → Security', () => {
  const signedIn = (account: MemoryAccount, extra: Partial<MemoryAuthState> = {}) =>
    start(
      {
        accounts: [account],
        user: { id: account.id, email: account.email, scope: 'FULL' },
        sessions: [
          {
            id: 's1',
            label: 'iPhone',
            platform: 'ios',
            coarseLocation: 'London',
            lastActiveAt: new Date().toISOString(),
            isCurrent: true,
          },
          {
            id: 's2',
            label: 'MacBook · Safari',
            platform: 'web',
            coarseLocation: 'London',
            lastActiveAt: new Date(Date.now() - 7_200_000).toISOString(),
            isCurrent: false,
          },
        ],
        ...extra,
      },
      '/security',
      { ...onboardedData, user: { id: account.id, email: account.email } },
    );

  it('S-1a password account; S-3a Apple account (no password, hidden relay email)', async () => {
    await signedIn(passwordAccount({ passwordChangedAt: '2026-10-12T10:00:00Z' }));
    await onScreen('S-1a');
    expect(screen.getByText('Email and password')).toBeTruthy();
    expect(screen.getByText('Last changed 12 October 2026')).toBeTruthy();
    expect(screen.getByText('Two-step verification')).toBeTruthy();
    // "Coming later" rows: not buttons, and screen readers hear "Later".
    const later = screen.getByLabelText(/^Passkeys, .*Later$/);
    expect(later.props.accessibilityRole).toBeUndefined();
    expect(screen.queryByRole('button', { name: /Passkeys/ })).toBeNull();

    await signedIn({
      id: 'a',
      email: 'x@privaterelay.appleid.com',
      method: 'APPLE',
      confirmed: true,
      privateRelay: true,
    });
    await onScreen('S-3a');
    expect(screen.getByText("You don't have one. You sign in with Apple.")).toBeTruthy();
    expect(screen.getByText('Hidden')).toBeTruthy();
  });

  it('S-2 change password: S-2d wrong current, S-2e breached, then S-2f', async () => {
    await signedIn(passwordAccount(), {});
    await fireEvent.press(screen.getByRole('button', { name: /^Password/ }));
    await onScreen('S-2a');
    // S-2a: rules show before the fields are filled, and the button waits until they're met.
    expect(screen.getByText(/15 characters/)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Change password' }).props.accessibilityState.disabled,
    ).toBe(true);
    const fill = async (cur: string, next: string) => {
      await type('Current password', cur);
      await type('New password', next);
      await type('Confirm new password', next);
      await press('Change password');
    };
    await fill('not my password at all', NEW_PASSWORD);
    await onScreen('S-2d');
    expect(
      screen.getByText(
        "That password isn't right. Forgotten it? Sign out and use Forgot password.",
      ),
    ).toBeTruthy();
    await fill(TEST_PASSWORD, BREACHED_PASSWORD);
    await onScreen('S-2e');
    await fill(TEST_PASSWORD, NEW_PASSWORD);
    await onScreen('S-2f');
    expect(mockBackend.auth.auth.sessions.map((s) => s.id)).toEqual(['s1']);
  });

  it('S-4 devices: this device first, no IP; sign out one (S-4b) → list updates (S-4d); sign out everywhere → 0a', async () => {
    await signedIn(passwordAccount());
    await fireEvent.press(screen.getByRole('button', { name: /Signed-in devices/ }));
    await onScreen('S-4a');
    expect(screen.getByText('This device')).toBeTruthy();
    expect(screen.queryByText(/\d+\.\d+\.\d+\.\d+/)).toBeNull();
    await press('Sign out of MacBook · Safari');
    expect(screen.getByText('Sign out of MacBook · Safari?')).toBeTruthy();
    await press('Sign out');
    await onScreen('S-4d');
    expect(mockBackend.auth.auth.sessions.map((s) => s.id)).toEqual(['s1']);
    await press('Sign out everywhere');
    await act(async () => {
      await fireEvent.press(
        within(screen.getByTestId('sheet-S-4e')).getByRole('button', {
          name: 'Sign out everywhere',
        }),
      );
    });
    expect(await onScreen('0a')).toBeTruthy();
  });

  it('S-5 delete: export, confirm it is you, DELETE is case-sensitive, S-5h, Keep → S-5i', async () => {
    await signedIn(passwordAccount());
    await press('Delete account');
    await onScreen('S-5a');
    await fireEvent.press(screen.getByRole('link', { name: 'Download a copy of your data first' }));
    expect(mockBackend.auth.auth.exports).toEqual(['json']);
    await press('Continue');
    await onScreen('S-5b');
    await type('Password', 'not it not it not it');
    await press('Continue');
    await onScreen('S-5d');
    await type('Password', TEST_PASSWORD);
    await press('Continue');
    await onScreen('S-5e');
    await fireEvent.changeText(screen.getByTestId('field-delete'), 'delete');
    expect(
      screen.getByRole('button', { name: 'Delete my account' }).props.accessibilityState.disabled,
    ).toBe(true);
    await fireEvent.changeText(screen.getByTestId('field-delete'), 'DELETE');
    await press('Delete my account');
    await onScreen('S-5h');
    expect(screen.getByText("You'll see this whenever you sign in before then.")).toBeTruthy();
    await press('Keep my account');
    expect(await onScreen('S-5i')).toBeTruthy();
  });

  it('a PENDING_DELETION session only sees S-5h, even deep-linked elsewhere', async () => {
    const a = passwordAccount({ pendingDeletionUntil: '2026-12-06T10:00:00Z' });
    await start(
      { accounts: [a], user: { id: a.id, email: a.email, scope: 'PENDING_DELETION' } },
      '/me',
      { ...onboardedData, user: { id: a.id, email: a.email } },
    );
    expect(await onScreen('S-5h')).toBeTruthy();
    expect(screen.getByText('6 December 2026')).toBeTruthy();
    expect(mockBackend.state.calls).not.toContain('getSettings');
  });
});
