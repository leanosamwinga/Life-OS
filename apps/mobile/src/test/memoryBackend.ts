/**
 * In-memory Backend for jest. Mirrors the rules that matter to the UI (e.g. health data
 * requires consent, like RLS) so flows can be tested without Supabase.
 */
import {
  applyPatch,
  defaultUserSettings,
  type SettingsPatch,
  type UserSettings,
} from '@/lib/backend/settings';
import {
  UserFacingError,
  type AuthListener,
  type AuthUser,
  type Backend,
} from '@/lib/backend/types';

export interface MemoryState {
  user: AuthUser | null;
  displayName: string | null;
  settings: UserSettings;
  healthConsent: boolean;
  /** Every consent change, as the audit trail would record it. */
  consentLog: ('granted' | 'withdrawn')[];
  magicLinksSent: string[];
  passwords: Record<string, string>;
  calls: string[];
}

export type MemoryBackend = Backend & {
  state: MemoryState;
  /** Make the next call of `method` reject with this error. */
  failNext(method: string, error: Error): void;
  /** Simulate signing in (e.g. after a magic link). */
  signInAs(user: AuthUser): void;
};

export const TEST_USER: AuthUser = { id: 'user-test-0001', email: 'user-a@example.test' };

export function createMemoryBackend(init: Partial<MemoryState> = {}): MemoryBackend {
  const state: MemoryState = {
    user: null,
    displayName: null,
    settings: defaultUserSettings(),
    healthConsent: false,
    consentLog: [],
    magicLinksSent: [],
    passwords: {},
    calls: [],
    ...init,
  };
  const listeners = new Set<AuthListener>();
  const failures = new Map<string, Error>();

  const emit = () => listeners.forEach((l) => l(state.user));
  const call = async (name: string) => {
    state.calls.push(name);
    const err = failures.get(name);
    if (err) {
      failures.delete(name);
      throw err;
    }
  };
  const requireUser = () => {
    if (!state.user) throw new UserFacingError('Signed out');
  };

  const backend: MemoryBackend = {
    state,
    failNext: (method, error) => failures.set(method, error),
    signInAs(user) {
      state.user = user;
      emit();
    },
    auth: {
      async currentUser() {
        return state.user;
      },
      onChange(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async sendMagicLink(email) {
        await call('sendMagicLink');
        state.magicLinksSent.push(email);
      },
      async signInWithPassword(email, password) {
        await call('signInWithPassword');
        if (state.passwords[email] !== password) {
          throw new UserFacingError(
            'That email and password don’t match. Try again or use a sign-in link.',
          );
        }
        backend.signInAs({ id: TEST_USER.id, email });
      },
      async signUpWithPassword(email, password) {
        await call('signUpWithPassword');
        state.passwords[email] = password;
        backend.signInAs({ id: TEST_USER.id, email });
        return { needsEmailConfirmation: false };
      },
      async signInWithApple() {
        await call('signInWithApple');
        backend.signInAs(TEST_USER);
      },
      async signInWithGoogle() {
        await call('signInWithGoogle');
        backend.signInAs(TEST_USER);
      },
      async completeRedirect(params) {
        await call('completeRedirect');
        if (!params.code)
          throw new UserFacingError('That sign-in link is incomplete. Send a new one.');
        backend.signInAs(TEST_USER);
      },
      async signOut() {
        await call('signOut');
        state.user = null;
        emit();
      },
    },
    async getProfile() {
      await call('getProfile');
      requireUser();
      return { displayName: state.displayName };
    },
    async updateProfile({ displayName }) {
      await call('updateProfile');
      state.displayName = displayName?.trim() || null;
    },
    async getSettings() {
      await call('getSettings');
      requireUser();
      return structuredClone(state.settings);
    },
    async updateSettings(patch: SettingsPatch) {
      await call('updateSettings');
      state.settings = applyPatch(state.settings, patch);
    },
    async hasHealthConsent() {
      return state.healthConsent;
    },
    async setHealthConsent(granted) {
      await call('setHealthConsent');
      if (granted === state.healthConsent) return;
      state.healthConsent = granted;
      state.consentLog.push(granted ? 'granted' : 'withdrawn');
    },
  };
  return backend;
}
