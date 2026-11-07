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
import { applyPatch, type SettingsPatch, type UserSettings } from './backend/settings';
import type { AuthUser, Backend } from './backend/types';

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
  /** Re-read profile, settings and consent (e.g. after onboarding steps). */
  refresh(): Promise<void>;
  /** Optimistically update settings, then persist. Reverts and rethrows on failure. */
  updateSettings(patch: SettingsPatch): Promise<void>;
  setDisplayName(name: string | null): Promise<void>;
  setHealthConsent(granted: boolean): Promise<void>;
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
  refresh: noop,
  updateSettings: noop,
  setDisplayName: noop,
  setHealthConsent: noop,
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
  const userRef = useRef<string | null>(null);

  const load = useCallback(
    async (forUser: AuthUser | null) => {
      if (!backend || !forUser) {
        setLoaded(null);
        return;
      }
      setLoadError(null);
      let profile, settings, healthConsent;
      try {
        [profile, settings, healthConsent] = await Promise.all([
          backend.getProfile(),
          backend.getSettings(),
          backend.hasHealthConsent(),
        ]);
      } catch (err) {
        if (userRef.current === forUser.id) {
          setLoadError(err instanceof Error ? err.message : 'Could not load your data.');
        }
        return;
      }
      if (userRef.current === forUser.id) {
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
      if (next?.id === userRef.current) return;
      userRef.current = next?.id ?? null;
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
      },
    };
  }, [backend, ready, user, loaded, loadError, load]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
