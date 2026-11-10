import {
  addDays,
  formatDateUK,
  isInLogWindow,
  londonDateTimeToInstant,
  pickerStart,
  toLondonTime,
  type Instant,
  type LocalDate,
  type LocalTime,
  type SavedMeal,
} from '@life-os/core';

export const SLOT_NAMES = ['Breakfast', 'Lunch', 'Snack', 'Dinner'] as const;
export type SlotName = (typeof SLOT_NAMES)[number];

/**
 * When the meal is being logged for: "Now", a named slot at a time today, or a time the user
 * picked on the 7i wheel ("Other time…"), today or yesterday.
 */
export interface MealSlot {
  name: SlotName | 'Now' | 'Custom';
  time: LocalTime;
  /** Custom only: the Europe/London day picked. */
  date?: LocalDate;
}

export const DEFAULT_SLOT_TIMES: Record<SlotName, LocalTime> = {
  Breakfast: '08:00',
  Lunch: '12:30',
  Snack: '16:00',
  Dinner: '18:15',
};

/** Breakfast before 11:00, lunch before 15:00, snack before 17:30, then dinner. */
export function slotForTime(time: LocalTime): SlotName {
  if (time < '11:00') return 'Breakfast';
  if (time < '15:00') return 'Lunch';
  if (time < '17:30') return 'Snack';
  return 'Dinner';
}

/** "Dinner · salmon & potatoes" → Dinner; otherwise by its usual time. */
export function slotOfPlanMeal(meal: Pick<SavedMeal, 'name' | 'usualTime'>): SlotName {
  const prefix = meal.name.split(' · ')[0]?.trim().toLowerCase();
  const named = SLOT_NAMES.find((s) => s.toLowerCase() === prefix);
  return named ?? slotForTime(meal.usualTime ?? '12:00');
}

/** "Now" plus the four slots, using plan meals' usual times where the user has them. */
export function slotOptions(planMeals: readonly SavedMeal[], now: LocalTime): MealSlot[] {
  const times = { ...DEFAULT_SLOT_TIMES };
  for (const m of [...planMeals].sort((a, b) =>
    (b.usualTime ?? '').localeCompare(a.usualTime ?? ''),
  )) {
    if (m.inDailyPlan && m.usualTime) times[slotOfPlanMeal(m)] = m.usualTime;
  }
  return [{ name: 'Now', time: now }, ...SLOT_NAMES.map((name) => ({ name, time: times[name] }))];
}

/**
 * Default: the first plan meal not yet logged today (e.g. "Snack · 16:00") that can be logged
 * now — no more than an hour ahead (`latest`, from core `latestTimeOn`) — else "Now".
 */
export function defaultSlot(
  planMeals: readonly SavedMeal[],
  loggedPlanIds: ReadonlySet<string>,
  now: LocalTime,
  latest: LocalTime = '23:59',
): MealSlot {
  const next = planMeals
    .filter(
      (m) => m.inDailyPlan && m.usualTime && !loggedPlanIds.has(m.id) && m.usualTime <= latest,
    )
    .sort((a, b) => (a.usualTime ?? '').localeCompare(b.usualTime ?? ''))[0];
  return next ? { name: slotOfPlanMeal(next), time: next.usualTime! } : { name: 'Now', time: now };
}

/** "Today" / "Yesterday" for a date in the log window, else "Sun 8 Nov". */
export function dayWord(date: LocalDate, today: LocalDate): string {
  if (date === today) return 'Today';
  if (date === addDays(today, -1)) return 'Yesterday';
  return formatDateUK(date);
}

/** "Snack · 16:00", "Now · 13:40", or for a picked time "Today · 06:40" (7a-T, 7b-T). */
export const slotLabel = (s: MealSlot, today?: LocalDate): string =>
  s.name === 'Custom'
    ? `${dayWord(s.date ?? today ?? '', today ?? s.date ?? '')} · ${s.time}`
    : `${s.name} · ${s.time}`;

/** 7a-T's "When" chips: "Now · 13:40", "Breakfast 08:00". */
export const chipLabel = (s: MealSlot): string =>
  s.name === 'Now' ? `Now · ${s.time}` : `${s.name} ${s.time}`;

