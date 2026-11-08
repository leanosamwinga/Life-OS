/**
 * In-memory AuthApi for jest: the same rules and error codes as auth-api (spec 2–3), so every
 * screen state can be reached without a server. Codes are always MEMORY_EMAIL_CODE.
 */
import {
  breachRangePrefix,
  checkPassword,
  isPrivateRelayEmail,
  isValidEmail,
  normaliseEmail,
  type SignInMethod,
} from '@life-os/core';
import { AuthError } from '@/lib/auth/errors';
import type {
  AuthApi,
  AuthListener,
  AuthUser,
  CodeChallenge,
  DeviceSession,
  Intent,
  Provider,
  SecurityInfo,
  SignInResult,
} from '@/lib/backend/types';

export const MEMORY_EMAIL_CODE = '123456';
/** A password the fake treats as breached (like the server's fixture). */
export const BREACHED_PASSWORD = 'correct horse battery staple';
export const TEST_PASSWORD = 'a long and unbreached test passphrase';

export interface MemoryAccount {
  id: string;
  email: string;
  method: SignInMethod;
  password?: string;
  confirmed: boolean;
  privateRelay?: boolean;
  stepUp?: boolean;
  pendingDeletionUntil?: string | null;
  passwordChangedAt?: string | null;
}

export interface MemoryAuthState {
  user: AuthUser | null;
  accounts: MemoryAccount[];
  /** What Apple/Google "returns" next: email (verified) and sub; null = the person cancels. */
  provider: { email: string; sub: string } | null;
  challenges: Record<
    string,
    { accountId: string; purpose: 'CONFIRM_EMAIL' | 'NEW_DEVICE'; attempts: number; dead: boolean }
  >;
  tickets: Record<
    string,
    { kind: 'SIGN_IN_EXISTING' | 'CREATE_FEDERATED'; provider: Provider; email: string }
  >;
  resetTokens: Record<string, string>;
  /** Reset emails "sent", by email. */
  resetsSent: string[];
  sessions: DeviceSession[];
  calls: string[];
  /** Consecutive wrong passwords; the 5th returns SIGN_IN_PAUSED. */
  wrong: number;
  exports: string[];
}

export type MemoryAuth = AuthApi & {
  auth: MemoryAuthState;
  /** Make the next call of `method` reject with this error. */
  failNext(method: string, error: Error): void;
  signInAs(user: AuthUser | null): void;
};

