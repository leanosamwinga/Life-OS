/**
 * Log meal follow-up (wireframes "Log meal Custom time & edit" and the "-U" frames): one test
 * per wireframe state — 7a-T (Other time… offered, custom time chosen), 7i (default, a past
 * time on Yesterday, more than an hour ahead), 7b-T, 1B (before and after the time change),
 * 7j (ordinary, from the plan), 7j-U, 7k (default, name changed, moved to yesterday, saving),
 * 7k-U, 7l (ordinary, from the plan), 7d-U (drink in ml, switched to g), 7e-U. 7h-U is in
 * saved-batches.test.tsx.
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

let mockScanned = '';
jest.mock('@/features/log-meal/BarcodeScanner', () => {
  const { Pressable, Text } = jest.requireActual('react-native');
  return {
    BarcodeScanner: ({ onBarcode }: { onBarcode: (c: string) => void }) => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Simulate scan"
        onPress={() => onBarcode(mockScanned)}
      >
        <Text>camera</Text>
      </Pressable>
    ),
  };
});

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
// Logged in g by mistake; 7k-U switches it to ml.
const SHAKE_BREAKFAST = log('log-shake', 'Test shake breakfast', '2026-11-09T07:15:00.000Z', [
  { food: food(F.oats), grams: 60 },
  { food: food(F.shake), grams: 330, unit: 'g' },
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

async function openLogMeal() {
  await start(state(), '/log-meal');
  await screen.findByTestId('when-chips');
}

describe('7a-T and 7i: log at another time', () => {
  it('7a-T “Other time…” offered beside Now and the slots', async () => {
    await openLogMeal();
    const labels = within(screen.getByTestId('when-chips'))
      .getAllByRole('button')
      .map((b) => b.props.accessibilityLabel);
    expect(labels).toEqual([
      'Now · 13:40',
      'Breakfast 08:00',
      'Lunch 12:30',
      'Snack 16:00, more than an hour from now',
      'Dinner 18:15, more than an hour from now',
      'Other time',
    ]);
    expect(screen.getByText('Other time…')).toBeTruthy();
  });

  it('7i default: Today, wheels at now, any time up to an hour from now', async () => {
    await openLogMeal();
    await press('Other time');
    await screen.findByTestId('sheet-7i');
    expect(screen.getByText('Time eaten')).toBeTruthy();
    expect(
      screen.getByRole('tab', { name: 'Today, Mon 9 Nov' }).props.accessibilityState.selected,
    ).toBe(true);
    expect(a11yValue('wheel-hour')).toBe('13');
    expect(a11yValue('wheel-minute')).toBe('40');
    expect(screen.getByRole('adjustable', { name: 'Hour' })).toBeTruthy();
    expect(screen.getByTestId('time-chosen').props.children).toBe('Today · Mon 9 Nov · 13:40');
    expect(screen.getByText('Any time from yesterday 00:00 up to 14:40.')).toBeTruthy();
    expect(screen.queryByTestId('time-limit')).toBeNull();
    // VoiceOver: swipe up one hour, then the next hour is past the limit and nothing moves.
    await swipe('wheel-hour', 'increment');
    expect(a11yValue('wheel-hour')).toBe('14');
    await swipe('wheel-hour', 'increment');
    expect(a11yValue('wheel-hour')).toBe('14');
    await swipe('wheel-minute', 'increment');
    expect(a11yValue('wheel-minute')).toBe('40');
  });

  it('7i more than an hour ahead: later times are struck through and held to the latest', async () => {
    await openLogMeal();
    await press('Other time');
    await screen.findByTestId('sheet-7i');
    // Later rows are greyed out and struck through.
    const struck = (id: string) =>
      StyleSheet.flatten(within(screen.getByTestId(id)).getByText(id.slice(-2)).props.style)
        .textDecorationLine === 'line-through';
    expect(struck('wheel-hour-15')).toBe(true);
    expect(struck('wheel-hour-14')).toBe(false);
    await fireEvent.press(screen.getByTestId('wheel-hour-16'));
    expect(screen.getByTestId('time-chosen').props.children).toBe('Today · Mon 9 Nov · 14:40');
    expect(screen.getByTestId('time-limit')).toBeTruthy();
    expect(screen.getByText('Latest is 14:40.')).toBeTruthy();
    expect(
      screen.getByText(
        /That’s an hour from now, so later times are greyed out and can’t be chosen\./,
      ),
    ).toBeTruthy();
    expect(struck('wheel-minute-41')).toBe(true);
  });

  it('7i a past time on Yesterday counts towards that day; Done chooses it', async () => {
    await openLogMeal();
    await press('Other time');
    await screen.findByTestId('sheet-7i');
    await fireEvent.press(screen.getByRole('tab', { name: 'Yesterday, Sun 8 Nov' }));
    await fireEvent.press(screen.getByTestId('wheel-hour-21'));
    await fireEvent.press(screen.getByTestId('wheel-minute-15'));
    expect(screen.getByTestId('time-chosen').props.children).toBe('Yesterday · Sun 8 Nov · 21:15');
    expect(screen.getByText('Counts towards Sun 8 Nov’s totals, not today’s.')).toBeTruthy();
    // Nothing is struck through on yesterday.
    expect(screen.getByTestId('wheel-hour-23')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('time-done'));
    await waitFor(() => expect(screen.queryByTestId('sheet-7i')).toBeNull());
    const chip = screen.getByRole('button', { name: 'Time eaten: Yesterday · 21:15. Change' });
    expect(chip.props.accessibilityState.selected).toBe(true);
    expect(screen.getByText('Yesterday · 21:15 ▾')).toBeTruthy();
  });

  it('7a-T custom time chosen → 7b-T time in the header → 1B placed in time order', async () => {
    await openLogMeal();
    await press('Other time');
    await screen.findByTestId('sheet-7i');
    await fireEvent.press(screen.getByTestId('wheel-hour-06'));
    await fireEvent.press(screen.getByTestId('wheel-minute-50'));
    await fireEvent.press(screen.getByTestId('time-done'));
    expect(await screen.findByText('Today · 06:50 ▾')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Now · 13:40' }).props.accessibilityState.selected,
    ).toBe(false);

    await press('+ Build a meal from scratch');
    await screen.findByTestId('screen-build-meal');
    expect(screen.getByTestId('header-time')).toBeTruthy();
    expect(screen.getByText('Today · 06:50 ▾')).toBeTruthy();
    // The header reopens the picker on the chosen time.
    await press('Time eaten: Today · 06:50. Change');
    await screen.findByTestId('sheet-7i');
    expect(screen.getByTestId('time-chosen').props.children).toBe('Today · Mon 9 Nov · 06:50');
    await press('Cancel');
    await fireEvent.changeText(screen.getByLabelText('Meal name'), 'Test second breakfast');
    await press('Add Test oats, 60 g');
    await press('Done · log meal (233 kcal)');
    await screen.findByTestId('screen-today');
    expect(mockBackend.state.mealLogs.at(-1)).toMatchObject({
      name: 'Test second breakfast',
      loggedAt: '2026-11-09T06:50:00.000Z',
    });
    await waitFor(() =>
      expect(
        within(screen.getByTestId('timeline'))
          .getAllByText(/^(Test oats bowl|Test second breakfast|Lunch · Sample chicken rice bowl)$/)
          .map((t) => t.props.children),
      ).toEqual(['Test oats bowl', 'Test second breakfast', 'Lunch · Sample chicken rice bowl']),
    );
  });

  it('a meal logged for yesterday counts towards yesterday, not today', async () => {
    await openLogMeal();
    await press('Other time');
    await fireEvent.press(screen.getByRole('tab', { name: 'Yesterday, Sun 8 Nov' }));
    await fireEvent.press(screen.getByTestId('wheel-hour-21'));
    await fireEvent.press(screen.getByTestId('wheel-minute-15'));
    await fireEvent.press(screen.getByTestId('time-done'));
    await press('+ Build a meal from scratch');
    await screen.findByTestId('screen-build-meal');
    // The bar under the meal is for Sun 8 Nov.
    expect(screen.getByText('Sun 8 Nov after this meal')).toBeTruthy();
    await press('Add Test oats, 60 g');
    await press('Done · log meal (233 kcal)');
    await screen.findByTestId('screen-today');
    expect(mockBackend.state.mealLogs.at(-1)!.loggedAt).toBe('2026-11-08T21:15:00.000Z');
    expect(screen.queryByText('Breakfast')).toBeNull();
  });
});

describe('1B: open a logged meal; before and after the time change', () => {
  it('logged meals open with a chevron; retiming moves the meal in time order', async () => {
    await start(state());
    await screen.findByTestId('open-log-wrap');
    expect(timelineTitles()).toEqual([
      'Test oats bowl',
      'Lunch · Sample chicken rice bowl',
      'Sample tuna wrap',
    ]);
    expect(screen.getAllByText('›').length).toBeGreaterThanOrEqual(3);
    await openMeal('log-wrap');
    await press('Edit meal');
    await screen.findByTestId('screen-7k');
    await press('Time eaten: Today · Mon 9 Nov · 13:35. Change');
    await screen.findByTestId('sheet-7i');
    await fireEvent.press(screen.getByTestId('wheel-hour-11'));
    await fireEvent.press(screen.getByTestId('wheel-minute-00'));
    await fireEvent.press(screen.getByTestId('time-done'));
    expect(await screen.findByText('Today · Mon 9 Nov · 11:00')).toBeTruthy();
    // Same day: no move note.
    expect(screen.queryByTestId('move-note')).toBeNull();
    await press('Save changes');
    await screen.findByTestId('screen-today');
    await waitFor(() =>
      expect(timelineTitles()).toEqual([
        'Test oats bowl',
        'Sample tuna wrap',
        'Lunch · Sample chicken rice bowl',
      ]),
    );
    expect(mockBackend.state.mealLogs.find((l) => l.id === 'log-wrap')!.loggedAt).toBe(
      '2026-11-09T11:00:00.000Z',
    );
  });
});

describe('7j Logged meal', () => {
  it('ordinary: read-only, components, meal totals, Edit meal and a quiet Delete meal', async () => {
    await start(state());
    await openMeal('log-oats');
    expect(screen.getByText('‹ Today')).toBeTruthy();
    expect(screen.getByText('LOGGED MEAL')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Test oats bowl' })).toBeTruthy();
    expect(screen.getByText('Mon 9 Nov · 06:40')).toBeTruthy();
    expect(screen.getByText('COMPONENTS · 2')).toBeTruthy();
    expect(screen.getByText('Test oats · 60 g')).toBeTruthy();
    expect(screen.getByText('233 kcal · P 8.1 · C 39.6 · F 4.1')).toBeTruthy();
    expect(screen.getByText('Sample whey · 30 g')).toBeTruthy();
    expect(screen.getByLabelText('Meal totals: 353 kcal · P 32.1 · C 42.0 · F 5.6')).toBeTruthy();
    expect(screen.queryByTestId('from-plan')).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit meal' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Delete meal' })).toBeTruthy();
    // No edited label anywhere.
    expect(screen.queryByText(/edited/i)).toBeNull();
  });

  it('from the plan: the plan panel and the note that edits don’t change the plan meal', async () => {
    await start(state());
    await openMeal('log-lunch');
    expect(screen.getByText('From your plan · Lunch')).toBeTruthy();
    expect(screen.getByText('Logged from your plan')).toBeTruthy();
    expect(screen.getByText('COMPONENTS · 2')).toBeTruthy();
    expect(screen.getByText('Sample chicken breast, cooked · 150 g')).toBeTruthy();
    expect(screen.getByText('248 kcal · P 46.5 · C 0 · F 5.4')).toBeTruthy();
    expect(
      screen.getByText('Renaming or retiming here doesn’t change the plan meal.'),
    ).toBeTruthy();
  });

  it('7j-U: one item in ml, one in g', async () => {
    await start(
      state({
        mealLogs: [
          log('log-shake-ml', 'Test shake breakfast', '2026-11-09T07:15:00.000Z', [
            { food: food(F.oats), grams: 60 },
            { food: food(F.shake), grams: 330 },
          ]),
        ],
      }),
    );
    await openMeal('log-shake-ml');
    expect(screen.getByText('Test oats · 60 g')).toBeTruthy();
    expect(screen.getByText('Sample protein shake · 330 ml')).toBeTruthy();
    expect(screen.getByText('205 kcal · P 20.1 · C 21.8 · F 4.0')).toBeTruthy();
    expect(screen.getByLabelText('Meal totals: 438 kcal · P 28.2 · C 61.4 · F 8.1')).toBeTruthy();
  });

  it('a link to a meal that has gone says so', async () => {
    await start(state(), '/meal/log-nope');
    expect(await screen.findByText('That meal has gone.')).toBeTruthy();
  });
});

describe('7k Edit logged meal', () => {
  it('default: name, time eaten and locked components; Save changes waits for a change', async () => {
    await start(state());
    await openMeal('log-oats');
    await press('Edit meal');
    await screen.findByTestId('screen-7k');
    expect(screen.getByText('Edit meal')).toBeTruthy();
    expect(screen.getByLabelText('Meal name').props.value).toBe('Test oats bowl');
    expect(screen.getByText('Today · Mon 9 Nov · 06:40')).toBeTruthy();
    expect(screen.getByText('Change ›')).toBeTruthy();
    expect(screen.getByText('COMPONENTS · AMOUNTS LOCKED')).toBeTruthy();
    expect(screen.getByLabelText('Test oats, 60 g, locked')).toBeTruthy();
    expect(screen.getByText('Meal total · 353 kcal · P 32.1 · C 42.0 · F 5.6')).toBeTruthy();
    expect(screen.getByText(/To change amounts, delete this meal and log it again\./)).toBeTruthy();
    expect(screen.queryByText(/≈ 1 ml counts as 1 g/)).toBeNull();
    // Nothing to change the amounts with.
    expect(screen.queryByLabelText('Grams')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Save changes' }).props.accessibilityState.disabled,
    ).toBe(true);
  });

  it('name changed: saves the name only; the plan meal it came from is untouched', async () => {
    await start(state());
    await openMeal('log-lunch');
    await press('Edit meal');
    await screen.findByTestId('screen-7k');
    await fireEvent.changeText(screen.getByLabelText('Meal name'), 'Sample chicken rice, big bowl');
    expect(
      screen.getByRole('button', { name: 'Save changes' }).props.accessibilityState.disabled,
    ).toBe(false);
    await press('Save changes');
    await screen.findByTestId('screen-7j');
    expect(await screen.findByText('Sample chicken rice, big bowl')).toBeTruthy();
    const saved = mockBackend.state.mealLogs.find((l) => l.id === 'log-lunch')!;
    expect(saved.loggedAt).toBe('2026-11-09T12:30:00.000Z');
    expect(saved.items).toEqual(LUNCH.items);
    expect(mockBackend.state.savedMeals.find((m) => m.id === 'meal-lunch')).toMatchObject({
      name: 'Lunch · Sample chicken rice bowl',
      usualTime: '12:30',
    });
    // Bookkeeping only: nothing shows it was edited.
    expect(mockBackend.state.editedAt['log-lunch']).toBeTruthy();
    expect(screen.queryByText(/edited/i)).toBeNull();
  });

  it('moved to yesterday (with saving): the note, then it leaves today’s totals', async () => {
    await start(state());
    await screen.findByLabelText(/^Calories: 1,336/);
    await openMeal('log-oats');
    await press('Edit meal');
    await screen.findByTestId('screen-7k');
    await fireEvent.changeText(screen.getByLabelText('Meal name'), 'Test overnight oats');
    await press('Time eaten: Today · Mon 9 Nov · 06:40. Change');
    await fireEvent.press(screen.getByRole('tab', { name: 'Yesterday, Sun 8 Nov' }));
    await fireEvent.press(screen.getByTestId('wheel-hour-21'));
    await fireEvent.press(screen.getByTestId('wheel-minute-30'));
    await fireEvent.press(screen.getByTestId('time-done'));
    expect(await screen.findByText('Yesterday · Sun 8 Nov · 21:30')).toBeTruthy();
    expect(screen.getByText('Moves to Sun 8 Nov.')).toBeTruthy();
    expect(
      screen.getByText(
        /Today goes down by 353 kcal \(1,336 → 983\)\. Sun 8 Nov goes up by 353 kcal\./,
      ),
    ).toBeTruthy();

    // Saving: hold the request to see the state.
    let release!: () => void;
    const real = mockBackend.updateLoggedMeal.bind(mockBackend);
    mockBackend.updateLoggedMeal = (edit) =>
      new Promise((resolve, reject) => {
        release = () => real(edit).then(resolve, reject);
      });
    await press('Save changes');
    const saving = await screen.findByRole('button', { name: 'Saving…' });
    expect(saving.props.accessibilityState.busy ?? saving.props.accessibilityState.disabled).toBe(
      true,
    );
    expect(screen.getByLabelText('Meal name').props.editable).toBe(false);
    await act(async () => release());

    await screen.findByTestId('screen-today');
    const moved = mockBackend.state.mealLogs.find((l) => l.id === 'log-oats')!;
    expect(moved).toMatchObject({
      name: 'Test overnight oats',
      loggedAt: '2026-11-08T21:30:00.000Z',
    });
    expect(moved.items).toEqual(OATS_BOWL.items);
    await waitFor(() => expect(screen.queryByText('Test overnight oats')).toBeNull());
    expect(await screen.findByLabelText(/^Calories: 983/)).toBeTruthy();
  });

  it('7k-U: switching one item to ml changes the label, not the numbers', async () => {
    await start(state({ mealLogs: [OATS_BOWL, SHAKE_BREAKFAST] }));
    await openMeal('log-shake');
    expect(screen.getByText('Sample protein shake · 330 g')).toBeTruthy();
    await press('Edit meal');
    await screen.findByTestId('screen-7k');
    const ml = screen.getByRole('radio', { name: 'Sample protein shake in millilitres' });
    expect(ml.props.accessibilityState.checked).toBe(false);
    expect(
      screen.getByRole('radio', { name: 'Test oats in grams' }).props.accessibilityState.checked,
    ).toBe(true);
    await fireEvent.press(ml);
    expect(screen.getByText('Sample protein shake · 330 ml')).toBeTruthy();
    expect(screen.getByText('205 kcal · P 20.1 · C 21.8 · F 4.0')).toBeTruthy();
    expect(screen.getByText('Meal total · 438 kcal · P 28.2 · C 61.4 · F 8.1')).toBeTruthy();
    expect(
      screen.getByText(
        '≈ 1 ml counts as 1 g, so switching only fixes the label.\nTo change amounts, delete this meal and log it again.',
      ),
    ).toBeTruthy();
    await press('Save changes');
    await screen.findByTestId('screen-7j');
    expect(await screen.findByText('Sample protein shake · 330 ml')).toBeTruthy();
    const item = mockBackend.state.mealLogs.find((l) => l.id === 'log-shake')!.items[1]!;
    expect(item).toEqual({ ...SHAKE_BREAKFAST.items[1], unit: 'ml' });
  });

  it('consent off: edits and deletes are refused by the backend', async () => {
    mockBackend = createMemoryBackend(state({ healthConsent: false }));
    await expect(
      mockBackend.updateLoggedMeal({ id: 'log-oats', name: 'x', loggedAt: null, units: [] }),
    ).rejects.toThrow(/health data/i);
    await expect(mockBackend.deleteMealLog('log-oats')).rejects.toThrow(/health data/i);
  });
});

describe('7l Delete meal', () => {
  it('ordinary: what today’s total becomes; deleting takes it off Today', async () => {
    await start(state());
    await openMeal('log-oats');
    await fireEvent.press(screen.getByRole('link', { name: 'Delete meal' }));
    await screen.findByTestId('sheet-7l');
    const sheet = within(screen.getByTestId('sheet-7l'));
    expect(sheet.getByText('Delete Test oats bowl?')).toBeTruthy();
    expect(
      sheet.getByText('It comes off Mon 9 Nov. This can’t be undone; you can log it again.'),
    ).toBeTruthy();
    expect(sheet.getByText('Today now')).toBeTruthy();
    expect(sheet.getByText('1,336 kcal')).toBeTruthy();
    expect(sheet.getByText('353 kcal · P 32.1 g')).toBeTruthy();
    expect(sheet.getByText('Today after')).toBeTruthy();
    expect(sheet.getByText('983 kcal')).toBeTruthy();
    expect(sheet.queryByTestId('plan-back')).toBeNull();
    await fireEvent.press(sheet.getByRole('button', { name: 'Delete meal' }));
    await screen.findByTestId('screen-today');
    expect(mockBackend.state.mealLogs.some((l) => l.id === 'log-oats')).toBe(false);
    await waitFor(() => expect(screen.queryByTestId('open-log-oats')).toBeNull());
  });

  it('from the plan: the plan meal goes back as not eaten, with “Ate it” again', async () => {
    await start(state());
    await screen.findByTestId('open-log-lunch');
    expect(
      screen.queryByRole('button', { name: 'Ate it: Lunch · Sample chicken rice bowl' }),
    ).toBeNull();
    await openMeal('log-lunch');
    await fireEvent.press(screen.getByRole('link', { name: 'Delete meal' }));
    const sheet = within(await screen.findByTestId('sheet-7l'));
    expect(sheet.getByText('Delete Lunch · Sample chicken rice bowl?')).toBeTruthy();
    expect(sheet.getByText('Lunch goes back on your plan as not eaten.')).toBeTruthy();
    expect(
      sheet.getByText(/“Ate it” comes back at 12:30\. The plan meal itself isn’t changed\./),
    ).toBeTruthy();
    await fireEvent.press(sheet.getByRole('button', { name: 'Delete meal' }));
    await screen.findByTestId('screen-today');
    expect(
      await screen.findByRole('button', { name: 'Ate it: Lunch · Sample chicken rice bowl' }),
    ).toBeTruthy();
    expect(mockBackend.state.savedMeals.some((m) => m.id === 'meal-lunch')).toBe(true);
  });

  it('Cancel keeps the meal', async () => {
    await start(state());
    await openMeal('log-wrap');
    await fireEvent.press(screen.getByRole('link', { name: 'Delete meal' }));
    await fireEvent.press(
      within(await screen.findByTestId('sheet-7l')).getByRole('button', { name: 'Cancel' }),
    );
    await waitFor(() => expect(screen.queryByTestId('sheet-7l')).toBeNull());
    expect(mockBackend.state.mealLogs.some((l) => l.id === 'log-wrap')).toBe(true);
  });
});

describe('-U frames: g or ml when adding', () => {
  async function scanShake() {
    await openLogMeal();
    await press('+ Build a meal from scratch');
    await fireEvent.changeText(screen.getByLabelText('Meal name'), 'Sample breakfast');
    await press('Scan to add a component');
    await screen.findByTestId('screen-add-component');
    mockScanned = F.shake.barcode!;
    await press('Simulate scan');
    await screen.findByTestId('screen-how-much');
  }

  it('7d-U drink in ml: opens in ml with last time and half bottle', async () => {
    await scanShake();
    expect(screen.getByText('Adding to Sample breakfast')).toBeTruthy();
    expect(screen.getByText('330 ml bottle · barcode 0000000000962')).toBeTruthy();
    expect(screen.getByText('Per 100 ml: 62 kcal · P 6.1 · C 6.6 · F 1.2')).toBeTruthy();
    expect(screen.getByLabelText('Millilitres').props.value).toBe('330');
    expect(
      screen.getByRole('radio', { name: 'Sample protein shake in millilitres' }).props
        .accessibilityState.checked,
    ).toBe(true);
    expect(screen.queryByText('≈ 1 ml counts as 1 g')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Last time · 330 ml' }).props.accessibilityState.selected,
    ).toBe(true);
    expect(screen.getByRole('button', { name: 'Half bottle · 165 ml' })).toBeTruthy();
    expect(
      screen.getByLabelText(/^205 kcal, protein 20.1 g, carbs 21.8 g, fat 4.0 g$/),
    ).toBeTruthy();
    expect(screen.getByText('330 ml × per-100 ml values ÷ 100')).toBeTruthy();
    expect(screen.getByText('From Open Food Facts · nutrition per 100 ml.')).toBeTruthy();
    expect(screen.getByText('Food data from Open Food Facts (ODbL)')).toBeTruthy();
    await press('Add component · 205 kcal');
    expect(await screen.findByText(/Sample protein shake/)).toBeTruthy();
    expect(screen.getByText(' · 330 ml', { exact: false })).toBeTruthy();
  });

  it('7d-U drink switched to g: the ≈ line, same numbers, shown as 330 g', async () => {
    await scanShake();
    await fireEvent.press(screen.getByRole('radio', { name: 'Sample protein shake in grams' }));
    expect(screen.getByText('≈ 1 ml counts as 1 g')).toBeTruthy();
    expect(screen.getByLabelText('Grams').props.value).toBe('330');
    expect(
      screen.getByRole('button', { name: 'Last time · 330 ml' }).props.accessibilityState.selected,
    ).toBe(false);
    expect(screen.getByText('330 g × per-100 ml values ÷ 100')).toBeTruthy();
    expect(
      screen.getByLabelText(/^205 kcal, protein 20.1 g, carbs 21.8 g, fat 4.0 g$/),
    ).toBeTruthy();
    await press('Add component · 205 kcal');
    await screen.findByTestId('screen-build-meal');
    expect(screen.getByText(' · 330 g', { exact: false })).toBeTruthy();
    await press('Done · log meal (205 kcal)');
    await screen.findByTestId('screen-today');
    const item = mockBackend.state.mealLogs.at(-1)!.items[0]!;
    expect(item).toMatchObject({ grams: 330, unit: 'g', macros: { kcal: 205 } });
    expect(mockBackend.state.lastPortions[F.shake.id]).toMatchObject({ grams: 330, unit: 'g' });
  });

  it('7e-U manual entry per 100 ml: the amount is in ml and the food is saved per 100 ml', async () => {
    await openLogMeal();
    await press('+ Build a meal from scratch');
    await fireEvent.changeText(screen.getByLabelText('Meal name'), 'Sample breakfast');
    await press('Scan to add a component');
    await screen.findByTestId('screen-add-component');
    await press('Not found? Add it from the label');
    await screen.findByTestId('screen-manual-entry');
    expect(screen.getByText('Nutrition from the pack')).toBeTruthy();
    expect(screen.getByText('The label gives values')).toBeTruthy();
    expect(screen.getByText('Saved as per 100 g')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Food name'), 'Sample oat drink');
    await fireEvent.press(screen.getByRole('radio', { name: 'Label values per 100 ml' }));
    expect(screen.getByText('per 100 ml')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Calories (kcal)'), '45');
    await fireEvent.changeText(screen.getByLabelText('Protein (g)'), '1.0');
    await fireEvent.changeText(screen.getByLabelText('Carbs (g)'), '6.6');
    await fireEvent.changeText(screen.getByLabelText('Fat (g)'), '1.5');
    await fireEvent.changeText(screen.getByLabelText('Millilitres'), '250');
    expect(screen.getByLabelText('113 kcal, protein 2.5 g, carbs 16.5 g, fat 3.8 g')).toBeTruthy();
    expect(screen.getByText('Saved as per 100 ml')).toBeTruthy();
    await press('Add component · 113 kcal');
    await screen.findByTestId('screen-build-meal');
    expect(screen.getByText(' · 250 ml', { exact: false })).toBeTruthy();
    expect(mockBackend.state.foods.find((f) => f.name === 'Sample oat drink')).toMatchObject({
      nutritionUnit: 'ml',
      kcalPer100g: 45,
    });
  });
});
