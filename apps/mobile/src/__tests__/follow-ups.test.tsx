/**
 * Log meal and water follow-ups after PR #9: 7i order, opening day and looping wheels; Daily
 * targets header; Today ↔ Yesterday; 7j "Log again" and "Log a corrected copy"; "Ate it" at the
 * usual time; water "Other amount…" and today's water; "Meal deleted · Undo"; consent off for each.
 */
import path from 'node:path';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { StyleSheet } from 'react-native';
import { snapshotComponents, toFood, type MealLog } from '@life-os/core';
import type { StoredFood } from '@/lib/backend/foods';
import {
  createMemoryBackend,
  TEST_USER,
  type MemoryBackend,
  type MemoryState,
} from '@/test/memoryBackend';
import { liveState } from '@/test/fixtures';

const APP_DIR = path.resolve(__dirname, '../app');

let mockBackend: MemoryBackend;
jest.mock('@/lib/backend/current', () => ({ getBackend: () => mockBackend }));

// The wireframes' moment: Mon 9 Nov 2026, 13:40 in London (GMT).
beforeAll(() => {
  jest.useFakeTimers({ advanceTimers: true });
  jest.setSystemTime(new Date('2026-11-09T13:40:00Z'));
});
afterAll(() => jest.useRealTimers());

const rec = (
  id: string,
  name: string,
  per: [number, number, number, number],
  over: Partial<StoredFood> = {},
): StoredFood => ({
  id,
  userId: null,
  source: 'open_food_facts',
  barcode: null,
  name,
  brand: null,
  kcalPer100g: per[0],
  proteinPer100g: per[1],
  carbsPer100g: per[2],
  fatPer100g: per[3],
  fibrePer100g: null,
  sugarPer100g: null,
  saltPer100g: null,
  ...over,
});

const F = {
  oats: rec('t-oats', 'Test oats', [389, 13.5, 66, 6.9]),
  whey: rec('t-whey', 'Sample whey', [400, 80, 8, 5]),
  chicken: rec('t-chicken', 'Sample chicken breast, cooked', [165, 31, 0, 3.6]),
  rice: rec('t-rice', 'Test basmati rice, cooked', [130, 2.7, 28, 0.3]),
  wrap: rec('t-wrap', 'Sample tuna wrap', [205, 14, 22, 6.5]),
  shake: rec('t-shake', 'Sample protein shake', [62, 6.1, 6.6, 1.2], {
    barcode: '0000000000962',
    nutritionUnit: 'ml',
    packGrams: 330,
  }),
};
const food = (r: StoredFood) => toFood(r)!;

const log = (
  id: string,
  name: string,
  at: string,
  items: Parameters<typeof snapshotComponents>[0],
  savedMealId: string | null = null,
): MealLog => ({
  id,
  userId: TEST_USER.id,
  savedMealId,
  name,
  loggedAt: at,
  items: snapshotComponents(items),
});

const OATS_BOWL = log('log-oats', 'Test oats bowl', '2026-11-09T06:40:00.000Z', [
  { food: food(F.oats), grams: 60 },
  { food: food(F.whey), grams: 30 },
]);
const LUNCH = log(
  'log-lunch',
  'Lunch · Sample chicken rice bowl',
  '2026-11-09T12:30:00.000Z',
  [
    { food: food(F.chicken), grams: 150 },
    { food: food(F.rice), grams: 250 },
  ],
  'meal-lunch',
);
const WRAP = log('log-wrap', 'Sample tuna wrap', '2026-11-09T13:35:00.000Z', [
  { food: food(F.wrap), grams: 200 },
]);
// Yesterday (Sun 8 Nov): one meal, and 750 ml of water.
const YDAY = log('log-yday', 'Sample tuna wrap', '2026-11-08T19:00:00.000Z', [
  { food: food(F.wrap), grams: 200 },
]);

