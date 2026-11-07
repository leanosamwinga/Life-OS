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
  await screen.findByTestId(/^screen-/, undefined, { timeout: 10_000 });
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

describe('sign-in entry', () => {
  it('signed out: shows 0a Welcome with Create account and Sign in, no "Not connected" banner', async () => {
    await start();
    expect(screen.getByTestId('screen-0a')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect(screen.queryByText('Not connected')).toBeNull();
  });

  it('signed in and set up: goes straight to Today; Sign out returns to Welcome', async () => {
    await start(onboarded());
    expect(screen.getByTestId('screen-today')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('tab-me'));
    await press('Sign out');
    expect(await screen.findByTestId('screen-0a')).toBeTruthy();
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
