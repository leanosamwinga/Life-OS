import { snapshotComponents, type MealLog } from '@life-os/core';
import { samplePlanMeals } from '@/data/sample';
import { buildTimeline, nowIndex } from './timeline';

describe('buildTimeline', () => {
  const lunch = samplePlanMeals[1]!;
  const log: MealLog = {
    id: 'log-1',
    userId: 'u',
    savedMealId: lunch.id,
    name: lunch.name,
    loggedAt: '2026-11-06T12:35:00Z',
    items: snapshotComponents(lunch.components),
  };

  it('orders items by time and hides plan meals that were logged', () => {
    const items = buildTimeline({
      mealLogs: [log],
      planMeals: samplePlanMeals,
      calendar: [{ id: 'e', time: '09:30', title: 'Team standup', kind: 'event' }],
    });
    expect(items.map((i) => i.time)).toEqual(['08:00', '09:30', '12:35', '16:00', '18:15']);
    expect(items.find((i) => i.id === 'log-1')).toMatchObject({
      kind: 'meal-eaten',
      subtitle: '472 kcal · P 53 g',
    });
    expect(items.filter((i) => i.savedMealId === lunch.id)).toHaveLength(0);
  });

  it('is empty with no data', () => {
    expect(buildTimeline({ mealLogs: [], planMeals: [], calendar: [] })).toEqual([]);
  });

  it('places the now line before the first upcoming item', () => {
    const items = buildTimeline({ mealLogs: [], planMeals: samplePlanMeals, calendar: [] });
    expect(nowIndex(items, '13:40')).toBe(2);
    expect(nowIndex(items, '23:00')).toBe(items.length);
  });
});