export function createMemoryAuth(init: Partial<MemoryAuthState> = {}): MemoryAuth {
  const st: MemoryAuthState = {
    user: null,
    accounts: [],
    provider: null,
    challenges: {},
    tickets: {},
    resetTokens: {},
    resetsSent: [],
    sessions: [],
    calls: [],
    wrong: 0,
    exports: [],
    ...init,
  };
  let seq = 0;
  const id = (p: string) => `${p}-${++seq}`;
  const listeners = new Set<AuthListener>();
  const failures = new Map<string, Error>();
  const emit = () => listeners.forEach((l) => l(st.user));

  const call = async (name: string) => {
    st.calls.push(name);
    const e = failures.get(name);
    if (e) {
      failures.delete(name);
      throw e;
    }
  };
  const find = (email: string) =>
    st.accounts.find((a) => normaliseEmail(a.email) === normaliseEmail(email));
  const challenge = (accountId: string, purpose: 'CONFIRM_EMAIL' | 'NEW_DEVICE'): CodeChallenge => {
    for (const c of Object.values(st.challenges)) if (c.accountId === accountId) c.dead = true;
    const cid = id('challenge');
    st.challenges[cid] = { accountId, purpose, attempts: 0, dead: false };
    const now = Date.now();
    return {
      challengeId: cid,
      codeExpiresAt: new Date(now + 600_000).toISOString(),
      resendAvailableAt: new Date(now + 30_000).toISOString(),
    };
  };
  const signIn = (a: MemoryAccount, created = false): SignInResult => {
    const scope = a.pendingDeletionUntil ? 'PENDING_DELETION' : 'FULL';
    st.user = { id: a.id, email: a.email, scope };
    st.sessions = [
      {
        id: id('session'),
        label: 'iPhone',
        platform: 'ios',
        coarseLocation: null,
        lastActiveAt: new Date().toISOString(),
        isCurrent: true,
      },
      ...st.sessions.map((s) => ({ ...s, isCurrent: false })),
    ];
    emit();
    return { accountCreated: created, scope };
  };
  const validate = (password: string, email: string) => {
    const c = checkPassword(password, email);
    if (c.error) throw new AuthError(c.error);
    if (password.normalize('NFKC') === BREACHED_PASSWORD) throw new AuthError('PASSWORD_BREACHED');
  };
  const me = () => {
    const a = st.accounts.find((x) => x.id === st.user?.id);
    if (!a) throw new AuthError('SESSION_REVOKED');
    return a;
  };
  const code = (challengeId: string, value: string, purpose: 'CONFIRM_EMAIL' | 'NEW_DEVICE') => {
    const c = st.challenges[challengeId];
    if (!c || c.purpose !== purpose) throw new AuthError('CHALLENGE_NOT_FOUND');
    if (c.dead) throw new AuthError('CODE_EXPIRED');
    if (c.attempts >= 5) throw new AuthError('CODE_ATTEMPTS_EXCEEDED');
    if (value !== MEMORY_EMAIL_CODE) {
      c.attempts++;
      throw new AuthError(c.attempts >= 5 ? 'CODE_ATTEMPTS_EXCEEDED' : 'CODE_INCORRECT');
    }
    c.dead = true;
    return st.accounts.find((a) => a.id === c.accountId)!;
  };

  const api: MemoryAuth = {
    auth: st,
    failNext: (m, e) => failures.set(m, e),
    signInAs(user) {
      st.user = user;
      emit();
    },
    async currentUser() {
      return st.user;
    },
    onChange(l) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    async createAccount(email, password) {
      await call('createAccount');
      if (!isValidEmail(email)) throw new AuthError('EMAIL_INVALID');
      validate(password, email);
      const existing = find(email);
      if (existing && existing.confirmed) {
        if (existing.method === 'PASSWORD') throw new AuthError('ACCOUNT_EXISTS');
        throw new AuthError('WRONG_METHOD', {
          method: existing.method,
          is_private_relay: Boolean(existing.privateRelay),
        });
      }
      const a = existing ?? {
        id: id('user'),
        email: email.trim(),
        method: 'PASSWORD' as const,
        confirmed: false,
      };
      a.password = password;
      if (!existing) st.accounts.push(a);
      return challenge(a.id, 'CONFIRM_EMAIL');
    },
    async confirmEmail(challengeId, value) {
      await call('confirmEmail');
      const a = code(challengeId, value, 'CONFIRM_EMAIL');
      a.confirmed = true;
      return signIn(a, true);
    },
    async resendCode(challengeId) {
      await call('resendCode');
      const c = st.challenges[challengeId];
      if (!c) throw new AuthError('CHALLENGE_NOT_FOUND');
      return challenge(c.accountId, c.purpose);
    },
    async signInWithPassword(email, password) {
      await call('signInWithPassword');
      if (!isValidEmail(email)) throw new AuthError('EMAIL_INVALID');
      const a = find(email);
      if (!a) throw new AuthError('ACCOUNT_NOT_FOUND');
      if (a.method !== 'PASSWORD')
        throw new AuthError('WRONG_METHOD', {
          method: a.method,
          is_private_relay: Boolean(a.privateRelay || isPrivateRelayEmail(a.email)),
        });
      if (a.password !== password) {
        st.wrong++;
        if (st.wrong >= 5) throw new AuthError('SIGN_IN_PAUSED', {}, 900);
        throw new AuthError('WRONG_PASSWORD');
      }
      st.wrong = 0;
      if (!a.confirmed)
        throw new AuthError('EMAIL_NOT_CONFIRMED', {
          challenge_id: challenge(a.id, 'CONFIRM_EMAIL').challengeId,
        });
      if (a.stepUp)
        throw new AuthError('STEP_UP_REQUIRED', {
          challenge_id: challenge(a.id, 'NEW_DEVICE').challengeId,
        });
      return signIn(a);
    },
    async stepUp(challengeId, value) {
      await call('stepUp');
      const a = code(challengeId, value, 'NEW_DEVICE');
      a.stepUp = false;
      return signIn(a);
    },
    async signInWithProvider(provider: Provider, intent: Intent) {
      await call(`signInWithProvider:${provider}`);
      const p = st.provider;
      if (!p) throw Object.assign(new Error('cancelled'), { name: 'ProviderCancelled' });
      const mine = st.accounts.find(
        (a) => a.method === provider && normaliseEmail(a.email) === normaliseEmail(p.email),
      );
      if (mine) {
        if (intent === 'CREATE') {
          const t = id('ticket');
          st.tickets[t] = { kind: 'SIGN_IN_EXISTING', provider, email: mine.email };
          throw new AuthError('ACCOUNT_EXISTS', { ticket: t, email: mine.email, method: provider });
        }
        return signIn(mine);
      }
      const other = find(p.email);
      if (other)
        throw new AuthError('WRONG_METHOD', {
          method: other.method,
          email: other.email,
          is_private_relay: Boolean(other.privateRelay),
        });
      if (intent === 'SIGN_IN') {
        const t = id('ticket');
        st.tickets[t] = { kind: 'CREATE_FEDERATED', provider, email: p.email };
        throw new AuthError('ACCOUNT_NOT_FOUND', { ticket: t, email: p.email });
      }
      const a: MemoryAccount = {
        id: id('user'),
        email: p.email,
        method: provider,
        confirmed: true,
      };
      st.accounts.push(a);
      return signIn(a, true);
    },
    async useTicket(ticket) {
      await call('useTicket');
      const t = st.tickets[ticket];
      if (!t) throw new AuthError('TICKET_EXPIRED');
      delete st.tickets[ticket];
      if (t.kind === 'SIGN_IN_EXISTING') return signIn(find(t.email)!);
      const a: MemoryAccount = {
        id: id('user'),
        email: t.email,
        method: t.provider,
        confirmed: true,
      };
      st.accounts.push(a);
      return signIn(a, true);
    },
    async requestPasswordReset(email) {
      await call('requestPasswordReset');
      const a = find(email);
      if (a?.method === 'PASSWORD') {
        const t = id('reset');
        st.resetTokens[t] = a.id;
        st.resetsSent.push(a.email);
      }
    },
    async verifyResetLink(token) {
      await call('verifyResetLink');
      const accountId = st.resetTokens[token];
      if (!accountId) throw new AuthError('RESET_LINK_INVALID');
      return { email: st.accounts.find((a) => a.id === accountId)!.email };
    },
    async completeReset(token, newPassword) {
      await call('completeReset');
      const accountId = st.resetTokens[token];
      if (!accountId) throw new AuthError('RESET_LINK_INVALID');
      const a = st.accounts.find((x) => x.id === accountId)!;
      validate(newPassword, a.email);
      delete st.resetTokens[token];
      a.password = newPassword;
      a.confirmed = true;
      a.stepUp = false;
      st.sessions = [];
    },
    async breachRange(prefix) {
      await call('breachRange');
      const { prefix: p, suffix } = breachRangePrefix(BREACHED_PASSWORD);
      return prefix === p ? `${suffix}:42\n` : '';
    },
    async signOut() {
      await call('signOut');
      st.user = null;
      emit();
    },
    async security(): Promise<SecurityInfo> {
      await call('security');
      const a = me();
      return {
        method: a.method,
        email: a.email,
        isPrivateRelay: Boolean(a.privateRelay),
        passwordChangedAt: a.passwordChangedAt ?? null,
        deviceCount: st.sessions.length,
      };
    },
    async listSessions() {
      await call('listSessions');
      me();
      return [...st.sessions];
    },
    async revokeSession(sid) {
      await call('revokeSession');
      st.sessions = st.sessions.filter((s) => s.id !== sid);
    },
    async revokeAllSessions() {
      await call('revokeAllSessions');
      st.sessions = [];
      st.user = null;
      emit();
    },
    async changePassword(current, next) {
      await call('changePassword');
      const a = me();
      if (a.method !== 'PASSWORD') throw new AuthError('NO_PASSWORD');
      if (a.password !== current) throw new AuthError('WRONG_PASSWORD');
      if (current.normalize('NFKC') === next.normalize('NFKC'))
        throw new AuthError('PASSWORD_SAME_AS_CURRENT');
      validate(next, a.email);
      a.password = next;
      a.passwordChangedAt = new Date().toISOString();
      st.sessions = st.sessions.filter((s) => s.isCurrent);
    },
    async reauthWithPassword(password) {
      await call('reauthWithPassword');
      if (me().password !== password) throw new AuthError('WRONG_PASSWORD');
      return 'reauth-token';
    },
    async reauthWithProvider(provider) {
      await call(`reauthWithProvider:${provider}`);
      if (!st.provider) throw Object.assign(new Error('cancelled'), { name: 'ProviderCancelled' });
      return 'reauth-token';
    },
    async requestDeletion(reauthToken) {
      await call('requestDeletion');
      if (reauthToken !== 'reauth-token') throw new AuthError('REAUTH_REQUIRED');
      const a = me();
      a.pendingDeletionUntil = new Date(Date.now() + 30 * 86400_000).toISOString();
      st.sessions = st.sessions.filter((s) => s.isCurrent);
      st.user = { ...st.user!, scope: 'PENDING_DELETION' };
      emit();
      return { deletionDueAt: a.pendingDeletionUntil };
    },
    async getDeletion() {
      await call('getDeletion');
      const a = me();
      return a.pendingDeletionUntil ? { deletionDueAt: a.pendingDeletionUntil } : null;
    },
    async cancelDeletion() {
      await call('cancelDeletion');
      const a = me();
      if (!a.pendingDeletionUntil) throw new AuthError('NOT_PENDING');
      a.pendingDeletionUntil = null;
      st.user = { ...st.user!, scope: 'FULL' };
      emit();
    },
    async exportData(format) {
      await call('exportData');
      st.exports.push(format);
    },
  };
  return api;
}
