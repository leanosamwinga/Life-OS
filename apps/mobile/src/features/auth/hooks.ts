import { useCallback, useEffect, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { breachRangePrefix, checkPassword, rangeContains } from '@life-os/core';
import type { Rule } from '@/components/auth';
import { RULES } from '@/lib/auth/copy';
import type { AuthError } from '@/lib/auth/errors';
import { toAuthError } from '@/lib/auth/errors';
import type { Intent, Provider } from '@/lib/backend/types';
import { useBackend } from '@/lib/session';

/**
 * Live rule ticks for a new password (0b-3b, 0b-7g, S-2b). The breach tick is a k-anonymity
 * lookup with a 300 ms debounce: only 5 hex characters of the SHA-1 leave the device. It fails
 * open (stays unticked, never blocks); the server's check on submit is the one that counts.
 */
export function usePasswordRules(
  password: string,
  email: string,
): { rules: Rule[]; lengthOk: boolean } {
  const backend = useBackend();
  const [breached, setBreached] = useState<boolean | null>(null);
  const check = checkPassword(password, email);
  useEffect(() => {
    setBreached(null);
    if (!password || !check.lengthOk) return;
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const { prefix, suffix } = breachRangePrefix(password);
        const body = await backend.auth.breachRange(prefix);
        if (alive) setBreached(rangeContains(body, suffix));
      } catch {
        if (alive) setBreached(null);
      }
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [password, check.lengthOk, backend]);
  const typed = password.length > 0;
  return {
    lengthOk: check.lengthOk,
    rules: [
      { label: RULES.length, ok: typed ? check.lengthOk : null },
      { label: RULES.breach, ok: breached === null ? null : !breached },
      { label: RULES.email, ok: typed && email ? !check.containsEmail : null },
    ],
  };
}

/** Clears password state when the screen loses focus (spec 5.2: never carried between screens). */
export function useClearOnBlur(...setters: ((v: string) => void)[]) {
  useFocusEffect(
    useCallback(
      () => () => {
        for (const set of setters) set('');
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    ),
  );
}

// ---------------------------------------------------------------------------------------------
// Where to land straight after a sign-in. The root layout's guard reads this when the user
// changes, so a new email account sees 0b-4g ("You're in") before onboarding.

let afterSignIn: string | null = null;
export const postSignIn = {
  set(route: string | null) {
    afterSignIn = route;
  },
  take(): string | null {
    const r = afterSignIn;
    return r;
  },
  clear() {
    afterSignIn = null;
  },
};

/**
 * Continue with Apple / Google from any method screen (0b-1, 0b-2, 0b-6, 0b-8). Shows 0b-8f
 * while waiting; a cancel returns quietly; every outcome is a screen, never an automatic jump
 * to another method (branch messages only after a tap).
 */
export function useProviderFlow(intent: Intent) {
  const backend = useBackend();
  const [busy, setBusy] = useState<Provider | null>(null);
  const [alert, setAlert] = useState<AuthError | null>(null);
  const run = useCallback(
    async (provider: Provider) => {
      setAlert(null);
      setBusy(provider);
      try {
        await backend.auth.signInWithProvider(provider, intent);
        // Signed in: the root guard moves on (0c for a new account, Today otherwise).
      } catch (raw) {
        if ((raw as Error)?.name === 'ProviderCancelled') return; // back, no message
        const e = toAuthError(raw);
        const d = e.details;
        const p = provider;
        switch (e.code) {
          case 'ACCOUNT_EXISTS':
            router.push({
              pathname: '/sign-up/exists',
              params: { ticket: d.ticket ?? '', email: d.email ?? '', provider: p },
            });
            break;
          case 'ACCOUNT_NOT_FOUND':
            router.push({
              pathname: '/sign-in/not-found',
              params: { ticket: d.ticket ?? '', email: d.email ?? '', provider: p },
            });
            break;
          case 'WRONG_METHOD':
            router.push({
              pathname: '/sign-in/use-method',
              params: { method: d.method ?? 'PASSWORD', tapped: p, email: d.email ?? '' },
            });
            break;
          case 'TOKEN_INVALID':
          case 'PROVIDER_ERROR':
          case 'TICKET_EXPIRED':
          case 'NETWORK':
          case 'PROVIDER_ACCOUNT_MISMATCH':
            router.push({
              pathname: '/sign-in/failed',
              params: {
                provider: p,
                intent,
                mismatch: e.code === 'PROVIDER_ACCOUNT_MISMATCH' ? '1' : '',
              },
            });
            break;
          default:
            setAlert(e);
        }
      } finally {
        setBusy(null);
      }
    },
    [backend, intent],
  );
  return { busy, alert, run };
}
