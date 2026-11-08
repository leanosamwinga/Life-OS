import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  applyPatch,
  defaultUserSettings,
  type SettingsPatch,
  type UserSettings,
} from './backend/settings';
import { SessionEndedError, UserFacingError, type AuthUser, type Backend } from './backend/types';

const sessionKey = (u: AuthUser) => `${u.id}:${u.scope ?? 'FULL'}`;

/**
 * "Couldn't load your data" is only for real network or server errors (an ended session goes
 * to 0a instead). Network → check your connection; otherwise the server's friendly message.
 */
export function loadErrorMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : '';
  if (err instanceof TypeError || /network request failed|failed to fetch|load failed/i.test(text))
    return 'Check your connection and try again.';
  if (err instanceof UserFacingError && text) return text;
  return 'Something went wrong on our side. Try again in a moment.';
}

/**
 * - `disconnected`: no Supabase env — the app shows sample data and never asks to sign in.
 * - `loading`: checking for a stored session / loading the signed-in user's settings.
 * - `signedOut` / `signedIn`.
 */
export type SessionStatus = 'disconnected' | 'loading' | 'signedOut' | 'signedIn';

export interface SessionValue {
  status: SessionStatus;
  backend: Backend | null;
  user: AuthUser | null;
  displayName: string | null;
  settings: UserSettings | null;
  healthConsent: boolean;
  /** Set when loading the signed-in user's data failed (e.g. offline). */
  loadError: string | null;
  /** The account is being deleted: only S-5h is available (spec 8.1). */
  pendingDeletion: boolean;
  /** Re-read profile, settings and consent (e.g. after onboarding steps). */
  refresh(): Promise<void>;
  /** Optimistically update settings, then persist. Reverts and rethrows on failure. */
  updateSettings(patch: SettingsPatch): Promise<void>;
  setDisplayName(name: string | null): Promise<void>;
  setHealthConsent(granted: boolean): Promise<void>;
  /** Bumped whenever meals, water or the roster change, so screens reload their data. */
  dataVersion: number;
  notifyDataChanged(): void;
}

const noop = async () => {};

const DISCONNECTED: SessionValue = {
  status: 'disconnected',
  backend: null,
  user: null,
  displayName: null,
  settings: null,
  healthConsent: false,
  loadError: null,
  pendingDeletion: false,
  refresh: noop,
  updateSettings: noop,
  setDisplayName: noop,
  setHealthConsent: noop,
  dataVersion: 0,
  notifyDataChanged: () => {},
};

const SessionContext = createContext<SessionValue>(DISCONNECTED);

export const useSession = (): SessionValue => useContext(SessionContext);

/** The backend for a signed-in screen. Throws if used while disconnected. */
export function useBackend(): Backend {
  const { backend } = useSession();
  if (!backend) throw new Error('useBackend() needs a connected backend');
  return backend;
}

interface Loaded {
  displayName: string | null;
  settings: UserSettings;
  healthConsent: boolean;
}

export function SessionProvider({
  backend,
  children,
}: {
  backend: Backend | null;
  children: ReactNode;
}) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  // '\u0000' = nothing seen yet, so the first "signed out" still counts.
  const userRef = useRef<string | null>('\u0000');

  const load = useCallback(
    async (forUser: AuthUser | null) => {
      if (!backend || !forUser) {
        setLoaded(null);
        return;
      }
      // Only this exact user + scope may write the result: if the session ends or its scope
      // changes while we wait, the newer state wins.
      const key = sessionKey(forUser);
      setLoadError(null);
      if (forUser.scope === 'PENDING_DELETION') {
        // The Data API refuses this session; don't ask it for anything.
        setLoaded({ displayName: null, settings: defaultUserSettings(), healthConsent: false });
        return;
      }
      let profile, settings, healthConsent;
      try {
        [profile, settings, healthConsent] = await Promise.all([
          backend.getProfile(),
          backend.getSettings(),
          backend.hasHealthConsent(),
        ]);
      } catch (err) {
        // An ended session has already been cleared (→ 0a, no message, spec 3.3).
        if (userRef.current === key && !(err instanceof SessionEndedError)) {
          setLoadError(loadErrorMessage(err));
        }
        return;
      }
      if (userRef.current === key) {
        setLoaded({ displayName: profile.displayName, settings, healthConsent });
      }
    },
    [backend],
  );

  useEffect(() => {
    if (!backend) return;
    let alive = true;
    const handle = (next: AuthUser | null) => {
      if (!alive) return;
      const key = next ? sessionKey(next) : null;
      if (key === userRef.current) return;
      userRef.current = key;
      setUser(next);
      setLoaded(null);
      void load(next).finally(() => alive && setReady(true));
    };
    const unsubscribe = backend.auth.onChange(handle);
    backend.auth
      .currentUser()
      .then(handle)
      .catch(() => handle(null));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [backend, load]);

  const value = useMemo<SessionValue>(() => {
    if (!backend) return DISCONNECTED;
    const status: SessionStatus = !ready
      ? 'loading'
      : user
        ? loaded
          ? 'signedIn'
          : 'loading'
        : 'signedOut';
    return {
      status,
      backend,
      user,
      displayName: loaded?.displayName ?? null,
      settings: loaded?.settings ?? null,
      healthConsent: loaded?.healthConsent ?? false,
      loadError,
      pendingDeletion: user?.scope === 'PENDING_DELETION',
      // "Try again" really retries: back to the spinner, then load again.
      refresh: () => load(user),
      async updateSettings(patch) {
        const before = loaded;
        if (before) setLoaded({ ...before, settings: applyPatch(before.settings, patch) });
        try {
          await backend.updateSettings(patch);
        } catch (err) {
          if (before) setLoaded(before);
          throw err;
        }
      },
      async setDisplayName(name) {
        await backend.updateProfile({ displayName: name });
        setLoaded((l) => (l ? { ...l, displayName: name?.trim() || null } : l));
      },
      async setHealthConsent(granted) {
        await backend.setHealthConsent(granted);
        const healthConsent = await backend.hasHealthConsent();
        setLoaded((l) => (l ? { ...l, healthConsent } : l));
        setDataVersion((v) => v + 1);
      },
      dataVersion,
      notifyDataChanged: () => setDataVersion((v) => v + 1),
    };
  }, [backend, ready, user, loaded, loadError, load, dataVersion]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
