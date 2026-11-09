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
    mealLogs: [OATS_BOWL, LUNCH, WRAP],
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
/** Titles of the Today timeline, in order. */
const timelineTitles = () =>
  within(screen.getByTestId('timeline'))
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
