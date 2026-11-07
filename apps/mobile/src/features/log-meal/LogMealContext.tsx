import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  addDays,
  dayProgress,
  londonDateTimeToInstant,
  sumMacros,
  toLondonDate,
  toLondonTime,
  type DayProgress,
  type Food,
  type LocalTime,
  type Macros,
  type MealComponent,
  type MealLog,
} from '@life-os/core';
import { useAsync } from '@/features/data/useAsync';
import type { RosterMeal, StoredFood } from '@/lib/backend/foods';
import { targetsForProgress } from '@/lib/backend/settings';
import type { RecentFood } from '@/lib/backend/types';
import { useSession } from '@/lib/session';
import { defaultSlot, type MealSlot } from './slots';

export interface DraftComponent extends MealComponent {
  key: string;
}

export interface MealDraft {
  /** `log`: build a meal to log now. `edit`: change a roster meal. */
  mode: 'log' | 'edit';
  savedMealId: string | null;
  name: string;
  components: DraftComponent[];
  saveToRoster: boolean;
  inDailyPlan: boolean;
  usualTime: LocalTime | '';
}

/** A food on its way into the meal, shown on the "how much" screen (7d). */
export interface PendingFood {
  food: Food;
  /** Pre-filled grams: the amount last time, or the component's current amount. */
  grams: number | null;
  /** Set when changing an existing component's amount. */
  componentKey?: string;
  /** Where the food came from: a scan shows "‹ Scan again" and "Add and scan another". */
  from?: 'scan' | 'search' | 'suggestion' | 'component' | 'manual';
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
  slot: MealSlot;
  setSlot(slot: MealSlot): void;

  draft: MealDraft;
  draftTotals: Macros;
  startDraft(
    d?: Partial<Omit<MealDraft, 'components'>> & { components?: readonly MealComponent[] },
  ): void;
  updateDraft(patch: Partial<Omit<MealDraft, 'components'>>): void;
  addComponent(food: Food, grams: number): void;
  updateComponent(key: string, grams: number): void;
  removeComponent(key: string): void;

  pending: PendingFood | null;
  setPending(p: PendingFood | null): void;
  manual: ManualPrefill | null;
  setManual(m: ManualPrefill | null): void;
  /** The amount the user had last time for a food, if any. */
  lastGrams(foodId: string): number | null;
}

const EMPTY_DATA: LogMealData = { logs: [], roster: [], recentFoods: [] };

const blankDraft = (): MealDraft => ({
  mode: 'log',
  savedMealId: null,
  name: '',
  components: [],
  saveToRoster: false,
  inDailyPlan: false,
  usualTime: '',
});

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
          const [logs, roster, recentFoods] = await Promise.all([
            backend.listMealLogs({
              from: londonDateTimeToInstant(addDays(today, -RECENT_DAYS), '00:00'),
              to: londonDateTimeToInstant(addDays(today, 1), '00:00'),
            }),
            backend.listSavedMeals(),
            backend.listRecentFoods(20),
          ]);
          return { logs, roster, recentFoods };
        }
      : null,
    [enabled, backend, today, session.dataVersion],
  );
  const data = state.data ?? EMPTY_DATA;

  const progress = dayProgress(
    { meals: data.logs },
    targetsForProgress(
      session.settings?.targets ?? {
        kcal: null,
        protein: null,
        carbs: null,
        fat: null,
        waterMl: null,
        steps: null,
      },
    ),
    today,
  );

  const [chosenSlot, setSlot] = useState<MealSlot | null>(null);
  const loggedPlanIds = new Set(
    progress.meals.map((m) => m.savedMealId).filter(Boolean) as string[],
  );
  const slot = chosenSlot ?? defaultSlot(data.roster, loggedPlanIds, toLondonTime(now));

  const [draft, setDraft] = useState<MealDraft>(blankDraft);
  const [pending, setPending] = useState<PendingFood | null>(null);
  const [manual, setManual] = useState<ManualPrefill | null>(null);
  const seq = useRef(0);
  const key = () => `c${++seq.current}`;

  const value: LogMealValue = {
    today,
    now,
    status: enabled ? state.status : 'ready',
    error: state.error,
    data,
    progress,
    slot,
    setSlot,
    draft,
    draftTotals: useMemo(() => sumMacros(draft.components), [draft.components]),
    startDraft: (d = {}) =>
      setDraft({
        ...blankDraft(),
        ...d,
        components: (d.components ?? []).map((c) => ({ ...c, key: key() })),
      }),
    updateDraft: (patch) => setDraft((d) => ({ ...d, ...patch })),
    addComponent: (food, grams) =>
      setDraft((d) => ({ ...d, components: [...d.components, { key: key(), food, grams }] })),
    updateComponent: (k, grams) =>
      setDraft((d) => ({
        ...d,
        components: d.components.map((c) => (c.key === k ? { ...c, grams } : c)),
      })),
    removeComponent: (k) =>
      setDraft((d) => ({ ...d, components: d.components.filter((c) => c.key !== k) })),
    pending,
    setPending,
    manual,
    setManual,
    lastGrams: (foodId) => data.recentFoods.find((r) => r.food.id === foodId)?.grams ?? null,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
