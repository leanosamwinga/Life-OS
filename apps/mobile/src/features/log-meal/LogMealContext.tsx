import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  addDays,
  dayProgress,
  foodUnit,
  formatDateUK,
  guessCooksAs,
  latestTimeOn,
  londonDateTimeToInstant,
  sumMacros,
  toLondonDate,
  toLondonTime,
  type AmountUnit,
  type BatchIngredient,
  type CooksAs,
  type DayProgress,
  type Food,
  type LocalTime,
  type Macros,
  type MealComponent,
  type MealLog,
} from '@life-os/core';
import { useAsync } from '@/features/data/useAsync';
import type { RosterMeal, SavedBatch, StoredFood } from '@/lib/backend/foods';
import { targetsForProgress } from '@/lib/backend/settings';
import type { RecentFood } from '@/lib/backend/types';
import { useSession } from '@/lib/session';
import { confirmDiscard } from './confirm';
import { keptDraft, type KeptDraft } from './draft';
import { defaultSlot, slotDate, type MealSlot } from './slots';

export interface DraftComponent extends MealComponent {
  key: string;
  /** Batches only: how this ingredient changes weight in the pot (7f). */
  cooksAs?: CooksAs;
  /** Cook again (7g): what this ingredient was last time. Absent for a new ingredient. */
  origin?: { grams: number; cooksAs: CooksAs };
}

export interface MealDraft {
  /** `meal`: 7b. `batch`: the batch builder (7f) or cook again (7g). */
  kind: 'meal' | 'batch';
  /** `log`: build a meal to log now. `edit`: change a roster meal. */
  mode: 'log' | 'edit';
  savedMealId: string | null;
  name: string;
  components: DraftComponent[];
  saveToRoster: boolean;
  /** 7b-R: "Save to roster only" chosen — saved through save_meal, nothing logged. */
  saveOnly: boolean;
  inDailyPlan: boolean;
  usualTime: LocalTime | '';
  /** Cook again: the batch being cooked again and last time's ingredients and weight. */
  batch: SavedBatch | null;
  /** "I weighed it", as typed. Empty uses the estimate. */
  weighed: string;
  /**
   * 7j "Log a corrected copy": the logged meal this replaces. Done logs the draft and deletes it
   * in one step (`replace_logged_meal`), keeping its plan link.
   */
  replaces: string | null;
  /** Items of the meal being logged again whose food has been deleted: shown so they can be removed. */
  unavailable: { key: string; name: string; grams: number; unit: AmountUnit }[];
}

export type LogMealTab = 'plan' | 'saved';

/** Where the draft is being built: 7b for meals, 7f/7g for batches. */
export const builderPath = (d: Pick<MealDraft, 'kind'>) =>
  d.kind === 'batch' ? ('/log-meal/batch' as const) : ('/log-meal/build' as const);

/** A food on its way into the meal, shown on the "how much" screen (7d). */
export interface PendingFood {
  food: Food;
  /** Pre-filled grams: the amount last time, or the component's current amount. */
  grams: number | null;
  /** Set when changing an existing component's amount. */
  componentKey?: string;
  /** Where the food came from: a scan shows "‹ Scan again" and "Add and scan another". */
  from?: 'scan' | 'search' | 'suggestion' | 'component' | 'manual' | 'batch';
  /** Batch ingredients: the ratio chosen so far (7f). */
  cooksAs?: CooksAs;
  /** The amount's unit when changing an existing component (else the food's own). */
  unit?: AmountUnit;
}

/** What the manual entry screen (7e) starts from. */
export interface ManualPrefill {
  barcode: string | null;
  /** A scanned product with missing values, or a food whose values the user wants to fix. */
  record: StoredFood | null;
  reason: 'new' | 'not_found' | 'incomplete' | 'edit';
}

const RECENT_DAYS = 14;

interface LogMealData {
  /** Meal logs from the last 14 days (for "eaten recently") including today. */
  logs: MealLog[];
  roster: RosterMeal[];
  batches: SavedBatch[];
  recentFoods: RecentFood[];
}