function state(over: Partial<MemoryState> = {}): Partial<MemoryState> {
  const base = liveState();
  return {
    ...base,
    foods: [...base.foods!, ...Object.values(F)],
    savedMeals: [
      ...base.savedMeals!.filter((m) => m.id !== 'meal-breakfast'),
      {
        id: 'meal-lunch',
        name: 'Lunch · Sample chicken rice bowl',
        inDailyPlan: true,
        usualTime: '12:30',
        components: [
          { foodId: F.chicken.id, grams: 150 },
          { foodId: F.rice.id, grams: 250 },
        ],
      },
    ],
    mealLogs: [OATS_BOWL, LUNCH, WRAP, YDAY],
    water: [
      { id: 'w-y', userId: TEST_USER.id, ml: 750, loggedAt: '2026-11-08T10:00:00.000Z' },
      { id: 'w-1', userId: TEST_USER.id, ml: 250, loggedAt: '2026-11-09T08:00:00.000Z' },
      { id: 'w-2', userId: TEST_USER.id, ml: 500, loggedAt: '2026-11-09T12:00:00.000Z' },
    ],
    lastPortions: {
      [F.oats.id]: { grams: 60, loggedAt: '2026-11-08T07:00:00.000Z' },
      [F.shake.id]: { grams: 330, unit: 'ml', loggedAt: '2026-11-08T07:00:00.000Z' },
    },
    ...over,
  };
}

async function start(init: Partial<MemoryState>, url = '/') {
  mockBackend = createMemoryBackend(init);
  await renderRouter(APP_DIR, { initialUrl: url });
  await screen.findByTestId(/^screen-/);
}

const press = (name: string | RegExp) => fireEvent.press(screen.getByRole('button', { name }));
const a11yValue = (testID: string) => screen.getByTestId(testID).props.accessibilityValue.text;
const swipe = (testID: string, actionName: 'increment' | 'decrement') =>
  fireEvent(screen.getByTestId(testID), 'accessibilityAction', { nativeEvent: { actionName } });
/** Titles of a Today timeline, in order. */
const timelineTitles = (id = 'timeline') =>
  within(screen.getByTestId(id))
    .queryAllByText(/./)
    .map((t) => t.props.children)
    .filter(
      (c): c is string => typeof c === 'string' && /oats bowl|tuna wrap|chicken rice/.test(c),
    );

async function openMeal(id: string) {
  await screen.findByTestId(`open-${id}`);
  await fireEvent.press(screen.getByTestId(`open-${id}`));
  await screen.findByTestId('screen-7j');
}

async function openPicker() {
  await start(state(), '/log-meal');
  await screen.findByTestId('when-chips');
  await press('Other time');
  await screen.findByTestId('sheet-7i');
}
const chosen = () => screen.getByTestId('time-chosen').props.children;
const struck = (id: string) =>
  StyleSheet.flatten(within(screen.getByTestId(id)).getByText(id.split('-')[2]!).props.style)
    .textDecorationLine === 'line-through';

