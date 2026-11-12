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
import { AppState, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { addDays, toLondonDate } from '@life-os/core';
import { getHealthReader } from '@/lib/health/current';
import type { HealthReader, RequestStatus } from '@/lib/health/reader';
import { UserFacingError } from '@/lib/backend/types';
import { useSession } from '@/lib/session';
import { cancelSupplementReminders, rescheduleSupplementReminders } from './reminders';

/** How far back each sync reads: 35 London days, today included. */
export const SYNC_DAYS = 35;
const BANNER_KEY = 'lifeos.health.noAccessBannerDismissed';

/**
 * - `connected`: an iPhone that asked HealthKit (we can't know if read was denied, so missing
 *   data shows the no-data states, 3b / 8a).
 * - `off`: an iPhone where we *know* access isn't granted: the user chose "Not now", never
 *   connected, or HealthKit says the request was never made (3c / 8b).
 * - `elsewhere`: web, Android or Expo Go — no HealthKit here; shows what the iPhone synced.
 */
export type AppleHealthAccess = 'connected' | 'off' | 'elsewhere';

export interface AppleHealthValue {
  access: AppleHealthAccess;
  /** The 8b banner was dismissed on this device. */
  bannerDismissed: boolean;
  dismissBanner(): void;
  /** Show iOS's permission sheet (read only), record "connect" and sync. Needs health consent. */
  connect(): Promise<void>;
  /**
   * "Open Settings ↗": iOS lists an app under Settings › Health only after it has asked, so
   * before that this asks (the permission sheet); afterwards it records "connect" and opens
   * Settings, where the user switches the items on.
   */
  openSettings(): Promise<void>;
  syncing: boolean;
  lastSyncedAt: string | null;
  syncError: string | null;
}

const Ctx = createContext<AppleHealthValue>({
  access: 'elsewhere',
  bannerDismissed: false,
  dismissBanner: () => {},
  connect: async () => {},
  openSettings: async () => {},
  syncing: false,
  lastSyncedAt: null,
  syncError: null,
});

export const useAppleHealth = (): AppleHealthValue => useContext(Ctx);

/**
 * Apple Health for the signed-in user: the access state, the permission request, and the sync on
 * app open and on return to the foreground (last 35 London days → health_daily). Nothing is read
 * without the in-app health-data consent (0c), and withdrawing it stops reading and syncing and
 * cancels supplement reminders. Also keeps this device's supplement reminders in step.
 */
export function AppleHealthProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const reader = useMemo<HealthReader | null>(() => getHealthReader(), []);
  const [status, setStatus] = useState<RequestStatus | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const running = useRef(false);

  const signedIn = session.status === 'signedIn' && !session.pendingDeletion;
  const consent = signedIn && session.healthConsent;
  const choice = session.settings?.appleHealthChoice ?? null;
  const backend = session.backend;
  // The session value (and its functions) changes whenever data changes; keep the latest in a
  // ref so a sync's own "data changed" doesn't start another sync.
  const notify = useRef(session.notifyDataChanged);
  useEffect(() => {
    notify.current = session.notifyDataChanged;
  });

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(BANNER_KEY).then(
      (v) => alive && setBannerDismissed(v === '1'),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, []);

  const refreshStatus = useCallback(async () => {
    if (!reader) return;
    try {
      setStatus(await reader.requestStatus());
    } catch {
      setStatus('unknown');
    }
  }, [reader]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const access: AppleHealthAccess = !reader
    ? 'elsewhere'
    : choice === 'connect' && status !== 'never_asked'
      ? 'connected'
      : 'off';
  const canSync = Boolean(reader && backend && consent && access === 'connected' && status);

  const sync = useCallback(async () => {
    if (!reader || !backend || running.current) return;
    running.current = true;
    setSyncing(true);
    setSyncError(null);
    try {
      const today = toLondonDate(new Date());
      const values = await reader.readDays({ start: addDays(today, -(SYNC_DAYS - 1)), end: today });
      await backend.upsertHealthDaily(values);
      setLastSyncedAt(new Date().toISOString());
      notify.current();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Couldn’t sync Apple Health.');
    } finally {
      running.current = false;
      setSyncing(false);
    }
  }, [reader, backend]);

  // On open (and whenever syncing becomes possible), and on return to the foreground.
  useEffect(() => {
    if (!canSync) return;
    void sync();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        void refreshStatus();
        void sync();
      }
    });
    return () => sub.remove();
  }, [canSync, sync, refreshStatus]);

  // Supplement reminders follow the list and the consent.
  const { dataVersion } = session;
  useEffect(() => {
    if (!signedIn) return;
    if (!consent || !backend) {
      void cancelSupplementReminders().catch(() => {});
      return;
    }
    let alive = true;
    backend.listSupplements().then(
      (list) => alive && void rescheduleSupplementReminders(list).catch(() => {}),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [signedIn, consent, backend, dataVersion]);

  const { updateSettings } = session;
  const connect = useCallback(async () => {
    if (!reader) return;
    if (!consent) {
      throw new UserFacingError(
        'Turn on “Use my health data” in Me first. Life OS only reads Apple Health with your consent.',
      );
    }
    await reader.requestAccess();
    await refreshStatus();
    if (choice !== 'connect') await updateSettings({ appleHealthChoice: 'connect' });
  }, [reader, consent, choice, refreshStatus, updateSettings]);

  const value = useMemo<AppleHealthValue>(
    () => ({
      access,
      bannerDismissed,
      dismissBanner: () => {
        setBannerDismissed(true);
        void AsyncStorage.setItem(BANNER_KEY, '1').catch(() => {});
      },
      connect,
      async openSettings() {
        // iOS lists Life OS under Settings › Health only once it has asked: ask first.
        if (reader && status === 'never_asked') return connect();
        // Asked before but "Not now" here: count it as connecting, then Settings to switch on.
        if (reader && choice !== 'connect') await updateSettings({ appleHealthChoice: 'connect' });
        await Linking.openSettings();
      },
      syncing,
      lastSyncedAt,
      syncError,
    }),
    [
      access,
      bannerDismissed,
      connect,
      reader,
      status,
      choice,
      updateSettings,
      syncing,
      lastSyncedAt,
      syncError,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
