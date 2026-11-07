import path from 'node:path';
import { Alert, Platform } from 'react-native';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { createMemoryBackend, TEST_USER, type MemoryBackend } from '@/test/memoryBackend';
import type { MemoryState } from '@/test/memoryBackend';

const APP_DIR = path.resolve(__dirname, '../app');

let mockBackend: MemoryBackend;
jest.mock('@/lib/backend/current', () => ({ getBackend: () => mockBackend }));

const mockRequestPermission = jest.fn(async () => 'granted');
jest.mock('@/lib/notifications', () => ({
  requestNotificationPermission: () => mockRequestPermission(),
}));

beforeEach(() => mockRequestPermission.mockClear());

async function start(init: Partial<MemoryState> = {}, url = '/') {
  mockBackend = createMemoryBackend(init);
  await renderRouter(APP_DIR, { initialUrl: url });
  await screen.findByTestId(/^screen-/);
}

const press = (name: string | RegExp) => fireEvent.press(screen.getByRole('button', { name }));

const onboarded = () => ({
  user: TEST_USER,
  healthConsent: true,
  settings: {
    ...createMemoryBackend().state.settings,
    onboardingCompletedAt: '2026-11-06T09:00:00Z',
  },
});

function setPlatform(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
}

describe('sign-in', () => {
  afterEach(() => setPlatform('ios'));

  it('signed out: shows Welcome with Apple, Google and email, and no "Not connected" banner', async () => {
    await start();
    expect(screen.getByTestId('screen-welcome')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue with Apple' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue with email' })).toBeTruthy();
    expect(screen.queryByText('Not connected')).toBeNull();
  });

  it.each(['web', 'android'] as const)(
    'offers Apple wherever Google is offered (%s)',
    async (os) => {
      setPlatform(os);
      await start();
      expect(screen.getByRole('button', { name: 'Continue with Apple' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeTruthy();
    },
  );

  it('email: sends a magic link and shows "Check your inbox"', async () => {
    await start();
    await press('Continue with email');
    await screen.findByTestId('screen-sign-in-email');
    const send = screen.getByRole('button', { name: 'Send sign-in link' });
    expect(send.props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('Email'), 'user-a@example.test');
    await press('Send sign-in link');
    expect(mockBackend.state.magicLinksSent).toEqual(['user-a@example.test']);
    expect(screen.getByText('Check your inbox')).toBeTruthy();
    await press('Resend sign-in link');
    expect(mockBackend.state.magicLinksSent).toHaveLength(2);
    expect(screen.getByText('Sent again.')).toBeTruthy();
  });

  it('email: password option shows a friendly error, then signs in into onboarding', async () => {
    await start({ passwords: { 'user-a@example.test': 'correct horse' } });
    await press('Continue with email');
    await fireEvent.press(screen.getByRole('link', { name: 'Use a password instead' }));
    await fireEvent.changeText(screen.getByLabelText('Email'), 'user-a@example.test');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'wrong');
    await press('Sign in');
    expect(screen.getByText(/don’t match/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Password'), 'correct horse');
    await press('Sign in');
    expect(await screen.findByTestId('screen-onboarding-consent')).toBeTruthy();
  });

  it('a failed Google sign-in shows the error on Welcome', async () => {
    await start();
    mockBackend.failNext('signInWithGoogle', new Error('Google is not configured.'));
    await press('Continue with Google');
    expect(screen.getByText('Google is not configured.')).toBeTruthy();
    expect(screen.getByTestId('screen-welcome')).toBeTruthy();
  });

  it('the magic-link callback signs in', async () => {
    await start({}, '/auth/callback?code=fake-code');
    expect(await screen.findByTestId('screen-onboarding-consent')).toBeTruthy();
  });

  it('a broken magic link explains what to do', async () => {
    await start({}, '/auth/callback');
    expect(await screen.findByText('Couldn’t sign you in')).toBeTruthy();
    expect(screen.getByText(/incomplete/)).toBeTruthy();
  });

  it('signed in and set up: goes straight to Today; Sign out returns to Welcome', async () => {
    await start(onboarded());
    expect(screen.getByTestId('screen-today')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('tab-me'));
    await press('Sign out');
    expect(await screen.findByTestId('screen-welcome')).toBeTruthy();
  });
});

describe('onboarding', () => {
  afterEach(() => setPlatform('ios'));

  it('iPhone: consent → Apple Health → Screen Time → nudges → finish → Today', async () => {
    await start({ user: TEST_USER, displayName: 'Sample' });
    expect(screen.getByTestId('screen-onboarding-consent')).toBeTruthy();
    expect(screen.getByText('1 of 5')).toBeTruthy();
    await press('Yes, use my health data');
    expect(mockBackend.state.consentLog).toEqual(['granted']);

    await screen.findByTestId('screen-onboarding-apple-health');
    expect(screen.getByText('Coming soon')).toBeTruthy();
    await press('Continue');
    expect(mockBackend.state.settings.appleHealthChoice).toBe('connect');

    await screen.findByTestId('screen-onboarding-screen-time');
    await press('Skip this step');
    expect(mockBackend.state.settings.screenTimeChoice).toBe('not_now');

    await screen.findByTestId('screen-onboarding-nudges');
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Monthly statement import' }));
    await press('Allow notifications');
    expect(mockRequestPermission).toHaveBeenCalled();
    expect(mockBackend.state.settings.nudges.monthlyStatementImport.enabled).toBe(false);
    expect(mockBackend.state.settings.notificationsPromptedAt).not.toBeNull();

    await screen.findByTestId('screen-onboarding-finish');
    expect(screen.getByText('5 of 5')).toBeTruthy();
    expect(screen.getByLabelText('First name').props.value).toBe('Sample');
    expect(screen.getByText('Health data: on · Apple Health: on')).toBeTruthy();
    expect(screen.getByText('Screen Time: off · Nudges: 3 on')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('First name'), 'Alex');
    await press('Go to Today');
    expect(await screen.findByTestId('screen-today')).toBeTruthy();
    expect(mockBackend.state.displayName).toBe('Alex');
    expect(mockBackend.state.settings.onboardingCompletedAt).not.toBeNull();
  });

  it('iPhone "Not now": skips Apple Health, keeps Screen Time, and no consent is recorded', async () => {
    await start({ user: TEST_USER });
    await press('Not now');
    expect(mockBackend.state.consentLog).toEqual([]);
    expect(await screen.findByTestId('screen-onboarding-screen-time')).toBeTruthy();
    expect(screen.getByLabelText('Step 2 of 4')).toBeTruthy();
    await press('Continue');
    await screen.findByTestId('screen-onboarding-nudges');
    await press('Skip this step');
    expect(mockRequestPermission).not.toHaveBeenCalled();
    await screen.findByTestId('screen-onboarding-finish');
    expect(screen.getByText('Health data: off · Apple Health: off')).toBeTruthy();
  });

  it.each(['android', 'web'] as const)('%s: skips Apple Health and Screen Time', async (os) => {
    setPlatform(os);
    await start({ user: TEST_USER });
    expect(screen.getByText('1 of 3')).toBeTruthy();
    await press('Yes, use my health data');
    expect(await screen.findByTestId('screen-onboarding-nudges')).toBeTruthy();
    await press('Allow notifications');
    await screen.findByTestId('screen-onboarding-finish');
    expect(screen.getByText('Health data: on')).toBeTruthy();
    expect(screen.queryByText(/Screen Time/)).toBeNull();
  });

  it('"Set targets now" saves targets to settings', async () => {
    await start({ user: TEST_USER }, '/onboarding/finish');
    await press('Set targets now');
    await screen.findByTestId('screen-targets');
    await fireEvent.changeText(screen.getByLabelText('Calories (kcal)'), '2,450');
    await fireEvent.changeText(screen.getByLabelText('Water (ml)'), '3000');
    await press('Save targets');
    await waitFor(() => expect(mockBackend.state.settings.targets.kcal).toBe(2450));
    expect(mockBackend.state.settings.targets.waterMl).toBe(3000);
    expect(mockBackend.state.settings.targets.protein).toBeNull();
  });
});

describe('Me toggles persist', () => {
  it('nudges, Face ID lock and health consent are saved', async () => {
    await start(onboarded(), '/me');
    await fireEvent(screen.getByRole('switch', { name: 'Evening check-in' }), 'valueChange', false);
    await fireEvent(screen.getByRole('switch', { name: 'Face ID lock' }), 'valueChange', true);
    expect(mockBackend.state.settings.nudges.eveningCheckIn.enabled).toBe(false);
    expect(mockBackend.state.settings.appLockEnabled).toBe(true);

    const alert = jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => {
      const buttons = args[2] as { text: string; onPress?: () => void }[];
      buttons.find((b) => b.text === 'Withdraw')?.onPress?.();
    });
    await fireEvent(
      screen.getByRole('switch', { name: 'Use my health data' }),
      'valueChange',
      false,
    );
    expect(alert).toHaveBeenCalled();
    expect(mockBackend.state.consentLog).toEqual(['withdrawn']);
    expect(screen.getByRole('switch', { name: 'Use my health data' }).props.value).toBe(false);

    await fireEvent(
      screen.getByRole('switch', { name: 'Use my health data' }),
      'valueChange',
      true,
    );
    expect(mockBackend.state.consentLog).toEqual(['withdrawn', 'granted']);
  });

  it('a failed save reverts the toggle and shows why', async () => {
    await start(onboarded(), '/me');
    mockBackend.failNext('updateSettings', new Error('You’re offline.'));
    await fireEvent(screen.getByRole('switch', { name: 'Morning briefing' }), 'valueChange', false);
    expect(screen.getByText('You’re offline.')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Morning briefing' }).props.value).toBe(true);
  });
});