describe('A. 7i Time eaten', () => {
  it('shows Yesterday on the left and Today on the right', async () => {
    await openPicker();
    expect(
      within(screen.getByTestId('sheet-7i'))
        .getAllByRole('tab')
        .map((t) => t.props.accessibilityLabel),
    ).toEqual(['Yesterday, Sun 8 Nov', 'Today, Mon 9 Nov']);
  });

  it('opens on Today from “Other time…”, and on Yesterday for a time already on yesterday', async () => {
    await openPicker();
    const selected = (name: string) =>
      screen.getByRole('tab', { name }).props.accessibilityState.selected;
    expect(selected('Today, Mon 9 Nov')).toBe(true);
    expect(selected('Yesterday, Sun 8 Nov')).toBe(false);
    await fireEvent.press(screen.getByRole('tab', { name: 'Yesterday, Sun 8 Nov' }));
    await fireEvent.press(screen.getByTestId('wheel-hour-21'));
    await fireEvent.press(screen.getByTestId('time-done'));
    await waitFor(() => expect(screen.queryByTestId('sheet-7i')).toBeNull());
    await press(/Time eaten: Yesterday · 21:40/);
    await screen.findByTestId('sheet-7i');
    expect(selected('Yesterday, Sun 8 Nov')).toBe(true);
    expect(chosen()).toBe('Yesterday · Sun 8 Nov · 21:40');
  });

  it('minutes loop 59 → 00 → 01 and back without changing the hour or day', async () => {
    await openPicker();
    await fireEvent.press(screen.getByTestId('wheel-hour-10'));
    await fireEvent.press(screen.getByTestId('wheel-minute-59'));
    expect(chosen()).toBe('Today · Mon 9 Nov · 10:59');
    // The next row after 59 is 00 again (the copy below), then 01.
    await fireEvent.press(screen.getByTestId('wheel-minute-00-c4'));
    expect(a11yValue('wheel-minute')).toBe('00');
    expect(chosen()).toBe('Today · Mon 9 Nov · 10:00');
    await fireEvent.press(screen.getByTestId('wheel-minute-01-c4'));
    expect(chosen()).toBe('Today · Mon 9 Nov · 10:01');
    // And back up past 00 to 59 (the copy above).
    await fireEvent.press(screen.getByTestId('wheel-minute-59-c2'));
    expect(chosen()).toBe('Today · Mon 9 Nov · 10:59');
    // Once settled it rests on the middle copy again.
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    const home = within(screen.getByTestId('wheel-minute-59')).getByText('59');
    expect(StyleSheet.flatten(home.props.style).fontWeight).toBe('700');
  });

  it('hours loop 23 → 00 on Yesterday and stay on yesterday', async () => {
    await openPicker();
    await fireEvent.press(screen.getByRole('tab', { name: 'Yesterday, Sun 8 Nov' }));
    await fireEvent.press(screen.getByTestId('wheel-hour-23'));
    await fireEvent.press(screen.getByTestId('wheel-minute-00'));
    expect(chosen()).toBe('Yesterday · Sun 8 Nov · 23:00');
    await fireEvent.press(screen.getByTestId('wheel-hour-00-c4'));
    expect(chosen()).toBe('Yesterday · Sun 8 Nov · 00:00');
    await fireEvent.press(screen.getByTestId('wheel-hour-23-c2'));
    expect(chosen()).toBe('Yesterday · Sun 8 Nov · 23:00');
  });

  it('on Today, numbers past the latest stay struck through and can’t be chosen when wrapped to', async () => {
    await openPicker();
    await fireEvent.press(screen.getByTestId('wheel-hour-00'));
    expect(chosen()).toBe('Today · Mon 9 Nov · 00:40');
    // Wrapping back from 00 reaches 23, which is past 14:40.
    expect(struck('wheel-hour-23-c2')).toBe(true);
    await fireEvent.press(screen.getByTestId('wheel-hour-23-c2'));
    expect(chosen()).toBe('Today · Mon 9 Nov · 14:40');
    expect(screen.getByText('Latest is 14:40.')).toBeTruthy();
  });

  it('VoiceOver swipes stop at 00, 59 and the latest instead of wrapping', async () => {
    await openPicker();
    await fireEvent.press(screen.getByRole('tab', { name: 'Yesterday, Sun 8 Nov' }));
    await fireEvent.press(screen.getByTestId('wheel-minute-59'));
    await swipe('wheel-minute', 'increment');
    expect(a11yValue('wheel-minute')).toBe('59');
    await fireEvent.press(screen.getByTestId('wheel-hour-00'));
    await swipe('wheel-hour', 'decrement');
    expect(a11yValue('wheel-hour')).toBe('00');
    await fireEvent.press(screen.getByTestId('wheel-hour-23'));
    await swipe('wheel-hour', 'increment');
    expect(a11yValue('wheel-hour')).toBe('23');
    expect(chosen()).toBe('Yesterday · Sun 8 Nov · 23:59');
  });
});

describe('B. Daily targets', () => {
  /** The in-page header (no native header) and everything below it. */
  function expectTargetsVisible() {
    const shell = screen.getByTestId('screen-targets');
    expect(within(shell).getByRole('header', { name: 'Daily targets' })).toBeTruthy();
    expect(within(shell).getByRole('button', { name: 'Cancel' })).toBeTruthy();
    // The intro sits below the header in the page, not under a translucent native bar.
    expect(within(shell).getByTestId('targets-intro').props.children).toMatch(
      /^Your daily targets for calories/,
    );
    expect(within(shell).getByLabelText('Calories (kcal)')).toBeTruthy();
    expect(within(shell).getByRole('button', { name: 'Save targets' })).toBeTruthy();
  }

  it('from Me: in-page header and intro visible; Cancel goes back', async () => {
    await start(state(), '/me');
    await press('Meal plan & macro targets');
    await screen.findByTestId('screen-targets');
    expectTargetsVisible();
    await press('Cancel');
    await screen.findByTestId('screen-me');
  });

  it('from onboarding 0g: same header and intro; saving returns to 0g', async () => {
    const s = state();
    await start(
      { ...s, settings: { ...s.settings!, onboardingCompletedAt: null } },
      '/onboarding/finish',
    );
    await press(/Set targets now|Edit targets/);
    await screen.findByTestId('screen-targets');
    expectTargetsVisible();
    await press('Save targets');
    await screen.findByTestId('screen-onboarding-finish');
  });
});

const logsNamed = (name: string) => mockBackend.state.mealLogs.filter((l) => l.name === name);
const consentOff = () => ({ ...state(), healthConsent: false });

