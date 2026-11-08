// Sign-off G3, I2, I3 (docs/PHASE2-SIGNOFF.md):
//   G3  a relaunch part-way through onboarding resumes at the right step; never after 0g;
//   I2  Health and Today show no made-up steps/sleep numbers when signed in (Phase 3 data);
//   I3  Today's totals roll over at Europe/London midnight, clock-change weekends included.
import path from 'node:path';
import { Platform } from 'react-native';
import { act, renderRouter, screen } from 'expo-router/testing-library';
import { formatCount, snapshotComponents, type MealLog } from '@life-os/core';
import { londonDayRange } from '@/features/data/useDay';
import { resumeStep } from '@/features/onboarding/steps';
import { sampleSleepMinutes, sampleSteps } from '@/data/sample';
import { FOODS, food, liveState } from '@/test/fixtures';
import { createMemoryBackend, TEST_USER, type MemoryBackend } from '@/test/memoryBackend';
import type { MemoryState } from '@/test/memoryBackend';

const APP_DIR = path.resolve(__dirname, '../app');
let mockBackend: MemoryBackend;
jest.mock('@/lib/backend/current', () => ({ getBackend: () => mockBackend }));
jest.mock('@/lib/notifications', () => ({ requestNotificationPermission: async () => 'granted' }));

const realOS = Platform.OS;
const setPlatform = (os: typeof Platform.OS) =>
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
afterEach(() => {
  setPlatform(realOS);
  jest.useRealTimers();
});

async function start(init: Partial<MemoryState>, url = '/') {
  mockBackend = createMemoryBackend(init);
  await renderRouter(APP_DIR, { initialUrl: url });
  return screen.findByTestId(/^screen-/, undefined, { timeout: 10_000 });
}

const base = () => createMemoryBackend().state.settings;
/** Signed in, onboarding not finished, with these answers saved. */
const midOnboarding = (
  healthConsent: boolean,
  saved: Partial<ReturnType<typeof base>> = {},
): Partial<MemoryState> => ({
  user: TEST_USER,
  healthConsent,
  settings: { ...base(), ...saved },
});

// ------------------------------------------------------------------------------------------ G3

