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
import { AppState } from 'react-native';
import type { MealLog } from '@life-os/core';
import { useSession } from '@/lib/session';

/** How long "Meal deleted · Undo" stays before the delete really happens. */
export const UNDO_MS = 5000;

interface PendingDeleteValue {
  /** The meal waiting to be deleted (hidden on Today), if any. */
  pending: MealLog | null;
  /** Set when the delete failed after the note went: the meal is back. */
  error: string | null;
  /** 7l "Delete meal": hide it now and delete it when the note times out. */
  schedule(log: MealLog): void;
  /** "Undo": nothing is deleted and the meal is back. */
  undo(): void;
  /** Dismissing the note (or the app going to the background) deletes it now. */
  commit(): void;
  clearError(): void;
}

const Ctx = createContext<PendingDeleteValue | null>(null);

export function usePendingDelete(): PendingDeleteValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePendingDelete() must be used inside PendingDeleteProvider');
  return v;
}

/**
 * Undo after deleting a meal, without restoring rows: the meal is hidden straight away and
 * `delete_logged_meal` is only called when the note times out or is dismissed, or the app goes to
 * the background. Undo cancels it. If the delete then fails, the meal comes back with an error.
 * A plan meal shows as not eaten while its log is hidden.
 */
export function PendingDeleteProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const backend = session.backend;
  const notify = session.notifyDataChanged;
  const [pending, setPending] = useState<MealLog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef<MealLog | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const commit = useCallback(() => {
    const log = pendingRef.current;
    stopTimer();
    if (!log) return;
    pendingRef.current = null;
    if (!backend) {
      setPending(null);
      return;
    }
    backend.deleteMealLog(log.id).then(
      () => {
        // Keep it hidden until the reload has caught up, then let go.
        setPending((p) => (p?.id === log.id ? null : p));
        notify();
      },
      (err: unknown) => {
        setPending((p) => (p?.id === log.id ? null : p));
        const why = err instanceof Error ? err.message : 'Something went wrong.';
        setError(`Couldn’t delete “${log.name}”, so it’s back. ${why}`);
        notify();
      },
    );
  }, [backend, notify]);

  const schedule = useCallback(
    (log: MealLog) => {
      // One note at a time: an earlier delete happens now.
      if (pendingRef.current) commit();
      setError(null);
      pendingRef.current = log;
      setPending(log);
      timer.current = setTimeout(commit, UNDO_MS);
    },
    [commit],
  );

  const undo = useCallback(() => {
    stopTimer();
    pendingRef.current = null;
    setPending(null);
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') commit();
    });
    return () => sub.remove();
  }, [commit]);
  useEffect(() => () => stopTimer(), []);

  const value = useMemo(
    () => ({ pending, error, schedule, undo, commit, clearError: () => setError(null) }),
    [pending, error, schedule, undo, commit],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