describe('C. Yesterday on Today', () => {
  it('“‹ Yesterday” shows yesterday’s meals and totals, with no Now line or Ate it; Today › goes back', async () => {
    await start(state());
    await screen.findByTestId('timeline');
    expect(screen.getByLabelText(/^Now, 13:40/)).toBeTruthy();
    await press('See yesterday');
    await screen.findByTestId('timeline-yesterday');
    expect(timelineTitles('timeline-yesterday')).toEqual(['Sample tuna wrap']);
    expect(screen.getByText('Yesterday · Sun 8 Nov')).toBeTruthy();
    expect(screen.queryByLabelText(/^Now,/)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Ate it/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Log meal' })).toBeNull();
    expect(screen.getByLabelText('Yesterday’s calories: 410 of 2,450')).toBeTruthy();
    expect(screen.getByLabelText('Yesterday’s water: 750 ml of 3 L')).toBeTruthy();
    await press('Back to today');
    await screen.findByTestId('timeline');
    expect(timelineTitles()).toEqual([
      'Test oats bowl',
      'Lunch · Sample chicken rice bowl',
      'Sample tuna wrap',
    ]);
  });

  it('yesterday’s meals open in 7j and can be edited', async () => {
    await start(state());
    await press('See yesterday');
    await openMeal('log-yday');
    expect(screen.getByRole('button', { name: 'Edit meal' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Log a corrected copy' })).toBeTruthy();
    await press('Edit meal');
    await screen.findByTestId('screen-7k');
    await fireEvent.changeText(screen.getByLabelText('Meal name'), 'Sample tuna wrap, late');
    await press(/^Save/);
    await waitFor(() => expect(logsNamed('Sample tuna wrap, late')).toHaveLength(1));
  });

  it('a meal moved to yesterday shows on yesterday’s timeline', async () => {
    await start(state());
    await openMeal('log-oats');
    await press('Edit meal');
    await screen.findByTestId('screen-7k');
    await press(/^Time eaten|Change/);
    await screen.findByTestId('sheet-7i');
    await fireEvent.press(screen.getByRole('tab', { name: 'Yesterday, Sun 8 Nov' }));
    await fireEvent.press(screen.getByTestId('wheel-hour-21'));
    await fireEvent.press(screen.getByTestId('time-done'));
    await waitFor(() => expect(screen.queryByTestId('sheet-7i')).toBeNull());
    await press(/^Save/);
    await screen.findByTestId('screen-today');
    await press('See yesterday');
    await waitFor(() =>
      expect(timelineTitles('timeline-yesterday')).toEqual(['Sample tuna wrap', 'Test oats bowl']),
    );
  });

  it('consent off: no yesterday control', async () => {
    await start(consentOff());
    await screen.findByTestId('today-consent-off');
    expect(screen.queryByRole('button', { name: 'See yesterday' })).toBeNull();
  });
});

describe('E. Log again', () => {
  it('logs the same components as a new meal now and leaves the original', async () => {
    await start(state());
    await openMeal('log-oats');
    expect(within(screen.getByTestId('log-again')).getByText('Log again')).toBeTruthy();
    await press('Log again now');
    await screen.findByTestId('screen-today');
    const both = logsNamed('Test oats bowl');
    expect(both).toHaveLength(2);
    const copy = both.find((l) => l.id !== 'log-oats')!;
    expect(copy.loggedAt).toMatch(/^2026-11-09T13:40/);
    expect(copy.items.map((i) => [i.foodName, i.grams, i.unit])).toEqual([
      ['Test oats', 60, 'g'],
      ['Sample whey', 30, 'g'],
    ]);
    expect(both.find((l) => l.id === 'log-oats')!.loggedAt).toBe(OATS_BOWL.loggedAt);
  });

  it('“Other time…” uses the 7i sheet (opening on Today)', async () => {
    await start(state());
    await openMeal('log-oats');
    await press('Log again at another time');
    await screen.findByTestId('sheet-7i');
    expect(
      screen.getByRole('tab', { name: 'Today, Mon 9 Nov' }).props.accessibilityState.selected,
    ).toBe(true);
    await fireEvent.press(screen.getByRole('tab', { name: 'Yesterday, Sun 8 Nov' }));
    await fireEvent.press(screen.getByTestId('wheel-hour-21'));
    await fireEvent.press(screen.getByTestId('wheel-minute-15'));
    await fireEvent.press(screen.getByTestId('time-done'));
    await screen.findByTestId('screen-today');
    const copy = logsNamed('Test oats bowl').find((l) => l.id !== 'log-oats')!;
    expect(copy.loggedAt).toBe('2026-11-08T21:15:00.000Z');
  });

  it('a deleted food goes to Build meal, where it shows as no longer available', async () => {
    const s = state();
    await start({ ...s, foods: s.foods!.filter((f) => f.id !== F.whey.id) });
    await openMeal('log-oats');
    await press('Log again now');
    await screen.findByTestId('screen-build-meal');
    expect(screen.getByTestId('unavailable-item')).toBeTruthy();
    expect(
      screen.getByText(
        'Sample whey is no longer available, so it can’t be added again. Remove it to carry on.',
      ),
    ).toBeTruthy();
    const done = screen.getByRole('button', { name: /^Done · log meal/ });
    expect(done.props.accessibilityState.disabled).toBe(true);
    await press('Remove Sample whey');
    await press(/^Done · log meal \(233 kcal\)/);
    await screen.findByTestId('screen-today');
    expect(logsNamed('Test oats bowl')).toHaveLength(2);
  });
});

describe('D. Log a corrected copy', () => {
  async function openCorrected(id: string, init = state()) {
    await start(init);
    await openMeal(id);
    await fireEvent.press(screen.getByRole('link', { name: 'Log a corrected copy' }));
    await screen.findByTestId('screen-build-meal');
  }

  it('opens Build meal pre-filled: name, time chip and components with amounts and units', async () => {
    await openCorrected('log-oats');
    expect(screen.getByLabelText('Meal name').props.value).toBe('Test oats bowl');
    expect(screen.getByRole('button', { name: 'Time eaten: Today · 06:40. Change' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Test oats, 60 g. Change amount' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sample whey, 30 g. Change amount' })).toBeTruthy();
    expect(screen.getByTestId('corrected-copy-note')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save to roster only' })).toBeNull();
    expect(
      screen.getByRole('button', { name: /^Done · log corrected copy \(353 kcal\)/ }),
    ).toBeTruthy();
  });

  it('Done logs the corrected meal and deletes the original in one step, keeping the plan link', async () => {
    await openCorrected('log-lunch');
    await press('Remove Test basmati rice, cooked');
    await press(/^Done · log corrected copy/);
    await screen.findByTestId('screen-today');
    const logs = logsNamed('Lunch · Sample chicken rice bowl');
    expect(logs).toHaveLength(1);
    expect(logs[0]!.id).not.toBe('log-lunch');
    expect(logs[0]!.savedMealId).toBe('meal-lunch');
    expect(logs[0]!.loggedAt).toBe(LUNCH.loggedAt);
    expect(logs[0]!.items.map((i) => i.foodName)).toEqual(['Sample chicken breast, cooked']);
    expect(mockBackend.state.calls.filter((c) => c === 'replaceLoggedMeal')).toHaveLength(1);
    expect(mockBackend.state.calls).not.toContain('logMeal');
    expect(mockBackend.state.calls).not.toContain('deleteMealLog');
  });

  it('Cancel leaves the original untouched', async () => {
    await openCorrected('log-oats');
    await press('Cancel, keep the meal as it is');
    await screen.findByTestId('screen-7j');
    expect(mockBackend.state.mealLogs.find((l) => l.id === 'log-oats')).toEqual(OATS_BOWL);
    expect(mockBackend.state.calls).not.toContain('replaceLoggedMeal');
  });

  it('a failure changes nothing and says why', async () => {
    await openCorrected('log-oats');
    mockBackend.failNext('replaceLoggedMeal', new Error('Couldn’t reach the server.'));
    await press(/^Done · log corrected copy/);
    expect(await screen.findByText('Couldn’t reach the server.')).toBeTruthy();
    expect(mockBackend.state.mealLogs.find((l) => l.id === 'log-oats')).toEqual(OATS_BOWL);
    expect(logsNamed('Test oats bowl')).toHaveLength(1);
  });

  it('a deleted food shows as no longer available and must be removed first', async () => {
    const s = state();
    await openCorrected('log-oats', { ...s, foods: s.foods!.filter((f) => f.id !== F.whey.id) });
    expect(screen.getByText(/^Sample whey is no longer available/)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /^Done · log corrected copy/ }).props.accessibilityState
        .disabled,
    ).toBe(true);
    await press('Remove Sample whey');
    await press(/^Done · log corrected copy \(233 kcal\)/);
    await screen.findByTestId('screen-today');
    expect(logsNamed('Test oats bowl').map((l) => l.items.length)).toEqual([1]);
  });

  it('consent off: 7j and the corrected copy say health data is off', async () => {
    await start(consentOff(), '/meal/log-oats');
    expect(await screen.findByText(/Health data is off/)).toBeTruthy();
    await start(consentOff(), '/log-meal/from-log?id=log-oats&mode=correct');
    expect(await screen.findByText(/Health data is off/)).toBeTruthy();
  });
});

describe('F. Ate it at the plan’s time', () => {
  it('logs at the usual time when it has passed, otherwise now', async () => {
    await start(state({ mealLogs: [OATS_BOWL] }));
    await screen.findByTestId('timeline');
    await press('Ate it: Lunch · Sample chicken rice bowl');
    await waitFor(() => expect(logsNamed('Lunch · Sample chicken rice bowl')).toHaveLength(1));
    expect(logsNamed('Lunch · Sample chicken rice bowl')[0]!.loggedAt).toBe(
      '2026-11-09T12:30:00.000Z',
    );
    await press('Ate it: Snack · yoghurt bowl');
    await waitFor(() => expect(logsNamed('Snack · yoghurt bowl')).toHaveLength(1));
    expect(logsNamed('Snack · yoghurt bowl')[0]!.loggedAt).toMatch(/^2026-11-09T13:40/);
  });
});

describe('H. Undo after deleting a meal', () => {
  async function deleteOats() {
    await start(state());
    await openMeal('log-oats');
    await fireEvent.press(screen.getByRole('link', { name: 'Delete meal' }));
    await screen.findByTestId('sheet-7l');
    await fireEvent.press(
      within(screen.getByTestId('sheet-7l')).getByRole('button', { name: 'Delete meal' }),
    );
    await screen.findByTestId('undo-note');
  }

  it('hides the meal at once and shows “Meal deleted · Undo”; Undo brings it back', async () => {
    await deleteOats();
    expect(screen.getByText('Meal deleted ·')).toBeTruthy();
    expect(timelineTitles()).not.toContain('Test oats bowl');
    expect(mockBackend.state.calls).not.toContain('deleteMealLog');
    await press('Undo delete');
    expect(screen.queryByTestId('undo-note')).toBeNull();
    expect(timelineTitles()).toContain('Test oats bowl');
    await act(async () => {
      jest.advanceTimersByTime(6000);
    });
    expect(mockBackend.state.calls).not.toContain('deleteMealLog');
    expect(mockBackend.state.mealLogs.some((l) => l.id === 'log-oats')).toBe(true);
  });

  it('deletes when the note times out (about 5 seconds)', async () => {
    await deleteOats();
    await act(async () => {
      jest.advanceTimersByTime(4900);
    });
    expect(mockBackend.state.calls).not.toContain('deleteMealLog');
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    await waitFor(() => expect(screen.queryByTestId('undo-note')).toBeNull());
    expect(mockBackend.state.mealLogs.some((l) => l.id === 'log-oats')).toBe(false);
  });

  it('deletes straight away when the note is dismissed', async () => {
    await deleteOats();
    await press('Dismiss');
    await waitFor(() =>
      expect(mockBackend.state.mealLogs.some((l) => l.id === 'log-oats')).toBe(false),
    );
  });

  it('a plan meal shows as not eaten while the note is up', async () => {
    await start(state());
    await openMeal('log-lunch');
    await fireEvent.press(screen.getByRole('link', { name: 'Delete meal' }));
    await fireEvent.press(
      within(screen.getByTestId('sheet-7l')).getByRole('button', { name: 'Delete meal' }),
    );
    await screen.findByTestId('undo-note');
    expect(
      screen.getByRole('button', { name: 'Ate it: Lunch · Sample chicken rice bowl' }),
    ).toBeTruthy();
    await press('Undo delete');
    expect(
      screen.queryByRole('button', { name: 'Ate it: Lunch · Sample chicken rice bowl' }),
    ).toBeNull();
  });

  it('if the delete fails, the meal comes back with an error', async () => {
    await deleteOats();
    mockBackend.failNext('deleteMealLog', new Error('Couldn’t reach the server.'));
    await press('Dismiss');
    expect(
      await screen.findByText(
        'Couldn’t delete “Test oats bowl”, so it’s back. Couldn’t reach the server.',
      ),
    ).toBeTruthy();
    expect(timelineTitles()).toContain('Test oats bowl');
  });
});
