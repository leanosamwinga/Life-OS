/**
 * Phase 3 · Health (docs/PHASE3-SIGNOFF.md): Day (1B), Week (4A) and Month (5) from the memory
 * backend; the weight card states (3a–3c) and the no-data / no-access states (8a–8b); Apple
 * Health sync; supplements ticked and unticked; training Done, Change and the week strip;
 * Me → Health targets (6B) saving; the supplement editor (7) with reminders.
 */
import path from 'node:path';
import { Alert, AppState, Linking, Platform } from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import {
  addDays,
  londonDateTimeToInstant,
  snapshotComponents,
  type MealLog,
  type TrainedDay,
} from '@life-os/core';
import type { HealthDailyValue, Supplement } from '@/lib/backend/health';
import { COPY } from '@/features/health/Body';
import { LIFTOFF_APP_STORE_URL } from '@/lib/liftoff';
import { FOODS, food, liveState } from '@/test/fixtures';
import { createFakeHealth, scheduled, setHealthReader, type FakeHealth } from '@/test/fakeHealth';
import {
  createMemoryBackend,
  TEST_USER,
  type MemoryBackend,
  type MemoryState,
} from '@/test/memoryBackend';

const APP_DIR = path.resolve(__dirname, '../app');
let mockBackend: MemoryBackend;
jest.mock('@/lib/backend/current', () => ({ getBackend: () => mockBackend }));
jest.mock('@/lib/notifications', () => ({ requestNotificationPermission: async () => 'granted' }));

const TODAY = '2026-11-12'; // Thursday
const realOS = Platform.OS;
const setPlatform = (os: typeof Platform.OS) =>
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });

beforeEach(async () => {
  jest.useFakeTimers({ advanceTimers: true });
  jest.setSystemTime(new Date('2026-11-12T13:40:00Z')); // Thu 12 Nov 13:40 (GMT)
  scheduled.splice(0);
  await AsyncStorage.clear();
});
afterEach(() => {
  jest.restoreAllMocks();
  setHealthReader(null);
  setPlatform(realOS);
  jest.useRealTimers();
});

// ------------------------------------------------------------------------------------------
// Fixtures: fake numbers only
// ------------------------------------------------------------------------------------------

const SUPPS: Supplement[] = [
  {
    id: 'sp-1',
    name: 'Creatine',
    dose: '5 g',
    timeOfDay: 'morning',
    reminderTime: '08:00',
    sortOrder: 0,
  },
  {
    id: 'sp-2',
    name: 'Magnesium',
    dose: '200 mg',
    timeOfDay: 'evening',
    reminderTime: '21:30',
    sortOrder: 1,
  },
];

/** Weight 82.4 today, 83.0 a week ago; sleep 7h 12m last night; steps 6,240 today. */
function values(): HealthDailyValue[] {
  const out: HealthDailyValue[] = [];
  for (let d = 0; d <= 13; d++) {
    out.push({
      day: addDays(TODAY, -d),
      kind: 'weight_kg',
      value: Math.round((82.4 + d * 0.0857) * 10) / 10,
    });
  }
  const night = (day: string, minutes: number, start: string): HealthDailyValue => ({
    day,
    kind: 'sleep_min',
    value: minutes,
    sleepStart: start,
    sleepEnd: new Date(Date.parse(start) + minutes * 60000).toISOString(),
  });
  out.push(night(TODAY, 432, '2026-11-11T23:48:00.000Z'));
  for (let d = 1; d <= 6; d++)
    out.push(
      night(addDays(TODAY, -d), 410, londonDateTimeToInstant(addDays(TODAY, -d - 1), '23:30')),
    );
  for (const [day, steps] of [
    ['2026-11-09', 8000],
    ['2026-11-10', 12000],
    ['2026-11-11', 10000],
    [TODAY, 6240],
  ] as const)
    out.push({ day, kind: 'steps', value: steps });
  return out;
}

const TRAINING: TrainedDay[] = [
  { trainedOn: '2026-11-09', splitDay: 1, splitName: 'Arms & shoulders' },
  { trainedOn: '2026-11-11', splitDay: 2, splitName: 'Chest & triceps' },
];