export interface LogMealValue {
  today: string;
  now: Date;
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  data: LogMealData;
  /** Today's totals before this meal. */
  progress: DayProgress;
  /**
   * The day the meal is being logged for (yesterday after a picked time) and its totals before
   * this meal; `word` is "Today" or e.g. "Sun 8 Nov" for the "… after this meal" bars.
   */
  mealDay: { date: string; word: string; progress: DayProgress };
  slot: MealSlot;
  setSlot(slot: MealSlot): void;
  /** 7a's tabs: "Plan & recent" or "Saved". */
  tab: LogMealTab;
  setTab(tab: LogMealTab): void;

  draft: MealDraft;
  draftTotals: Macros;
  /**
   * 7a-C: the meal being built, kept when going back to 7a (memory only, never across restarts).
   * Null for an empty draft, a batch, a roster edit or a corrected copy.
   */
  kept: KeptDraft | null;
  /** Throw the draft away (after logging is done by closing Log meal; "Save to roster only"). */
  clearDraft(): void;
  /**
   * Before anything starts a new draft or logs something else: with a kept meal, ask "Discard …?".
   * Resolves true to go ahead (the kept meal is then discarded), false for "Keep it".
   */
  confirmNewDraft(): Promise<boolean>;
  startDraft(
    d?: Partial<Omit<MealDraft, 'components' | 'unavailable'>> & {
      components?: readonly (MealComponent & Partial<Pick<DraftComponent, 'cooksAs' | 'origin'>>)[];
      unavailable?: readonly Omit<MealDraft['unavailable'][number], 'key'>[];
    },
  ): void;
  /** Take a no-longer-available item out of the draft. */
  removeUnavailable(key: string): void;
  /** 7g: last time's ingredients pre-filled; the weighed field starts empty (a new pot). */
  startCookAgain(batch: SavedBatch): void;
  updateDraft(patch: Partial<Omit<MealDraft, 'components'>>): void;
  addComponent(food: Food, grams: number, cooksAs?: CooksAs, unit?: AmountUnit): void;
  updateComponent(key: string, grams: number, cooksAs?: CooksAs, unit?: AmountUnit): void;
  removeComponent(key: string): void;

  pending: PendingFood | null;
  setPending(p: PendingFood | null): void;
  manual: ManualPrefill | null;
  setManual(m: ManualPrefill | null): void;
  /** The amount the user had last time for a food, if any. */
  lastGrams(foodId: string): number | null;
  /** The amount last time and the unit it was logged in ("Last time · 330 ml"). */
  lastPortion(foodId: string): { grams: number; unit: AmountUnit } | null;
}

const EMPTY_DATA: LogMealData = { logs: [], roster: [], batches: [], recentFoods: [] };

const blankDraft = (): MealDraft => ({
  kind: 'meal',
  mode: 'log',
  savedMealId: null,
  name: '',
  components: [],
  saveToRoster: false,
  saveOnly: false,
  inDailyPlan: false,
  usualTime: '',
  batch: null,
  weighed: '',
  replaces: null,
  unavailable: [],
});

/** The ingredients of a batch draft, with a ratio for each (guessed from the name if unset). */
export const draftIngredients = (d: MealDraft): BatchIngredient[] =>
  d.components.map((c) => ({
    food: c.food,
    grams: c.grams,
    cooksAs: c.cooksAs ?? guessCooksAs(c.food.name),
  }));

const Ctx = createContext<LogMealValue | null>(null);

export function useLogMeal(): LogMealValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLogMeal() must be used inside the log-meal layout');
  return v;
}

