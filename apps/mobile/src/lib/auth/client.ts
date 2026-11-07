// AuthApi over the auth-api edge function (docs/sign-in-spec.md section 3).
//
// iPhone (and Android later): calls auth-api directly; tokens live in the Keychain (device.ts)
// and in memory; refreshes go through auth-api (which revokes on any refresh-token reuse).
// Web: calls the same paths on the web server in front of the app (/api/auth/…), which holds
// the tokens in httpOnly cookies, so this code never sees them (decision 10).
import type { FederatedProvider } from '@life-os/core';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type {
  AuthApi,
  AuthListener,
  AuthUser,
  CodeChallenge,
  DeviceSession,
  Intent,
  Provider,
  SecurityInfo,
  SessionScope,
  SignInResult,
} from '../backend/types';
import { AuthError, fromBody } from './errors';
import { deviceLabel, devicePlatform, getDeviceId, tokenStore, type StoredSession } from './device';
import type { DeviceCheckClient } from './deviceCheck';
import { ProviderCancelled, appleIdToken, googleIdToken, type ProviderResult } from './providers';

export interface AuthClientOptions {
  mode: 'native' | 'web';
  /** native: https://<ref>.supabase.co/functions/v1/auth-api · web: /api/auth */
  baseUrl: string;
  anonKey: string;
  deviceCheck: DeviceCheckClient;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface TokensBody {
  tokens?: { access_token: string; refresh_token: string; expires_at: number };
  /** web: the cookie server replaces tokens with this. */
  session?: { user: { id: string; email: string | null }; scope: SessionScope };
  scope?: SessionScope;
  account_created?: boolean;
}

function decodeJwt(token: string): Record<string, unknown> {
  const part = token.split('.')[1] ?? '';
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const json = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return JSON.parse(decodeURIComponent(escape(json))) as Record<string, unknown>;
}

function userFromAccessToken(token: string): AuthUser {
  const c = decodeJwt(token);
  return {
    id: String(c.sub),
    email: typeof c.email === 'string' ? c.email : null,
    scope: c.lifeos_scope === 'PENDING_DELETION' ? 'PENDING_DELETION' : 'FULL',
  };
}

const challenge = (b: {
  challenge_id: string;
  code_expires_at: string;
  resend_available_at: string;
}): CodeChallenge => ({
  challengeId: b.challenge_id,
  codeExpiresAt: b.code_expires_at,
  resendAvailableAt: b.resend_available_at,
});

export class AuthClient implements AuthApi {
  private session: StoredSession | null = null;
  private user: AuthUser | null = null;
  private loaded: Promise<void> | null = null;
  private refreshing: Promise<void> | null = null;
  private readonly listeners = new Set<AuthListener>();
  private readonly fetch: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly o: AuthClientOptions) {
    this.fetch = o.fetchImpl ?? fetch.bind(globalThis);
    this.now = o.now ?? Date.now;
  }

  // ------------------------------------------------------------ session state

  private emit() {
    for (const l of this.listeners) l(this.user);
  }

  private async load() {
    this.loaded ??= (async () => {
      if (this.o.mode === 'web') {
        try {
          const r = await this.request<{ session: TokensBody['session'] | null }>(
            'GET',
            '/session',
            undefined,
            { web: true },
          );
          this.user = r.session ? { ...r.session.user, scope: r.session.scope } : null;
        } catch {
          this.user = null;
        }
        return;
      }
      this.session = await tokenStore.load();
      this.user = this.session ? userFromAccessToken(this.session.accessToken) : null;
    })();
    return this.loaded;
  }

  private async setTokens(body: TokensBody): Promise<SignInResult> {
    if (this.o.mode === 'web') {
      const s = body.session;
      this.user = s ? { ...s.user, scope: s.scope } : null;
    } else if (body.tokens) {
      this.session = {
        accessToken: body.tokens.access_token,
        refreshToken: body.tokens.refresh_token,
        expiresAt: body.tokens.expires_at,
      };
      await tokenStore.save(this.session);
      this.user = userFromAccessToken(this.session.accessToken);
    }
    this.emit();
    return {
      accountCreated: Boolean(body.account_created),
      scope: body.scope ?? this.user?.scope ?? 'FULL',
    };
  }

  private async clearLocal() {
    this.session = null;
    this.user = null;
    if (this.o.mode === 'native') await tokenStore.clear();
    this.emit();
  }

  /** A valid access token (refreshing first if it's about to expire). Native only. */
  async accessToken(): Promise<string | null> {
    await this.load();
    if (this.o.mode === 'web' || !this.session) return null;
    if (this.session.expiresAt * 1000 - this.now() < 60_000) await this.refresh();
    return this.session?.accessToken ?? null;
  }