const bigMeal: MealLog = {
  id: 'log-big',
  userId: TEST_USER.id,
  savedMealId: null,
  name: 'Big oats',
  loggedAt: '2026-11-10T12:00:00.000Z',
  items: snapshotComponents([{ food: food(FOODS.oats), grams: 653 }]), // 2,449 kcal
};

function state(over: Partial<MemoryState> = {}): Partial<MemoryState> {
  const s = liveState();
  return {
    ...s,
    settings: {
      ...s.settings!,
      appleHealthChoice: 'connect',
      health: {
        weightKg: 80,
        sleepMin: 450,
        planName: 'Plan A',
        trainingPerWeek: 4,
        split: ['Arms & shoulders', 'Chest & triceps', 'Legs', 'Back'],
      },
    },
    mealLogs: [...(s.mealLogs ?? []), bigMeal],
    water: [
      { id: 'w-9', userId: TEST_USER.id, ml: 3000, loggedAt: '2026-11-09T10:00:00.000Z' },
      { id: 'w-10', userId: TEST_USER.id, ml: 1000, loggedAt: '2026-11-10T10:00:00.000Z' },
    ],
    supplements: SUPPS.map((x) => ({ ...x })),
    supplementLogs: [
      { supplementId: 'sp-1', takenOn: '2026-11-09' },
      { supplementId: 'sp-2', takenOn: '2026-11-09' },
      { supplementId: 'sp-1', takenOn: '2026-11-10' },
      { supplementId: 'sp-2', takenOn: '2026-11-10' },
      { supplementId: 'sp-1', takenOn: '2026-11-11' },
    ],
    trainingDays: TRAINING.map((t) => ({ ...t })),
    healthDaily: values(),
    ...over,
  };
}

async function start(
  init: Partial<MemoryState>,
  url = '/health',
  reader: FakeHealth | null = createFakeHealth(),
) {
  setHealthReader(reader);
  mockBackend = createMemoryBackend(init);
  await renderRouter(APP_DIR, { initialUrl: url });
  await screen.findByTestId(/^screen-/, undefined, { timeout: 10_000 });
}

const press = (name: string | RegExp) => fireEvent.press(screen.getByRole('button', { name }));
const tab = (name: string) => fireEvent.press(screen.getByRole('tab', { name }));
const text = (t: string | RegExp) => screen.findByText(t);

// ------------------------------------------------------------------------------------------
// A. Day (1B)
// ------------------------------------------------------------------------------------------

