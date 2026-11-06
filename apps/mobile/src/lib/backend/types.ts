import type { Food, Instant, LocalTime, MealComponent, MealLog, WaterLog } from '@life-os/core';
import type { RosterMeal, StoredFood } from './foods';
import type { SettingsPatch, UserSettings } from './settings';

export interface TimeRange {
  from: Instant;
  to: Instant;
}

export interface LogMealInput {
  name: string;
  savedMealId: string | null;
  loggedAt: Instant;
  components: readonly MealComponent[];
}

export interface SaveMealInput {
  /** `null` to create a new roster meal. */
  id: string | null;
  name: string;
  inDailyPlan: boolean;
  usualTime: LocalTime | null;
  components: readonly MealComponent[];
}

/** A food the user has logged before, with the amount they had last time. */
export interface RecentFood {
  food: Food;
  grams: number;
  loggedAt: Instant;
}

export interface AuthUser {
  id: string;
  email: string | null;
}

export type AuthListener = (user: AuthUser | null) => void;

/** Result of an email + password sign-up. Production projects usually confirm by email first. */
export interface SignUpResult {
  needsEmailConfirmation: boolean;
}

/**
 * Everything the app needs from Supabase, behind one interface so screens can be tested with
 * an in-memory fake. The Supabase implementation lives in `./supabase.ts`.
 */
export interface Backend {
  auth: {
    currentUser(): Promise<AuthUser | null>;
    /** Subscribe to sign-in / sign-out. Returns an unsubscribe function. */
    onChange(listener: AuthListener): () => void;
    sendMagicLink(email: string): Promise<void>;
    signInWithPassword(email: string, password: string): Promise<void>;
    signUpWithPassword(email: string, password: string): Promise<SignUpResult>;
    signInWithApple(): Promise<void>;
    signInWithGoogle(): Promise<void>;
    /** Finish a magic-link or OAuth redirect (`lifeos://auth/callback?code=…`). */
    completeRedirect(params: Record<string, string | undefined>): Promise<void>;
    signOut(): Promise<void>;
  };

  getProfile(): Promise<{ displayName: string | null }>;
  updateProfile(patch: { displayName: string | null }): Promise<void>;

  getSettings(): Promise<UserSettings>;
  updateSettings(patch: SettingsPatch): Promise<void>;

  /** Whether the user has an active `health_data` consent (UK GDPR Art. 9(2)(a)). */
  hasHealthConsent(): Promise<boolean>;
  /** Grant (insert a consent row) or withdraw (set `withdrawn_at`) health-data consent. */
  setHealthConsent(granted: boolean): Promise<void>;

  // Nutrition and water (health data: every call needs an active consent, enforced by RLS).
  listSavedMeals(): Promise<RosterMeal[]>;
  /** Create or update a roster meal and its components in one transaction (`save_meal`). */
  saveMeal(input: SaveMealInput): Promise<string>;
  deleteSavedMeal(id: string): Promise<void>;
  listMealLogs(range: TimeRange): Promise<MealLog[]>;
  /** Log a meal atomically (`log_meal`): log + snapshotted items + last portions. */
  logMeal(input: LogMealInput): Promise<string>;
  listWaterLogs(range: TimeRange): Promise<WaterLog[]>;
  addWater(ml: number): Promise<void>;
  /** Global cache and the user's own foods whose name matches. */
  searchFoods(query: string): Promise<StoredFood[]>;
  getFoods(ids: readonly string[]): Promise<StoredFood[]>;
  /** Most recently logged foods with the amount last time, newest first. */
  listRecentFoods(limit: number): Promise<RecentFood[]>;
}

/** An error whose message is safe and friendly to show to the user. */
export class UserFacingError extends Error {
  override name = 'UserFacingError';
}

/** Sign-in was cancelled by the user (closed the sheet). Not an error worth showing. */
export class CancelledError extends Error {
  override name = 'CancelledError';
}