  private async refresh() {
    this.refreshing ??= (async () => {
      const s = this.session;
      if (!s) return;
      try {
        const body = await this.request<TokensBody>('POST', '/v1/tokens/refresh', {
          refresh_token: s.refreshToken,
        });
        await this.setTokens(body);
      } catch (err) {
        if (
          err instanceof AuthError &&
          (err.code === 'SESSION_EXPIRED' || err.code === 'SESSION_REVOKED')
        ) {
          await this.clearLocal(); // → 0a, no message (spec 3.3)
        }
        throw err;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  /** Current user id for data calls. */
  async userId(): Promise<string | null> {
    await this.load();
    return this.user?.id ?? null;
  }

  // ------------------------------------------------------------ HTTP

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    opts: { auth?: boolean; web?: boolean } = {},
  ): Promise<T> {
    const text = body === undefined ? '' : JSON.stringify(body);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Device-Platform': devicePlatform(),
      'X-Device-Label': deviceLabel(),
    };
    if (this.o.mode === 'native') {
      headers.apikey = this.o.anonKey;
      headers['X-Device-Id'] = await getDeviceId();
      if (opts.auth) {
        const token = await this.accessToken();
        if (!token) throw new AuthError('SESSION_REVOKED');
        headers.Authorization = `Bearer ${token}`;
      } else {
        headers.Authorization = `Bearer ${this.o.anonKey}`;
      }
    } else {
      // Double-submit CSRF token: the cookie server checks this matches its cookie.
      const csrf =
        typeof document !== 'undefined'
          ? /(?:^|; )(?:__Host-)?lifeos_csrf=([^;]+)/.exec(document.cookie)?.[1]
          : undefined;
      if (csrf) headers['X-CSRF-Token'] = decodeURIComponent(csrf);
    }
    if (!opts.auth && path.startsWith('/v1/')) {
      Object.assign(headers, await this.o.deviceCheck.headers(method, path, text));
    }
    let res: Response;
    try {
      res = await this.fetch(`${this.o.baseUrl}${path}`, {
        method,
        headers,
        body: method === 'GET' || method === 'DELETE' ? undefined : text,
        credentials: this.o.mode === 'web' ? 'same-origin' : 'omit',
      });
    } catch {
      throw new AuthError('NETWORK');
    }
    const raw = await res.text();
    let parsed: unknown;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = raw;
    }
    if (!res.ok) {
      const e = fromBody(res.status, parsed);
      if (opts.auth && (e.code === 'SESSION_REVOKED' || e.code === 'SESSION_EXPIRED'))
        await this.clearLocal();
      throw e;
    }
    return parsed as T;
  }

  // ------------------------------------------------------------ AuthApi

  async currentUser() {
    await this.load();
    return this.user;
  }

  onChange(listener: AuthListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async createAccount(email: string, password: string) {
    return challenge(await this.request('POST', '/v1/accounts', { email: email.trim(), password }));
  }

  async confirmEmail(challengeId: string, code: string) {
    return this.setTokens(
      await this.request('POST', '/v1/accounts/confirm', { challenge_id: challengeId, code }),
    );
  }

  async resendCode(challengeId: string) {
    return challenge(await this.request('POST', '/v1/codes/resend', { challenge_id: challengeId }));
  }

  async signInWithPassword(email: string, password: string) {
    return this.setTokens(
      await this.request('POST', '/v1/sessions/password', { email: email.trim(), password }),
    );
  }

  async stepUp(challengeId: string, code: string) {
    return this.setTokens(
      await this.request('POST', '/v1/sessions/step-up', { challenge_id: challengeId, code }),
    );
  }

  private async providerToken(provider: Provider) {
    const n = await this.request<{ nonce_id: string; nonce: string }>('POST', '/v1/auth/nonce', {});
    let r: ProviderResult;
    try {
      r = provider === 'APPLE' ? await appleIdToken(n.nonce) : await googleIdToken(n.nonce);
    } catch (err) {
      if (err instanceof ProviderCancelled) throw err;
      throw err instanceof AuthError ? err : new AuthError('PROVIDER_ERROR');
    }
    return { ...r, nonceId: n.nonce_id, nonce: n.nonce };
  }

  async signInWithProvider(provider: Provider, intent: Intent) {
    const t = await this.providerToken(provider);
    return this.setTokens(
      await this.request('POST', '/v1/sessions/federated', {
        provider,
        intent,
        id_token: t.idToken,
        authorization_code: t.authorizationCode,
        nonce_id: t.nonceId,
        nonce: t.nonce,
        given_name: t.givenName,
      }),
    );
  }

  async useTicket(ticket: string) {
    return this.setTokens(await this.request('POST', '/v1/sessions/ticket', { ticket }));
  }

  async requestPasswordReset(email: string) {
    await this.request('POST', '/v1/password-resets', { email: email.trim() });
  }

  async verifyResetLink(token: string) {
    const r = await this.request<{ email: string }>('POST', '/v1/password-resets/verify', {
      token,
    });
    return { email: r.email };
  }

  async completeReset(token: string, newPassword: string) {
    await this.request('POST', '/v1/password-resets/complete', {
      token,
      new_password: newPassword,
    });
  }

  async breachRange(prefix: string) {
    const r = await this.request<string>('GET', `/v1/password/breach-range/${prefix}`);
    return typeof r === 'string' ? r : '';
  }

  async signOut() {
    try {
      await this.request('POST', '/v1/sessions/current/sign-out', {}, { auth: true });
    } catch {
      // Always succeeds locally (spec 3.2).
    }
    await this.clearLocal();
  }

  async security(): Promise<SecurityInfo> {
    const r = await this.request<{
      method: SecurityInfo['method'];
      email: string;
      is_private_relay: boolean;
      password_changed_at: string | null;
      device_count: number;
    }>('GET', '/v1/me/security', undefined, { auth: true });
    return {
      method: r.method,
      email: r.email,
      isPrivateRelay: r.is_private_relay,
      passwordChangedAt: r.password_changed_at,
      deviceCount: r.device_count,
    };
  }

  async listSessions(): Promise<DeviceSession[]> {
    const rows = await this.request<
      {
        id: string;
        label: string;
        platform: DeviceSession['platform'];
        coarse_location: string | null;
        last_active_at: string;
        is_current: boolean;
      }[]
    >('GET', '/v1/me/sessions', undefined, { auth: true });
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      platform: r.platform,
      coarseLocation: r.coarse_location,
      lastActiveAt: r.last_active_at,
      isCurrent: r.is_current,
    }));
  }

  async revokeSession(id: string) {
    try {
      await this.request('DELETE', `/v1/me/sessions/${id}`, undefined, { auth: true });
    } catch (err) {
      if (!(err instanceof AuthError && err.code === 'SESSION_NOT_FOUND')) throw err; // treat as done
    }
  }

  async revokeAllSessions() {
    await this.request('POST', '/v1/me/sessions/revoke-all', {}, { auth: true });
    await this.clearLocal();
  }

  async changePassword(currentPassword: string, newPassword: string) {
    const body = await this.request<TokensBody>(
      'POST',
      '/v1/me/password',
      { current_password: currentPassword, new_password: newPassword },
      { auth: true },
    );
    // This device continues with fresh tokens; every other device is signed out.
    await this.setTokens(body);
  }

  async reauthWithPassword(password: string) {
    const r = await this.request<{ reauth_token: string }>(
      'POST',
      '/v1/me/reauth',
      { password },
      { auth: true },
    );
    return r.reauth_token;
  }

  async reauthWithProvider(provider: FederatedProvider) {
    const t = await this.providerToken(provider);
    const r = await this.request<{ reauth_token: string }>(
      'POST',
      '/v1/me/reauth',
      { provider, id_token: t.idToken, nonce_id: t.nonceId, nonce: t.nonce },
      { auth: true },
    );
    return r.reauth_token;
  }

  async requestDeletion(reauthToken: string) {
    const r = await this.request<{ deletion_due_at: string }>(
      'POST',
      '/v1/me/deletion',
      { reauth_token: reauthToken, confirmation: 'DELETE' },
      { auth: true },
    );
    // This session now has the PENDING_DELETION scope: refresh so the token says so.
    if (this.o.mode === 'native') await this.refresh().catch(() => undefined);
    else this.user = this.user ? { ...this.user, scope: 'PENDING_DELETION' } : null;
    this.emit();
    return { deletionDueAt: r.deletion_due_at };
  }

  async getDeletion() {
    try {
      const r = await this.request<{ deletion_due_at: string }>(
        'GET',
        '/v1/me/deletion',
        undefined,
        { auth: true },
      );
      return { deletionDueAt: r.deletion_due_at };
    } catch (err) {
      if (err instanceof AuthError && err.code === 'NOT_PENDING') return null;
      throw err;
    }
  }

  async cancelDeletion() {
    await this.request('DELETE', '/v1/me/deletion', undefined, { auth: true });
    if (this.o.mode === 'native') await this.refresh().catch(() => undefined);
    else this.user = this.user ? { ...this.user, scope: 'FULL' } : null;
    this.emit();
  }

  async exportData(format: 'json' | 'csv') {
    const url = `${this.o.baseUrl}/v1/me/export?format=${format}`;
    if (this.o.mode === 'web') {
      window.location.assign(url); // the cookie server streams it as an attachment
      return;
    }
    const token = await this.accessToken();
    if (!token) throw new AuthError('SESSION_REVOKED');
    const stamp = new Date(this.now()).toISOString().slice(0, 10);
    const file = new File(
      Paths.cache,
      `life-os-export-${stamp}.${format === 'csv' ? 'zip' : 'json'}`,
    );
    const saved = await File.downloadFileAsync(url, file, {
      headers: { apikey: this.o.anonKey, Authorization: `Bearer ${token}` },
      idempotent: true,
    });
    await Sharing.shareAsync(saved.uri, { dialogTitle: 'Your Life OS data' });
  }
}