describe('A. Health · Day (1B)', () => {
  it('renders Body, Intake and Training from the memory backend', async () => {
    await start(state());
    await screen.findByTestId('weight-card');
    expect(screen.getByRole('header', { name: 'Body' })).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Intake' })).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Training' })).toBeTruthy();
    expect(screen.getByText('Thu 12 Nov')).toBeTruthy();
    // Weight: current, change this week, a 14-day line with the target.
    expect(screen.getByLabelText('Weight 82.4 kg, −0.6 kg this week')).toBeTruthy();
    expect(screen.getByText('Target 80.0 kg')).toBeTruthy();
    expect(screen.getByLabelText('Weight over the last 14 days, target 80.0 kg')).toBeTruthy();
    // Sleep and steps.
    expect(screen.getByText('7h 12m')).toBeTruthy();
    expect(screen.getByText(/23:48–07:00/)).toBeTruthy();
    expect(screen.getByText(/7-day avg 6h 53m/)).toBeTruthy();
    expect(screen.getByText('6,240')).toBeTruthy();
    expect(screen.getByText(/of 10,000/)).toBeTruthy();
    // Intake: nutrition with the plan name, water as before, supplements grouped.
    expect(screen.getByText('Plan A')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Log meal' })).toBeTruthy();
    expect(screen.getByLabelText('Water: 0 ml of 3 L')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add 250 ml of water' })).toBeTruthy();
    expect(screen.getByText(/supplements · 0 of 2/i)).toBeTruthy();
    expect(screen.getByText('Morning · 08:00')).toBeTruthy();
    expect(screen.getByText('Evening · 21:30')).toBeTruthy();
    // Training option 1.
    expect(screen.getByText('Today: Legs?')).toBeTruthy();
    expect(screen.getByText('Next in your rotation after Chest & triceps')).toBeTruthy();
    expect(screen.getByText(/training this week · 2 of 4/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Log workout in Liftoff' })).toBeTruthy();
  });

  it('every control has a role and label and is at least 44 pt', async () => {
    await start(state());
    await screen.findByTestId('training-card');
    const chip = screen.getByRole('checkbox', { name: 'Creatine 5 g' });
    expect(chip.props.accessibilityState.checked).toBe(false);
    for (const b of [chip, screen.getByRole('button', { name: /^Thursday, today/ })]) {
      const style = [b.props.style].flat(Infinity).reduce((a, s) => ({ ...a, ...s }), {});
      expect(style.minHeight ?? style.height).toBeGreaterThanOrEqual(44);
    }
  });

  it('consent off: no health data is loaded or shown', async () => {
    await start(state({ healthConsent: false }));
    await screen.findByTestId('health-consent-off');
    expect(screen.queryByTestId('weight-card')).toBeNull();
    expect(mockBackend.state.calls).not.toContain('listHealthDaily');
    expect(mockBackend.state.calls).not.toContain('listSupplements');
  });
});

// ------------------------------------------------------------------------------------------
// B. Weight card states (3a–3c) and C. no data / no access (8a–8b)
// ------------------------------------------------------------------------------------------

describe('B. Weight card 3a–3c', () => {
  it('3a: data shows the current weight', async () => {
    await start(state());
    expect(await screen.findByTestId('weight-card')).toBeTruthy();
  });

  it('3b: connected without data says where to add it (no button)', async () => {
    await start(state({ healthDaily: [] }));
    const card = await screen.findByTestId('weight-no-data');
    expect(within(card).getByText(COPY.weightNoData)).toBeTruthy();
    expect(within(card).queryByRole('button')).toBeNull();
    expect(within(card).queryByRole('link')).toBeNull();
  });

  it('3c: "Not now" on 0d means we know access is off', async () => {
    const s = state({ healthDaily: [] });
    await start({ ...s, settings: { ...s.settings!, appleHealthChoice: 'not_now' } });
    const card = await screen.findByTestId('weight-off');
    expect(within(card).getByText(COPY.weightOff)).toBeTruthy();
    expect(within(card).getByRole('link', { name: 'Open Settings' })).toBeTruthy();
  });

  it('3c: also when HealthKit says the request was never made', async () => {
    await start(state({ healthDaily: [] }), '/health', createFakeHealth({ status: 'never_asked' }));
    expect(await screen.findByTestId('weight-off')).toBeTruthy();
  });

  it('synced data wins over "off" (it came from the iPhone before)', async () => {
    const s = state();
    await start({ ...s, settings: { ...s.settings!, appleHealthChoice: 'not_now' } });
    expect(await screen.findByTestId('weight-card')).toBeTruthy();
  });
});

describe('C. 8a no data and 8b no access', () => {
  it('8a: connected, no data: dashed rings and no-data copy, no banner', async () => {
    await start(state({ healthDaily: [] }));
    await screen.findByTestId('weight-no-data');
    expect(screen.getByText(COPY.sleepNoData)).toBeTruthy();
    expect(screen.getByText(COPY.stepsNoData)).toBeTruthy();
    expect(screen.queryByTestId('health-no-access-banner')).toBeNull();
  });

  it('8b: one banner with Open Settings and Dismiss, plus per-card messages', async () => {
    const s = state({ healthDaily: [] });
    await start({ ...s, settings: { ...s.settings!, appleHealthChoice: null } });
    const banner = await screen.findByTestId('health-no-access-banner');
    expect(within(banner).getByText(COPY.bannerTitle)).toBeTruthy();
    expect(within(banner).getByText(COPY.bannerBody)).toBeTruthy();
    expect(screen.getByText(COPY.sleepOff)).toBeTruthy();
    expect(screen.getByText(COPY.stepsOff)).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Open Settings' }).length).toBe(3);
    await press('Dismiss Apple Health access message');
    expect(screen.queryByTestId('health-no-access-banner')).toBeNull();
    expect(await AsyncStorage.getItem('lifeos.health.noAccessBannerDismissed')).toBe('1');
  });

  it('8b: a dismissed banner stays dismissed on this device', async () => {
    await AsyncStorage.setItem('lifeos.health.noAccessBannerDismissed', '1');
    const s = state({ healthDaily: [] });
    await start({ ...s, settings: { ...s.settings!, appleHealthChoice: 'not_now' } });
    await screen.findByTestId('weight-off');
    expect(screen.queryByTestId('health-no-access-banner')).toBeNull();
  });

  it('Open Settings before iOS has ever asked shows the permission sheet and connects', async () => {
    const reader = createFakeHealth({ status: 'never_asked' });
    const s = state({ healthDaily: [] });
    await start(
      { ...s, settings: { ...s.settings!, appleHealthChoice: 'not_now' } },
      '/health',
      reader,
    );
    await screen.findByTestId('health-no-access-banner');
    await press('Open Settings');
    await waitFor(() => expect(reader.calls).toContain('requestAccess'));
    await waitFor(() => expect(mockBackend.state.settings.appleHealthChoice).toBe('connect'));
    await waitFor(() => expect(screen.queryByTestId('health-no-access-banner')).toBeNull());
  });

  it('Open Settings after iOS has asked records "connect" and opens Settings', async () => {
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    const reader = createFakeHealth({ status: 'asked' });
    const s = state({ healthDaily: [] });
    await start(
      { ...s, settings: { ...s.settings!, appleHealthChoice: 'not_now' } },
      '/health',
      reader,
    );
    await screen.findByTestId('health-no-access-banner');
    await press('Open Settings');
    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(reader.calls).not.toContain('requestAccess');
    expect(mockBackend.state.settings.appleHealthChoice).toBe('connect');
    open.mockRestore();
  });

  it.each(['web', 'android'] as const)(
    '%s: shows what the iPhone synced, no HealthKit',
    async (os) => {
      setPlatform(os);
      await start(state(), '/health', null);
      expect(await screen.findByTestId('weight-card')).toBeTruthy();
      expect(screen.getByText('6,240')).toBeTruthy();
      expect(screen.queryByTestId('health-no-access-banner')).toBeNull();
    },
  );

  it('web without synced data: Connect Apple Health on your iPhone', async () => {
    setPlatform('web');
    await start(state({ healthDaily: [] }), '/health', null);
    await screen.findByTestId('weight-no-data');
    expect(screen.getAllByText(COPY.elsewhere)).toHaveLength(2);
  });
});

// ------------------------------------------------------------------------------------------
// D. Apple Health sync
// ------------------------------------------------------------------------------------------

describe('D. Apple Health sync', () => {
  it('on open: reads the last 35 London days and upserts them', async () => {
    const reader = createFakeHealth({
      values: [{ day: TODAY, kind: 'steps', value: 7777 }],
    });
    await start(state(), '/health', reader);
    await waitFor(() =>
      expect(reader.calls).toContain(`readDays ${addDays(TODAY, -34)}..${TODAY}`),
    );
    expect(await text('7,777')).toBeTruthy();
    expect(
      mockBackend.state.healthDaily.find((v) => v.kind === 'steps' && v.day === TODAY)!.value,
    ).toBe(7777);
  });

  it('on return to the foreground: syncs again', async () => {
    const reader = createFakeHealth();
    await start(state(), '/health', reader);
    await waitFor(() =>
      expect(reader.calls.filter((c) => c.startsWith('readDays'))).toHaveLength(1),
    );
    // AppState is jest-expo's mock: call every "change" listener the app registered.
    const listeners = (AppState.addEventListener as unknown as jest.Mock).mock.calls
      .filter((c) => c[0] === 'change')
      .map((c) => c[1] as (s: string) => void);
    await act(async () => listeners.forEach((l) => l('active')));
    await waitFor(() =>
      expect(reader.calls.filter((c) => c.startsWith('readDays'))).toHaveLength(2),
    );
  });

  it('never reads without health-data consent', async () => {
    const reader = createFakeHealth();
    await start(state({ healthConsent: false }), '/health', reader);
    await screen.findByTestId('health-consent-off');
    expect(reader.calls.some((c) => c.startsWith('readDays'))).toBe(false);
  });

  it('never reads when the user said "Not now"', async () => {
    const reader = createFakeHealth();
    const s = state();
    await start(
      { ...s, settings: { ...s.settings!, appleHealthChoice: 'not_now' } },
      '/health',
      reader,
    );
    await screen.findByTestId('weight-card');
    expect(reader.calls.some((c) => c.startsWith('readDays'))).toBe(false);
    expect(reader.calls).not.toContain('requestAccess');
  });

  it('withdrawing consent in Me stops syncing and cancels supplement reminders', async () => {
    const reader = createFakeHealth();
    await start(state(), '/me', reader);
    await waitFor(() =>
      expect(scheduled.map((r) => r.identifier).sort()).toEqual([
        'supplement-sp-1',
        'supplement-sp-2',
      ]),
    );
    const before = reader.calls.length;
    jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => {
      const buttons = args[2] as { text: string; onPress?: () => void }[];
      buttons.find((b) => b.text === 'Withdraw')!.onPress!();
    });
    await fireEvent(
      screen.getByRole('switch', { name: 'Use my health data' }),
      'valueChange',
      false,
    );
    await waitFor(() => expect(mockBackend.state.healthConsent).toBe(false));
    await waitFor(() => expect(scheduled).toHaveLength(0));
    expect(reader.calls.slice(before).some((c) => c.startsWith('readDays'))).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------
// E. Supplements on Health
// ------------------------------------------------------------------------------------------

describe('E. Supplements: tap to mark taken, tap again to undo', () => {
  it('ticks and unticks today', async () => {
    await start(state());
    const chip = await screen.findByRole('checkbox', { name: 'Creatine 5 g' });
    await fireEvent.press(chip);
    await waitFor(() =>
      expect(
        screen.getByRole('checkbox', { name: 'Creatine 5 g' }).props.accessibilityState.checked,
      ).toBe(true),
    );
    expect(screen.getByText(/supplements · 1 of 2/i)).toBeTruthy();
    expect(mockBackend.state.supplementLogs.filter((l) => l.takenOn === TODAY)).toEqual([
      { supplementId: 'sp-1', takenOn: TODAY },
    ]);
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Creatine 5 g' }));
    await waitFor(() =>
      expect(
        screen.getByRole('checkbox', { name: 'Creatine 5 g' }).props.accessibilityState.checked,
      ).toBe(false),
    );
    expect(mockBackend.state.supplementLogs.filter((l) => l.takenOn === TODAY)).toEqual([]);
    // Yesterday's ticks are untouched.
    expect(mockBackend.state.supplementLogs.filter((l) => l.takenOn === '2026-11-11')).toHaveLength(
      1,
    );
  });

  it('with no supplements it points to Health targets', async () => {
    await start(state({ supplements: [], supplementLogs: [] }));
    expect(await screen.findByTestId('supplements-empty')).toBeTruthy();
  });
});

// ------------------------------------------------------------------------------------------
// F. Training
// ------------------------------------------------------------------------------------------

describe('F. Training this week', () => {
  it('Done marks today with the suggested split day', async () => {
    await start(state());
    await press('Done: trained Legs today');
    await text('Today: Legs · done');
    expect(mockBackend.state.trainingDays.find((t) => t.trainedOn === TODAY)).toEqual({
      trainedOn: TODAY,
      splitDay: 3,
      splitName: 'Legs',
    });
    expect(screen.getByText(/training this week · 3 of 4/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Thursday, today, trained, Legs' })).toBeTruthy();
  });

  it('Change picks another split day and the rotation continues from it', async () => {
    await start(state());
    await press('Change today’s split day');
    const sheet = within(await screen.findByTestId('sheet-change-split'));
    expect(sheet.getByRole('button', { name: 'Day 3: Legs, suggested' })).toBeTruthy();
    await fireEvent.press(sheet.getByRole('button', { name: 'Day 4: Back' }));
    await text('Today: Back · done');
    expect(mockBackend.state.trainingDays.find((t) => t.trainedOn === TODAY)!.splitDay).toBe(4);
  });

  it('tapping a day untrains or trains it; future days are disabled', async () => {
    await start(state());
    await screen.findByTestId('training-strip');
    await press('Monday, trained, Arms & shoulders');
    await waitFor(() =>
      expect(mockBackend.state.trainingDays.some((t) => t.trainedOn === '2026-11-09')).toBe(false),
    );
    await press('Tuesday, not trained');
    await waitFor(() =>
      expect(mockBackend.state.trainingDays.find((t) => t.trainedOn === '2026-11-10')).toBeTruthy(),
    );
    const friday = screen.getByRole('button', { name: 'Friday, not trained' });
    expect(friday.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(friday);
    expect(mockBackend.state.trainingDays.some((t) => t.trainedOn === '2026-11-13')).toBe(false);
  });

  it('marking the same day twice is a no-op (backend)', async () => {
    mockBackend = createMemoryBackend(state());
    await mockBackend.markTrained(TODAY, { day: 3, name: 'Legs' });
    await mockBackend.markTrained(TODAY, { day: 1, name: 'Arms & shoulders' });
    expect(mockBackend.state.trainingDays.filter((t) => t.trainedOn === TODAY)).toEqual([
      { trainedOn: TODAY, splitDay: 3, splitName: 'Legs' },
    ]);
    await expect(mockBackend.markTrained('2026-11-13', null)).rejects.toThrow(/hasn’t happened/);
  });

  it('Log workout in Liftoff opens Liftoff, or the App Store without it', async () => {
    const can = jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(false);
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await start(state());
    await fireEvent.press(await screen.findByRole('link', { name: 'Log workout in Liftoff' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith(LIFTOFF_APP_STORE_URL));
    can.mockResolvedValue(true);
    open.mockClear();
    await fireEvent.press(screen.getByRole('link', { name: 'Log workout in Liftoff' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('liftoff://'));
    can.mockRestore();
    open.mockRestore();
  });
});

// ------------------------------------------------------------------------------------------
// G. Week (4A) and Month (5)
// ------------------------------------------------------------------------------------------

describe('G. Week and Month', () => {
  it('Week: averages against targets and "n of N days" so far', async () => {
    await start(state());
    await screen.findByTestId('weight-card');
    await tab('Week');
    await screen.findByTestId('period-weight');
    expect(screen.getByTestId('period-label').props.children).toBe('Mon 9 – Sun 15 Nov');
    expect(screen.getByText(/weight · this week/i)).toBeTruthy();
    expect(screen.getByText('−0.3 kg')).toBeTruthy(); // 82.7 on Mon → 82.4 on Thu
    expect(screen.getByText('Mon to Sun')).toBeTruthy();
    // Nutrition: one day logged (2,449 kcal), within ±10% of 2,450.
    expect(screen.getByText('2,449')).toBeTruthy();
    expect(screen.getByLabelText('1 of 4 days within target')).toBeTruthy();
    // Water: average of the days with water (3 L and 1 L) → 2.0 L; 1 of 4 days hit.
    expect(screen.getByText('2.0 L')).toBeTruthy();
    expect(screen.getByText('of 3.0 L')).toBeTruthy();
    // Sleep and steps.
    expect(screen.getByText('6h 56m')).toBeTruthy();
    expect(screen.getByText(/Target 7h 30m\s0 of 4 nights/)).toBeTruthy();
    expect(screen.getByText('9,060')).toBeTruthy();
    expect(screen.getByText(/of 10,000\s2 of 4 days/)).toBeTruthy();
    // Supplements and training adherence.
    expect(screen.getByText('All taken 2 of 4 days')).toBeTruthy();
    expect(screen.getByLabelText('Creatine 5 g: 3 of 4 days')).toBeTruthy();
    expect(screen.getByText('2 of 4 sessions')).toBeTruthy();
  });

  it('Week: Previous and Next move a week; Next stops at this week', async () => {
    await start(state());
    await screen.findByTestId('weight-card');
    await tab('Week');
    await screen.findByTestId('period-label');
    expect(
      screen.getByRole('button', { name: 'Next week' }).props.accessibilityState.disabled,
    ).toBe(true);
    await press('Previous week');
    await waitFor(() =>
      expect(screen.getByTestId('period-label').props.children).toBe('Mon 2 – Sun 8 Nov'),
    );
    await press('Next week');
    await waitFor(() =>
      expect(screen.getByTestId('period-label').props.children).toBe('Mon 9 – Sun 15 Nov'),
    );
  });

  it('Month: lighter cards with monthly averages and the change this month', async () => {
    await start(state());
    await screen.findByTestId('weight-card');
    await tab('Month');
    await screen.findByTestId('period-weight');
    expect(screen.getByTestId('period-label').props.children).toBe('November 2026');
    expect(screen.getByText(/weight · november/i)).toBeTruthy();
    expect(screen.getByLabelText('Weight trend this month')).toBeTruthy();
    expect(screen.getByText('2 of 17 sessions')).toBeTruthy(); // 4 a week × 30 days ÷ 7
    expect(screen.getByText('Target 4 a week')).toBeTruthy();
    expect(screen.getByText('All taken')).toBeTruthy();
    expect(screen.getByText('2 of 12 days')).toBeTruthy();
    await press('Previous month');
    await waitFor(() =>
      expect(screen.getByTestId('period-label').props.children).toBe('October 2026'),
    );
  });
});

// ------------------------------------------------------------------------------------------
// H. Me → Health targets (6B)
// ------------------------------------------------------------------------------------------

describe('H. Me → Health targets', () => {
  it('the menu shows each target and Weight saves', async () => {
    await start(state(), '/health-targets');
    expect(screen.getByRole('button', { name: 'Weight: Target 80.0 kg' })).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Nutrition: Plan A · 2,450 kcal · P 180 · C 250 · F 75 g',
      }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Water: 3.0 L a day' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sleep: 7h 30m a night' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Steps: 10,000 a day' })).toBeTruthy();
    await screen.findByRole('button', { name: 'Supplements: 2 · 1 morning, 1 evening' });
    expect(screen.getByRole('button', { name: 'Training: 4 a week · 4-day split' })).toBeTruthy();
    await press(/^Weight:/);
    await screen.findByTestId('screen-target-weight');
    await fireEvent.changeText(screen.getByLabelText('Target weight'), '12');
    await press('Save');
    expect(screen.getByText('Must be 20 kg or more')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Target weight'), '78.5');
    await press('Save');
    await screen.findByTestId('screen-health-targets');
    expect(mockBackend.state.settings.health.weightKg).toBe(78.5);
    expect(screen.getByRole('button', { name: 'Weight: Target 78.5 kg' })).toBeTruthy();
  });

  it('Sleep, Nutrition, Water, Steps and Training save', async () => {
    await start(state(), '/health-targets/sleep');
    await fireEvent.changeText(screen.getByLabelText('Hours'), '8');
    await fireEvent.changeText(screen.getByLabelText('Minutes'), '15');
    await press('Save');
    await waitFor(() => expect(mockBackend.state.settings.health.sleepMin).toBe(495));

    await act(() => router.push('/health-targets/nutrition'));
    await screen.findByTestId('screen-target-nutrition');
    expect(screen.getByTestId('macro-sum').props.children).toBe('Macros add up to 2,395 kcal.');
    await fireEvent.changeText(screen.getByLabelText('Plan name'), 'Plan B');
    await fireEvent.changeText(screen.getByLabelText('Protein'), '190');
    await press('Save');
    await waitFor(() => expect(mockBackend.state.settings.targets.protein).toBe(190));
    expect(mockBackend.state.settings.health.planName).toBe('Plan B');

    await act(() => router.push('/health-targets/water'));
    await fireEvent.changeText(await screen.findByLabelText('Water a day'), '2500');
    await press('Save');
    await waitFor(() => expect(mockBackend.state.settings.targets.waterMl).toBe(2500));

    await act(() => router.push('/health-targets/steps'));
    await fireEvent.changeText(await screen.findByLabelText('Steps a day'), '8,000');
    await press('Save');
    await waitFor(() => expect(mockBackend.state.settings.targets.steps).toBe(8000));

    await act(() => router.push('/health-targets/training'));
    await screen.findByTestId('screen-target-training');
    await fireEvent.changeText(screen.getByLabelText('Sessions a week'), '3');
    await press('Remove Day 4');
    await fireEvent.changeText(screen.getByLabelText('Day 3'), 'Legs & core');
    await press('Save');
    await waitFor(() => expect(mockBackend.state.settings.health.trainingPerWeek).toBe(3));
    expect(mockBackend.state.settings.health.split).toEqual([
      'Arms & shoulders',
      'Chest & triceps',
      'Legs & core',
    ]);
  });

  it('Me has the Health targets row', async () => {
    await start(state(), '/me');
    await press(/^Health targets/);
    expect(await screen.findByTestId('screen-health-targets')).toBeTruthy();
  });
});

// ------------------------------------------------------------------------------------------
// I. Supplement editor (7)
// ------------------------------------------------------------------------------------------

describe('I. Supplement editor', () => {
  it('add, edit, delete and reminders, saved with Done', async () => {
    await start(state(), '/health-targets/supplements');
    await screen.findByRole('button', { name: 'Delete Creatine' });
    expect(screen.getByText('Tap a chip on Health to mark one taken.')).toBeTruthy();
    // Edit: Creatine's dose; Magnesium's reminder off.
    await fireEvent.changeText(screen.getAllByLabelText('Dose')[0]!, '3 g');
    await fireEvent(
      screen.getByRole('switch', { name: 'Reminder for Magnesium' }),
      'valueChange',
      false,
    );
    // Add Vitamin D, evening, reminder at 21:00.
    await press('Add supplement');
    const names = screen.getAllByLabelText('Name');
    await fireEvent.changeText(names[names.length - 1]!, 'Vitamin D');
    await fireEvent.changeText(screen.getAllByLabelText('Dose').at(-1)!, '25 µg');
    await fireEvent.press(screen.getAllByRole('tab', { name: 'Evening' }).at(-1)!);
    await fireEvent(
      screen.getByRole('switch', { name: 'Reminder for Vitamin D' }),
      'valueChange',
      true,
    );
    await fireEvent.changeText(screen.getAllByLabelText('Reminder time').at(-1)!, '9pm');
    await press('Done');
    expect(await text('Use a 24-hour time, like 08:00')).toBeTruthy();
    await fireEvent.changeText(screen.getAllByLabelText('Reminder time').at(-1)!, '21:00');
    // Delete Magnesium.
    await press('Delete Magnesium');
    await press('Done');
    await screen.findByTestId('screen-health-targets');
    expect(
      mockBackend.state.supplements.map((s) => [s.name, s.dose, s.timeOfDay, s.reminderTime]),
    ).toEqual([
      ['Creatine', '3 g', 'morning', '08:00'],
      ['Vitamin D', '25 µg', 'evening', '21:00'],
    ]);
    // This phone's reminders follow the list: daily, 24-hour.
    await waitFor(() =>
      expect(
        scheduled
          .map((r) => [r.content.title, r.trigger.hour, r.trigger.minute])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      ).toEqual([
        ['Creatine 3 g', 8, 0],
        ['Vitamin D 25 µg', 21, 0],
      ]),
    );
    expect(scheduled.every((r) => r.trigger.type === 'daily')).toBe(true);
  });

  it('a supplement with its reminder off gets no notification', async () => {
    await start(state(), '/health-targets/supplements');
    await fireEvent(
      await screen.findByRole('switch', { name: 'Reminder for Creatine' }),
      'valueChange',
      false,
    );
    expect(screen.getAllByText('No reminder')).toHaveLength(1);
    await press('Done');
    await screen.findByTestId('screen-health-targets');
    await waitFor(() => expect(scheduled.map((r) => r.identifier)).toEqual(['supplement-sp-2']));
  });
});