describe('G3: relaunching mid-onboarding resumes at the right step', () => {
  it.each([
    ['nothing saved yet', false, {}, 'consent'],
    ['consent given', true, {}, 'apple-health'],
    ['Apple Health answered', true, { appleHealthChoice: 'not_now' as const }, 'screen-time'],
    [
      '"Not now" on consent, then Screen Time answered',
      false,
      { screenTimeChoice: 'not_now' as const },
      'nudges',
    ],
    [
      'nudges answered',
      true,
      {
        appleHealthChoice: 'connect' as const,
        screenTimeChoice: 'show' as const,
        notificationsPromptedAt: '2026-11-07T09:00:00Z',
      },
      'finish',
    ],
  ])('iPhone, %s → %s', async (_what, consent, saved, step) => {
    setPlatform('ios');
    const shown = await start(midOnboarding(consent, saved));
    expect(shown.props.testID).toBe(`screen-onboarding-${step}`);
  });

  it('web skips Apple Health and Screen Time: consent given → nudges', async () => {
    setPlatform('web');
    const shown = await start(midOnboarding(true));
    expect(shown.props.testID).toBe('screen-onboarding-nudges');
  });

  it('after 0g onboarding never shows again, even deep-linked', async () => {
    const done = midOnboarding(true, { onboardingCompletedAt: '2026-11-07T09:05:00Z' });
    for (const url of ['/', '/onboarding', '/onboarding/consent', '/onboarding/finish']) {
      const shown = await start(done, url);
      expect(shown.props.testID).toBe('screen-today');
      expect(screen.queryByTestId(/^screen-onboarding/)).toBeNull();
    }
  });

  it('resumeStep: later answers win; 0g saved → null', () => {
    const s = (over: Partial<ReturnType<typeof base>> = {}) => ({ ...base(), ...over });
    expect(resumeStep('ios', { healthConsent: false, settings: s() })).toBe('consent');
    expect(resumeStep('ios', { healthConsent: true, settings: s() })).toBe('apple-health');
    expect(resumeStep('android', { healthConsent: true, settings: s() })).toBe('nudges');
    expect(
      resumeStep('ios', {
        healthConsent: true,
        settings: s({ notificationsPromptedAt: '2026-11-07T09:00:00Z' }),
      }),
    ).toBe('finish');
    expect(
      resumeStep('ios', {
        healthConsent: true,
        settings: s({ onboardingCompletedAt: '2026-11-07T09:05:00Z' }),
      }),
    ).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------ I2

describe('I2: no made-up steps or sleep when signed in (Apple Health is phase 3)', () => {
  const sampleNumbers = [
    formatCount(sampleSteps),
    `${Math.floor(sampleSleepMinutes / 60)}h ${sampleSleepMinutes % 60}m`,
  ];

  it('Today: the steps and sleep rings are empty and say why', async () => {
    await start(liveState());
    expect(screen.getByLabelText('Steps: from Apple Health in a later update')).toBeTruthy();
    expect(screen.getByLabelText('Sleep: from Apple Health in a later update')).toBeTruthy();
    for (const n of sampleNumbers) expect(screen.queryByText(new RegExp(n))).toBeNull();
  });

  it('Health: Steps and Sleep cards show no numbers, only that they come later', async () => {
    await start(liveState(), '/health');
    await screen.findByTestId('screen-health');
    for (const n of sampleNumbers) expect(screen.queryByText(new RegExp(n))).toBeNull();
    expect(screen.getAllByText(/Apple Health/).length).toBeGreaterThanOrEqual(2);
  });
});

// ------------------------------------------------------------------------------------------ I3

const oats80 = (id: string, loggedAt: string): MealLog => ({
  id,
  userId: TEST_USER.id,
  savedMealId: null,
  name: `Oats ${id}`,
  loggedAt,
  items: snapshotComponents([{ food: food(FOODS.oats), grams: 80 }]), // 300 kcal
});
const kcal = () => screen.getByLabelText(/^Calories: /).props.accessibilityLabel as string;

describe('I3: Today rolls over at Europe/London midnight', () => {
  it.each([
    {
      name: 'an ordinary night (GMT)',
      before: '2026-11-07T23:59:00Z', // Sat 7 Nov 23:59 GMT
      logs: ['2026-11-07T00:10:00Z', '2026-11-07T23:30:00Z'],
      notToday: ['2026-11-06T23:50:00Z'],
      after: '2026-11-08T00:01:00Z',
    },
    {
      name: 'clocks go back (Sun 25 Oct 2026: a 25-hour day)',
      before: '2026-10-25T23:59:00Z', // 23:59 GMT
      logs: ['2026-10-24T23:30:00Z', '2026-10-25T23:30:00Z'], // 00:30 BST, 23:30 GMT
      notToday: ['2026-10-24T22:30:00Z'], // 23:30 BST on Saturday
      after: '2026-10-26T00:01:00Z',
    },
    {
      name: 'clocks go forward (Sun 29 Mar 2026: a 23-hour day)',
      before: '2026-03-29T22:59:00Z', // 23:59 BST
      logs: ['2026-03-29T00:30:00Z', '2026-03-29T22:30:00Z'], // 00:30 GMT, 23:30 BST
      notToday: ['2026-03-28T23:30:00Z'], // 23:30 GMT on Saturday
      after: '2026-03-29T23:01:00Z', // 00:01 BST Monday
    },
  ])('$name', async ({ before, logs, notToday, after }) => {
    jest.useFakeTimers({ advanceTimers: true });
    jest.setSystemTime(new Date(before));
    await start(
      liveState({
        mealLogs: [...logs, ...notToday].map((at, i) => oats80(`l${i}`, at)),
        water: [],
      }),
    );
    await screen.findByLabelText('Calories: 600 of 2,450');
    expect(kcal()).toBe('Calories: 600 of 2,450');
    await act(async () => {
      jest.setSystemTime(new Date(after));
      jest.advanceTimersByTime(60_000);
    });
    expect(
      await screen.findByLabelText('Calories: 0 of 2,450', undefined, { timeout: 3000 }),
    ).toBeTruthy();
  });

  it('londonDayRange: 24, 25 and 23 hours', () => {
    const hours = (d: string) => {
      const r = londonDayRange(d);
      return (Date.parse(r.to) - Date.parse(r.from)) / 3600_000;
    };
    expect(hours('2026-11-07')).toBe(24);
    expect(hours('2026-10-25')).toBe(25);
    expect(hours('2026-03-29')).toBe(23);
    expect(londonDayRange('2026-07-01').from).toBe('2026-06-30T23:00:00.000Z');
  });
});
