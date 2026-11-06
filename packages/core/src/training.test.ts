import { describe, expect, it } from 'vitest';
import { makeRotation, nextSplitDay } from './training.ts';
import { DEFAULT_NUDGE_SETTINGS } from './defaults.ts';

const rotation = makeRotation(['Arms & shoulders', 'Chest & triceps', 'Legs', 'Back'], 4);

describe('nextSplitDay', () => {
  it('rotation of 4 after 3 sessions this cycle → Day 4 (Back)', () => {
    expect(nextSplitDay(rotation, 3)).toEqual({ day: 4, name: 'Back' });
  });

  it('starts at Day 1 and wraps after a full cycle', () => {
    expect(nextSplitDay(rotation, 0)).toEqual({ day: 1, name: 'Arms & shoulders' });
    expect(nextSplitDay(rotation, 4)).toEqual({ day: 1, name: 'Arms & shoulders' });
    expect(nextSplitDay(rotation, 6)).toEqual({ day: 3, name: 'Legs' });
  });

  it('rejects empty rotations and bad counts', () => {
    expect(() => nextSplitDay(makeRotation([], 4), 0)).toThrow(RangeError);
    expect(() => nextSplitDay(rotation, -1)).toThrow(RangeError);
    expect(() => nextSplitDay(rotation, 1.5)).toThrow(RangeError);
  });
});

describe('DEFAULT_NUDGE_SETTINGS', () => {
  it('is quiet by default with the agreed times', () => {
    expect(DEFAULT_NUDGE_SETTINGS.morningBriefing.weekdayTime).toBe('07:30');
    expect(DEFAULT_NUDGE_SETTINGS.eveningCheckIn.time).toBe('21:30');
    expect(DEFAULT_NUDGE_SETTINGS.eventReminders.enabled).toBe(false);
    expect(DEFAULT_NUDGE_SETTINGS.urgentBillAlerts.enabled).toBe(true);
    expect(DEFAULT_NUDGE_SETTINGS.monthlyStatementImport).toMatchObject({
      dayOfMonth: 1,
      time: '09:00',
    });
    expect(DEFAULT_NUDGE_SETTINGS.quietHours).toEqual({ start: '22:30', end: '07:00' });
  });
});
