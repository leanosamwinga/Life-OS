import type { SettingsPatch, UserSettings } from './settings';

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
}

/** An error whose message is safe and friendly to show to the user. */
export class UserFacingError extends Error {
  override name = 'UserFacingError';
}

/** Sign-in was cancelled by the user (closed the sheet). Not an error worth showing. */
export class CancelledError extends Error {
  override name = 'CancelledError';
}