export function LogMealProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const [now] = useState(() => new Date());
  const today = toLondonDate(now);
  const backend = session.backend;
  const enabled = session.status === 'signedIn' && session.healthConsent && backend;

  const state = useAsync<LogMealData>(
    enabled
      ? async () => {
          const [logs, roster, batches, recentFoods] = await Promise.all([
            backend.listMealLogs({
              from: londonDateTimeToInstant(addDays(today, -RECENT_DAYS), '00:00'),
              to: londonDateTimeToInstant(addDays(today, 1), '00:00'),
            }),
            backend.listSavedMeals(),
            backend.listBatches(),
            backend.listRecentFoods(20),
          ]);
          return { logs, roster, batches, recentFoods };
        }
      : null,
    [enabled, backend, today, session.dataVersion],
  );
  const data = state.data ?? EMPTY_DATA;

  const targets = targetsForProgress(
    session.settings?.targets ?? {
      kcal: null,
      protein: null,
      carbs: null,
      fat: null,
      waterMl: null,
      steps: null,
    },
  );
  const progress = dayProgress({ meals: data.logs }, targets, today);

  const [chosenSlot, setSlot] = useState<MealSlot | null>(null);
  const [tab, setTab] = useState<LogMealTab>('plan');
  const loggedPlanIds = new Set(
    progress.meals.map((m) => m.savedMealId).filter(Boolean) as string[],
  );
  // A plan slot more than an hour ahead can't be logged yet (core latestTimeOn), so it isn't the default.
  const slot =
    chosenSlot ??
    defaultSlot(data.roster, loggedPlanIds, toLondonTime(now), latestTimeOn(today, now) ?? '23:59');

  const [draft, setDraft] = useState<MealDraft>(blankDraft);
  const [pending, setPending] = useState<PendingFood | null>(null);
  const [manual, setManual] = useState<ManualPrefill | null>(null);
  const seq = useRef(0);
  const key = () => `c${++seq.current}`;

  const kept = keptDraft(draft, slot);

  const value: LogMealValue = {
    today,
    now,
    status: enabled ? state.status : 'ready',
    error: state.error,
    data,
    progress,
    slot,
    setSlot,
    mealDay: (() => {
      const date = slotDate(slot, today);
      return date === today
        ? { date, word: 'Today', progress }
        : {
            date,
            word: formatDateUK(date),
            progress: dayProgress({ meals: data.logs }, targets, date),
          };
    })(),
    tab,
    setTab,
    draft,
    draftTotals: useMemo(() => sumMacros(draft.components), [draft.components]),
    kept,
    clearDraft: () => setDraft(blankDraft()),
    confirmNewDraft: async () => {
      if (!kept) return true;
      if (!(await confirmDiscard(kept))) return false;
      setDraft(blankDraft());
      return true;
    },
    startDraft: (d = {}) =>
      setDraft({
        ...blankDraft(),
        ...d,
        components: (d.components ?? []).map((c) => ({ ...c, key: key() })),
        unavailable: (d.unavailable ?? []).map((u) => ({ ...u, key: key() })),
      }),
    removeUnavailable: (k) =>
      setDraft((d) => ({ ...d, unavailable: d.unavailable.filter((u) => u.key !== k) })),
    startCookAgain: (batch) =>
      setDraft({
        ...blankDraft(),
        kind: 'batch',
        name: batch.food.name,
        batch,
        components: batch.ingredients.map((i) => ({
          key: key(),
          food: i.food,
          grams: i.grams,
          cooksAs: i.cooksAs,
          origin: { grams: i.grams, cooksAs: i.cooksAs },
        })),
      }),
    updateDraft: (patch) => setDraft((d) => ({ ...d, ...patch })),
    addComponent: (food, grams, cooksAs, unit) =>
      setDraft((d) => ({
        ...d,
        components: [
          ...d.components,
          d.kind === 'batch'
            ? { key: key(), food, grams, cooksAs: cooksAs ?? guessCooksAs(food.name) }
            : { key: key(), food, grams, unit: unit ?? foodUnit(food) },
        ],
      })),
    updateComponent: (k, grams, cooksAs, unit) =>
      setDraft((d) => ({
        ...d,
        components: d.components.map((c) =>
          c.key === k
            ? { ...c, grams, ...(cooksAs ? { cooksAs } : {}), ...(unit ? { unit } : {}) }
            : c,
        ),
      })),
    removeComponent: (k) =>
      setDraft((d) => ({ ...d, components: d.components.filter((c) => c.key !== k) })),
    pending,
    setPending,
    manual,
    setManual,
    lastGrams: (foodId) => data.recentFoods.find((r) => r.food.id === foodId)?.grams ?? null,
    lastPortion: (foodId) => {
      const r = data.recentFoods.find((x) => x.food.id === foodId);
      return r ? { grams: r.grams, unit: r.unit } : null;
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
