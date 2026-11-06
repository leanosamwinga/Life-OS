import path from 'node:path';
import { renderRouter, screen, fireEvent, act } from 'expo-router/testing-library';

const APP_DIR = path.resolve(__dirname, '../app');

describe('app shell', () => {
  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-06T13:40:00Z'));
  });
  afterAll(() => jest.useRealTimers());

  it.each([
    ['/', 'screen-today', 'Today'],
    ['/health', 'screen-health', 'Health'],
    ['/week', 'screen-week', 'Week ahead'],
    ['/money', 'screen-money', 'Money'],
    ['/me', 'screen-me', 'You'],
  ])('renders the %s tab', async (url, testID, title) => {
    await renderRouter(APP_DIR, { initialUrl: url });
    expect(screen.getByTestId(testID)).toBeTruthy();
    expect(screen.getAllByRole('header', { name: title }).length).toBeGreaterThan(0);
  });

  it('shows the five tabs with accessible labels', async () => {
    await renderRouter(APP_DIR, { initialUrl: '/' });
    for (const label of ['Today', 'Health', 'Week', 'Money', 'Me']) {
      const tab = screen.getByTestId(`tab-${label.toLowerCase()}`);
      expect(tab.props.accessibilityLabel).toContain(label);
    }
  });

  it('shows the not-connected banner without Supabase env', async () => {
    await renderRouter(APP_DIR, { initialUrl: '/' });
    expect(screen.getByText('Not connected')).toBeTruthy();
  });

  it('Today shows rings, the timeline and Elsewhere from sample data', async () => {
    await renderRouter(APP_DIR, { initialUrl: '/' });
    expect(screen.getByText('Fri 6 Nov · rest day')).toBeTruthy();
    expect(screen.getByLabelText(/^Calories: /)).toBeTruthy();
    expect(screen.getByLabelText(/^Water: 1.25 L of 3 L/)).toBeTruthy();
    expect(screen.getByText('Lunch · chicken rice bowl')).toBeTruthy();
    expect(screen.getByLabelText('Now, 13:40')).toBeTruthy();
    expect(screen.getByText('Training')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Log meal' })).toBeTruthy();
  });

  it('"Ate it" logs a planned meal and updates the kcal ring', async () => {
    await renderRouter(APP_DIR, { initialUrl: '/' });
    const before = screen.getByLabelText(/^Calories: /).props.accessibilityLabel as string;
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Ate it: Snack · yoghurt & berries' }));
    });
    const after = screen.getByLabelText(/^Calories: /).props.accessibilityLabel as string;
    expect(after).not.toEqual(before);
    expect(screen.queryByRole('button', { name: 'Ate it: Snack · yoghurt & berries' })).toBeNull();
  });

  it('Me shows quiet nudge defaults, privacy controls and the ODbL credit', async () => {
    await renderRouter(APP_DIR, { initialUrl: '/me' });
    expect(screen.getByRole('switch', { name: 'Morning briefing' }).props.value).toBe(true);
    expect(screen.getByRole('switch', { name: 'Event reminders' }).props.value).toBe(false);
    expect(
      screen.getByText('Quiet hours 22:30 – 07:00 · urgent alerts wait until morning'),
    ).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Use my health data' }).props.value).toBe(false);
    expect(screen.getByRole('switch', { name: 'Face ID lock' })).toBeTruthy();
    expect(screen.getByText('Export my data')).toBeTruthy();
    expect(screen.getByText('Delete account')).toBeTruthy();
    expect(screen.getByText('Food data from Open Food Facts (ODbL)')).toBeTruthy();
  });
});