/** Whether a meal logged in this slot right now would be inside the window (core `isInLogWindow`). */
export const slotInWindow = (slot: MealSlot, today: LocalDate, now: Date): boolean =>
  slot.name === 'Now' || isInLogWindow(loggedAtFor(slot, today, now), now);

/** Two slots are the same choice (a picked time also has to match its day and time). */
export const sameSlot = (a: MealSlot, b: MealSlot): boolean =>
  a.name === b.name && (a.name !== 'Custom' || (a.date === b.date && a.time === b.time));

/** The Europe/London day a meal logged in this slot counts towards. */
export const slotDate = (slot: MealSlot, today: LocalDate): LocalDate => slot.date ?? today;

/** When a meal logged in this slot happened. "Now" means the moment of logging. */
export function loggedAtFor(slot: MealSlot, date: LocalDate, now: Date): Instant {
  return slot.name === 'Now'
    ? now.toISOString()
    : londonDateTimeToInstant(slotDate(slot, date), slot.time);
}

/** Name for a meal built from scratch when the user didn't type one. */
export const defaultMealName = (slot: MealSlot): string =>
  slot.name === 'Now' || slot.name === 'Custom' ? slotForTime(slot.time) : slot.name;

export const isValidTime = (t: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(t.trim());

// ---------------------------------------------------------------------------
// The WHEN choices, shared by 7a's chips and 7b-W's sheet: one list, one rule for which are greyed,
// one rule for which is selected.
// ---------------------------------------------------------------------------

/** One of Now and the four slots, as 7a's WHEN chips and 7b-W's rows show it. */
export interface WhenChoice {
  slot: MealSlot;
  /** 7a's chip text: "Now · 13:40", "Lunch 12:30". */
  label: string;
  /** VoiceOver: the label, plus ", more than an hour from now" when greyed. */
  a11yLabel: string;
  /** More than an hour ahead: greyed and can't be chosen (core `isInLogWindow`). */
  disabled: boolean;
  selected: boolean;
}

/** Now and the four slots, in that order, with plan meals' usual times. */
export function whenChoices(
  planMeals: readonly SavedMeal[],
  current: MealSlot,
  today: LocalDate,
  now: Date,
): WhenChoice[] {
  return slotOptions(planMeals, toLondonTime(now)).map((slot) => {
    const ok = slotInWindow(slot, today, now);
    const label = chipLabel(slot);
    return {
      slot,
      label,
      a11yLabel: ok ? label : `${label}, more than an hour from now`,
      disabled: !ok,
      selected: sameSlot(slot, current),
    };
  });
}

/**
 * The time eaten as an outlined chip with ▾: 7b-T2's header, and 7a's "Other time…" chip once a
 * time has been picked. "Now · 13:40 ▾", "Lunch · 12:30 ▾", "Yesterday · 21:15 ▾".
 */
export const timeChip = (
  slot: MealSlot,
  today: LocalDate,
): { label: string; a11yLabel: string } => ({
  label: `${slotLabel(slot, today)} ▾`,
  a11yLabel: `Time eaten: ${slotLabel(slot, today)}. Change`,
});

/** The last choice: "Other time…", or the picked time once there is one. */
export function otherTimeChoice(
  current: MealSlot,
  today: LocalDate,
): { selected: boolean; picked: string | null } {
  const custom = current.name === 'Custom';
  return { selected: custom, picked: custom ? slotLabel(current, today) : null };
}

/** 7b-W's quiet line: the meal is kept; the second sentence only when some slots are greyed. */
export const whenSheetNote = (choices: readonly WhenChoice[]): string =>
  choices.some((c) => c.disabled)
    ? 'Your meal stays as it is. Later slots are more than an hour away.'
    : 'Your meal stays as it is.';

/**
 * Where 7i opens: on Today at now from Now or a slot (core `pickerStart`), on the meal's own day and
 * time for a picked time.
 */
export const pickerFrom = (slot: MealSlot, now: Date): { date: LocalDate; time: LocalTime } =>
  slot.name === 'Custom' && slot.date
    ? { date: slot.date, time: slot.time }
    : pickerStart(now, now);
