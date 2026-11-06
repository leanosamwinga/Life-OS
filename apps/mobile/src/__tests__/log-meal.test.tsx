import path from 'node:path';
import { Alert } from 'react-native';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { createMemoryBackend, type MemoryBackend, type MemoryState } from '@/test/memoryBackend';
import { FOODS, liveState } from '@/test/fixtures';

const APP_DIR = path.resolve(__dirname, '../app');

let mockBackend: MemoryBackend;
jest.mock('@/lib/backend/current', () => ({ getBackend: () => mockBackend }));

beforeAll(() => {
  jest.useFakeTimers({ advanceTimers: true });
  jest.setSystemTime(new Date('2026-11-06T13:40:00Z'));
});
afterAll(() => jest.useRealTimers());

async function start(init: Partial<MemoryState>, url = '/') {
  mockBackend = createMemoryBackend(init);
  await renderRouter(APP_DIR, { initialUrl: url });
  await screen.findByTestId(/^screen-/);
}

const press = (name: string | RegExp) => fireEvent.press(screen.getByRole('button', { name }));
const kcalLabel = () => screen.getByLabelText(/^Calories: /).props.accessibilityLabel as string;

describe('Today and Health on real data', () => {
  it('Today shows your own meals, plan meals and targets; no sample data', async () => {
    await start(liveState());
    await screen.findByText('Breakfast · oats');
    expect(screen.queryByText('Not connected')).toBeNull();
    expect(screen.queryByText('Lunch · chicken rice bowl')).toBeNull(); // sample data
    expect(kcalLabel()).toBe('Calories: 300 of 2,450');
    expect(screen.getByLabelText(/^Water: 500 ml of 3 L/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ate it: Snack · yoghurt bowl' })).toBeTruthy();
  });

  it('"Ate it" saves the plan meal via log_meal and updates the ring', async () => {
    await start(liveState());
    await screen.findByText('Breakfast · oats');
    await press('Ate it: Snack · yoghurt bowl');
    await waitFor(() => expect(kcalLabel()).toBe('Calories: 450 of 2,450'));
    const log = mockBackend.state.mealLogs.at(-1)!;
    expect(log.savedMealId).toBe('meal-snack');
    expect(log.items.map((i) => i.macros.kcal)).toEqual([114, 36]);
    expect(mockBackend.state.lastPortions[FOODS.yoghurt.id]!.grams).toBe(200);
    expect(screen.queryByRole('button', { name: 'Ate it: Snack · yoghurt bowl' })).toBeNull();
  });

  it('Health "+ 250 ml" saves water', async () => {
    await start(liveState(), '/health');
    await screen.findByText('Breakfast · oats');
    expect(screen.getByLabelText('Water: 500 ml of 3 L')).toBeTruthy();
    await press('Add 250 ml of water');
    await screen.findByLabelText('Water: 750 ml of 3 L');
    expect(mockBackend.state.water).toHaveLength(2);
    expect(screen.getByLabelText(/Snack · yoghurt bowl, planned/)).toBeTruthy();
  });

  it('consent off: Today and Health explain, nothing health-related is loaded', async () => {
    await start(liveState({ healthConsent: false }));
    expect(await screen.findByTestId('today-consent-off')).toBeTruthy();
    expect(kcalLabel()).toBe('Calories: health data is off');
    expect(mockBackend.state.calls).not.toContain('listMealLogs');
    await fireEvent.press(screen.getByTestId('tab-health'));
    expect(await screen.findByTestId('health-consent-off')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add 250 ml of water' })).toBeNull();
  });

  it('consent off: Log meal asks first, and saying yes shows the roster', async () => {
    await start(liveState({ healthConsent: false }), '/log-meal');
    expect(await screen.findByTestId('screen-log-meal-consent-off')).toBeTruthy();
    await press('Yes, use my health data');
    expect(await screen.findByTestId('screen-log-meal')).toBeTruthy();
    expect(mockBackend.state.consentLog).toEqual(['granted']);
    expect(await screen.findByText('Protein shake')).toBeTruthy();
  });
});

describe('Log meal (7a, 7b)', () => {
  it('7a: roster with Done/Log, the next plan slot, and eaten-recently', async () => {
    await start(liveState(), '/log-meal');
    await screen.findByText('Protein shake');
    expect(screen.getByText('300 of 2,450 kcal so far')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Logging for Snack · 16:00/ })).toBeTruthy();
    expect(screen.getByText('Done')).toBeTruthy();
    expect(screen.getByText('Logged 08:00 · 300 kcal')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Log again: Chicken stir-fry' })).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Search your meals and foods'), 'shake');
    await waitFor(() => expect(screen.queryByText('Snack · yoghurt bowl')).toBeNull());
    expect(screen.getByText('Protein shake')).toBeTruthy();
  });

  it('7a: "Log" logs a roster meal at the chosen slot time and closes', async () => {
    await start(liveState(), '/log-meal');
    await screen.findByText('Protein shake');
    await press(/Logging for/);
    await press('Lunch · 12:30');
    await press('Log Protein shake');
    expect(await screen.findByTestId('screen-today')).toBeTruthy();
    const log = mockBackend.state.mealLogs.at(-1)!;
    expect(log).toMatchObject({
      name: 'Protein shake',
      savedMealId: 'meal-shake',
      loggedAt: '2026-11-06T12:30:00.000Z',
    });
  });

  it('7a: "Log again" re-logs a recent meal with current foods', async () => {
    await start(liveState(), '/log-meal');
    await press('Log again: Chicken stir-fry');
    await screen.findByTestId('screen-today');
    const log = mockBackend.state.mealLogs.at(-1)!;
    expect(log.name).toBe('Chicken stir-fry');
    expect(log.items.map((i) => [i.foodName, i.grams])).toEqual([
      ['Chicken breast, raw', 150],
      ['Basmati rice, cooked', 100],
    ]);
  });

  it('7b: build from scratch with a suggestion and a searched food, save to roster and log', async () => {
    await start(liveState(), '/log-meal');
    await screen.findByText('Protein shake');
    await press('+ Build a meal from scratch');
    await screen.findByTestId('screen-build-meal');
    await fireEvent.changeText(screen.getByLabelText('Meal name'), 'Chicken stir-fry');
    // Suggested from last time
    await press('Add Chicken breast, raw, 150 g');
    expect(screen.getByText('Chicken breast, raw · 150 g')).toBeTruthy();
    // Search → how much (no last time) → 70 g
    await press('Search to add a component');
    await screen.findByTestId('screen-add-component');
    await fireEvent.changeText(screen.getByLabelText('Search foods'), 'yoghurt');
    await screen.findByRole('button', { name: 'Add Greek yoghurt 0%' });
    await press('Add Greek yoghurt 0%');
    await screen.findByTestId('screen-how-much');
    expect(screen.getByText('Food data from Open Food Facts (ODbL)')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Enter how much you had' }).props.accessibilityState
        .disabled,
    ).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('Grams'), '70');
    await press('Add component · 40 kcal');
    await screen.findByTestId('screen-build-meal');
    expect(screen.getByLabelText(/^Meal so far: 199 kcal · P 43.0 · C 2.5 · F 1.9/)).toBeTruthy();
    expect(screen.getByLabelText('Today after this meal: 499 / 2,450 kcal')).toBeTruthy();

    // Remove and re-add to prove the × works
    await press('Remove Greek yoghurt 0%');
    expect(screen.queryByText(/Greek yoghurt 0% ·/)).toBeNull();

    await fireEvent(screen.getByRole('switch', { name: 'Save to my roster' }), 'valueChange', true);
    await press('Done · log meal (159 kcal)');
    await screen.findByTestId('screen-today');
    const saved = mockBackend.state.savedMeals.find((m) => m.name === 'Chicken stir-fry')!;
    expect(saved.components).toEqual([{ foodId: FOODS.chicken.id, grams: 150 }]);
    const log = mockBackend.state.mealLogs.at(-1)!;
    expect(log).toMatchObject({
      name: 'Chicken stir-fry',
      savedMealId: saved.id,
      loggedAt: '2026-11-06T16:00:00.000Z',
    });
  });

  it('7b: tapping a component changes its amount on "how much"', async () => {
    await start(liveState(), '/log-meal');
    await screen.findByText('Protein shake');
    await press('+ Build a meal from scratch');
    await press('Add Basmati rice, cooked, 100 g');
    await press('Basmati rice, cooked, 100 g. Change amount');
    await screen.findByTestId('screen-how-much');
    expect(screen.getByLabelText('Grams').props.value).toBe('100');
    await press('Last time · 100 g');
    await fireEvent.changeText(screen.getByLabelText('Grams'), '250');
    await press('Update component · 325 kcal');
    expect(await screen.findByText('Basmati rice, cooked · 250 g')).toBeTruthy();
  });

  it('7b: editing a roster meal saves it; deleting removes it from the roster', async () => {
    await start(liveState(), '/log-meal');
    await press('Edit Protein shake');
    await screen.findByTestId('screen-build-meal');
    await fireEvent.changeText(screen.getByLabelText('Meal name'), 'Yoghurt shake');
    await fireEvent(screen.getByRole('switch', { name: 'In my daily plan' }), 'valueChange', true);
    await fireEvent.changeText(screen.getByLabelText('Usual time (24-hour)'), '10:30');
    await press('Save meal');
    await screen.findByText('Yoghurt shake');
    expect(mockBackend.state.savedMeals.find((m) => m.id === 'meal-shake')).toMatchObject({
      name: 'Yoghurt shake',
      inDailyPlan: true,
      usualTime: '10:30',
    });

    jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => {
      (args[2] as { text: string; onPress?: () => void }[])
        .find((b) => b.text === 'Delete')
        ?.onPress?.();
    });
    await press('Edit Yoghurt shake');
    await press('Delete meal');
    await waitFor(() => expect(screen.queryByText('Yoghurt shake')).toBeNull());
    expect(mockBackend.state.savedMeals.map((m) => m.id)).not.toContain('meal-shake');
  });

  it('shows the server’s reason when logging fails, and keeps the draft', async () => {
    await start(liveState(), '/log-meal');
    await press('+ Build a meal from scratch');
    await press('Add Porridge oats, 80 g');
    mockBackend.failNext(
      'logMeal',
      new Error('Nutrition for Porridge oats has changed; refresh and try again.'),
    );
    await press('Done · log meal (300 kcal)');
    expect(await screen.findByText(/has changed; refresh/)).toBeTruthy();
    expect(screen.getByText('Porridge oats · 80 g')).toBeTruthy();
  });
});
