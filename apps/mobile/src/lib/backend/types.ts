import type { Food, Instant, LocalTime, MealComponent, MealLog, WaterLog } from '@life-os/core';
import type { BarcodeLookup, RosterMeal, StoredFood, UserFoodInput } from './foods';
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

export type SessionScope = 'FULL' | 'PENDING_DELETION';

export interface AuthUser {
  id: string;
  email: string | null;
  /** PENDING_DELETION sessions can only see S-5h (spec 8.1). */
  scope?: SessionScope;
}

export type AuthListener = (user: AuthUser | null) => void;

export type Provider = 'APPLE' | 'GOOGLE';
export type Intent = 'CREATE' | 'SIGN_IN';

/** A 6-digit code was emailed (0b-4, 0b-5h). */
export interface CodeChallenge {
  challengeId: string;
  codeExpiresAt: string;
  resendAvailableAt: string;
}

export interface SignInResult {
  accountCreated: boolean;
  scope: SessionScope;
}

export interface SecurityInfo {
  method: 'PASSWORD' | Provider;
  email: string;
  isPrivateRelay: boolean;
  passwordChangedAt: string | null;
  deviceCount: number;
}

/** One row of S-4. Never an IP address: platform, label and a rough town only. */
export interface DeviceSession {
  id: string;
  label: string;
  platform: 'ios' | 'android' | 'web';
  coarseLocation: string | null;
  lastActiveAt: string;
  isCurrent: boolean;
}

/**
 * Sign-in v3 (docs/sign-in-spec.md). Every call goes to the auth-api edge function; errors are
 * `AuthError` with the spec's codes (src/lib/auth/errors.ts) and screens show spec copy.
 */
export interface AuthApi {
  currentUser(): Promise<AuthUser | null>;
  /** Subscribe to sign-in / sign-out. Returns an unsubscribe function. */
  onChange(listener: AuthListener): () => void;

  // 0b-3 / 0b-4
  createAccount(email: string, password: string): Promise<CodeChallenge>;
  confirmEmail(challengeId: string, code: string): Promise<SignInResult>;
  resendCode(challengeId: string): Promise<CodeChallenge>;
  // 0b-5 / 0b-5h
  signInWithPassword(email: string, password: string): Promise<SignInResult>;
  stepUp(challengeId: string, code: string): Promise<SignInResult>;
  // 0b-8: runs Apple's or Google's own UI, then auth-api
  signInWithProvider(provider: Provider, intent: Intent): Promise<SignInResult>;
  /** 0b-8h / 0b-8i one-tap. */
  useTicket(ticket: string): Promise<SignInResult>;
  // 0b-7
  requestPasswordReset(email: string): Promise<void>;
  verifyResetLink(token: string): Promise<{ email: string }>;
  completeReset(token: string, newPassword: string): Promise<void>;
  /** k-anonymity range for the live breach tick (only 5 hex characters leave the device). */
  breachRange(prefix: string): Promise<string>;

  signOut(): Promise<void>;

  // Me → Security (row 9)
  security(): Promise<SecurityInfo>;
  listSessions(): Promise<DeviceSession[]>;
  revokeSession(id: string): Promise<void>;
  /** Signs out every device, this one included. */
  revokeAllSessions(): Promise<void>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  reauthWithPassword(password: string): Promise<string>;
  reauthWithProvider(provider: Provider): Promise<string>;
  requestDeletion(reauthToken: string): Promise<{ deletionDueAt: string }>;
  getDeletion(): Promise<{ deletionDueAt: string } | null>;
  cancelDeletion(): Promise<void>;
  /** Downloads (web) or shares (iPhone) a copy of the user's data. */
  exportData(format: 'json' | 'csv'): Promise<void>;
}

/**
 * Everything the app needs from Supabase, behind one interface so screens can be tested with
 * an in-memory fake. The Supabase implementation lives in `./supabase.ts`.
 */
export interface Backend {
  auth: AuthApi;

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
  /**
   * Your own food for this barcode if you have one, else the food-lookup edge function
   * (global Open Food Facts cache, fetched and cached on a miss).
   */
  lookupBarcode(barcode: string): Promise<BarcodeLookup>;
  /** Create your own food, or update your existing one with the same barcode. */
  saveUserFood(input: UserFoodInput): Promise<StoredFood>;
}

/** An error whose message is safe and friendly to show to the user. */
export class UserFacingError extends Error {
  override name = 'UserFacingError';
}

/**
 * The Data API turned the session down (SESSION_REVOKED / SESSION_EXPIRED). The session has
 * already been forgotten on this device and the app is on its way to 0a (spec 3.3: no message).
 */
export class SessionEndedError extends UserFacingError {
  override name = 'SessionEndedError';
  constructor() {
    super('You’re signed out. Sign in again to continue.');
  }
}

/** Sign-in was cancelled by the user (closed the sheet). Not an error worth showing. */
export class CancelledError extends Error {
  override name = 'CancelledError';
}
