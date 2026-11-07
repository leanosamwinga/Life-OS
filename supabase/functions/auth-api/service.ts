// Sign-in v3 flows (docs/sign-in-spec.md sections 2–9) on top of Supabase Auth.
// Each public method is one endpoint of spec 3.2. Errors are ApiError with the spec's codes.
import type { Sql } from 'postgres';
import {
  CODE_MAX_ATTEMPTS,
  CODE_TTL_SECONDS,
  DELETION_GRACE_DAYS,
  RESEND_AFTER_SECONDS,
  RESENDS_PER_HOUR,
  RESET_TTL_SECONDS,
  breachRangePrefix,
  checkPassword,
  isPrivateRelayEmail,
  isValidEmail,
  normaliseEmail,
  normalisePassword,
  type FederatedProvider,
  type SignInMethod,
} from '@life-os/core';
import { currentPepper, type AuthConfig } from './config.ts';
import type { RequestContext } from './context.ts';
import { encryptText, hmacHex, randomCode, randomToken, sha256Hex, unsafeJwtPayload } from './crypto.ts';
import type { EmailTemplate } from './email.ts';
import { IdTokenError, type IdTokenVerifier, type VerifiedIdToken } from './federated.ts';
import { GoTrue, GoTrueError, type GoTrueSession } from './gotrue.ts';
import { err } from './http.ts';
import type { AuthLogger } from './log.ts';
import { derivePassword } from './password.ts';

export interface AppleCodeExchange {
  /** Exchanges a first-sign-in authorization code; returns Apple's refresh token, or null if not configured. */
  exchange(code: string, clientId: string): Promise<string | null>;
}

export interface ServiceDeps {
  config: AuthConfig;
  sql: Sql;
  gotrue: GoTrue;
  log: AuthLogger;
  idTokens: IdTokenVerifier;
  apple: AppleCodeExchange;
  /** Town-level location for the device list (spec 8.4). Null when unknown. */
  locate(ipPrefixValue: string | null): Promise<string | null>;
  /** Runs work after the response (e.g. draining the outbox). */
  later(task: () => Promise<void>): void;
  drainOutbox(): Promise<void>;
  now(): Date;
}

export interface Account {
  user_id: string;
  email: string;
  email_norm: string;
  method: SignInMethod;
  status: 'UNCONFIRMED' | 'ACTIVE' | 'PENDING_DELETION';
  is_private_relay: boolean;
  step_up_required: boolean;
  pepper_version: number | null;
  email_deliverable: boolean;
  password_changed_at: Date | null;
}

export interface TokensBody {
  tokens: { access_token: string; refresh_token: string; expires_at: number; token_type: string };
  scope: 'FULL' | 'PENDING_DELETION';
  account_created: boolean;
}

export interface Caller {
  userId: string;
  sessionId: string;
  accessToken: string;
  account: Account;
}

const LOOKUP_LIMIT = 10;
const LOOKUP_LIMIT_UNATTESTED = 3;
const HOUR = 3600;

export class AuthService {
  constructor(private readonly d: ServiceDeps) {}

  private get sql() {
    return this.d.sql;
  }

  private nowMs() {
    return this.d.now().getTime();
  }

  // ---------------------------------------------------------------- shared helpers

  async findAccountByEmail(email: string): Promise<Account | null> {
    const [row] = await this.sql<Account[]>`
      select * from public.auth_accounts where email_norm = ${normaliseEmail(email)}`;
    return row ?? null;
  }

  private async findAccount(userId: string): Promise<Account | null> {
    const [row] = await this.sql<Account[]>`select * from public.auth_accounts where user_id = ${userId}`;
    return row ?? null;
  }

  private async keyHash(kind: string, value: string): Promise<string> {
    return hmacHex(this.d.config.keyHashKey, `${kind}:${value}`);
  }

  /** Counts an event and throws RATE_LIMITED if `limit` were already reached in the window. */
  private async limit(bucket: string, key: string, limit: number, windowSec: number, code: 'RATE_LIMITED' | 'RESEND_LIMIT' = 'RATE_LIMITED') {
    const since = new Date(this.nowMs() - windowSec * 1000);
    const [row] = await this.sql<{ n: number; oldest: Date | null }[]>`
      select count(*)::int as n, min(at) as oldest from public.auth_rate_events
       where bucket = ${bucket} and key_hash = ${key} and at > ${since}`;
    if (row!.n >= limit) {
      const retry = row!.oldest
        ? Math.max(1, Math.ceil((row!.oldest.getTime() + windowSec * 1000 - this.nowMs()) / 1000))
        : windowSec;
      throw err(429, code, null, retry);
    }
    await this.sql`insert into public.auth_rate_events (bucket, key_hash, at) values (${bucket}, ${key}, ${this.d.now()})`;
  }

  /** About 10 look-ups an hour per device, per IP and per email (spec 4.1, 6.1). */
  private async lookupLimits(ctx: RequestContext, email: string | null) {
    const n = ctx.deviceCheck === 'unsupported' ? LOOKUP_LIMIT_UNATTESTED : LOOKUP_LIMIT;
    try {
      await this.limit('lookup:device', ctx.deviceHash, n, HOUR);
      if (ctx.ipHash) await this.limit('lookup:ip', ctx.ipHash, n, HOUR);
      if (email) await this.limit('lookup:email', await this.keyHash('email', normaliseEmail(email)), n, HOUR);
    } catch (e) {
      this.d.log.event('auth.lookup.rate_limited', { request_id: ctx.requestId, device_id_hash: ctx.deviceHash, ip_prefix: ctx.ipPrefix });
      throw e;
    }
  }

  private async isBreached(password: string): Promise<boolean> {
    if (!this.d.config.breachCheck) return false;
    const { prefix, suffix } = breachRangePrefix(password);
    const [row] = await this.sql`
      select 1 from public.auth_breached_hashes where prefix = ${prefix} and suffix = ${suffix} and breach_count >= 1`;
    return !!row;
  }

  /** Server-side password rules: length after NFKC, email, breach (spec 5.1, 5.3). */
  private async validateNewPassword(password: string, email: string) {
    const check = checkPassword(password, email);
    if (check.error) throw err(422, check.error);
    if (await this.isBreached(password)) throw err(422, 'PASSWORD_BREACHED');
  }

  private async enqueueEmail(
    template: EmailTemplate,
    to: { userId: string | null; email: string; deliverable?: boolean },
    params: Record<string, unknown>,
    idempotencyKey: string | null = null,
  ) {
    if (to.deliverable === false) return; // Apple relay forwarding off (spec 9.4)
    await this.sql`
      insert into public.auth_email_outbox (user_id, to_email, template, params, idempotency_key)
      values (${to.userId}, ${to.email}, ${template}, ${this.sql.json(params as never)}, ${idempotencyKey})
      on conflict (idempotency_key) do nothing`;
    this.d.later(() => this.d.drainOutbox());
  }

  private async newCode(userId: string, purpose: 'CONFIRM_EMAIL' | 'NEW_DEVICE', deviceHash: string) {
    const code = randomCode();
    const now = this.d.now();
    const expires = new Date(now.getTime() + CODE_TTL_SECONDS * 1000);
    // Each new code cancels the older ones (spec 2.2.5).
    await this.sql`
      update public.auth_one_time_codes set superseded_at = ${now}
       where user_id = ${userId} and purpose = ${purpose} and consumed_at is null and superseded_at is null`;
    const [row] = await this.sql<{ id: string }[]>`
      insert into public.auth_one_time_codes (user_id, purpose, code_hmac, device_id_hash, expires_at, created_at)
      values (${userId}, ${purpose}, 'pending', ${deviceHash}, ${expires}, ${now}) returning id`;
    const mac = await hmacHex(this.d.config.codeKey, `${row!.id}:${code}`);
    await this.sql`update public.auth_one_time_codes set code_hmac = ${mac} where id = ${row!.id}`;
    return {
      code,
      challenge: {
        challenge_id: row!.id,
        code_expires_at: expires.toISOString(),
        resend_available_at: new Date(now.getTime() + RESEND_AFTER_SECONDS * 1000).toISOString(),
      },
    };
  }

  private async sendCode(account: Account, purpose: 'CONFIRM_EMAIL' | 'NEW_DEVICE', ctx: RequestContext) {
    const { code, challenge } = await this.newCode(account.user_id, purpose, ctx.deviceHash);
    const town = await this.d.locate(ctx.ipPrefix);
    await this.enqueueEmail(
      purpose === 'CONFIRM_EMAIL' ? 'confirm_code' : 'new_device_code',
      { userId: account.user_id, email: account.email, deliverable: account.email_deliverable },
      purpose === 'CONFIRM_EMAIL' ? { code } : { code, device: town ? `${ctx.label} · ${town}` : ctx.label },
    );
    this.d.log.event('auth.code.sent', { request_id: ctx.requestId, account_id: account.user_id, reason: purpose });
    return challenge;
  }

  /** Checks a 6-digit code: 10 minutes, 5 tries, single use (spec 2.2, 2.9). Returns the account. */
  private async checkCode(challengeId: string, code: string, purpose: 'CONFIRM_EMAIL' | 'NEW_DEVICE', ctx: RequestContext) {
    if (!/^[0-9a-f-]{36}$/.test(challengeId)) throw err(404, 'CHALLENGE_NOT_FOUND');
    return this.sql.begin(async (tx) => {
      const [row] = await tx<
        { id: string; user_id: string; code_hmac: string; expires_at: Date; attempts: number; consumed_at: Date | null; superseded_at: Date | null; device_id_hash: string }[]
      >`select * from public.auth_one_time_codes where id = ${challengeId} and purpose = ${purpose} for update`;
      if (!row) throw err(404, 'CHALLENGE_NOT_FOUND');
      if (row.consumed_at || row.superseded_at) throw err(410, 'CODE_EXPIRED');
      if (row.expires_at.getTime() <= this.nowMs()) throw err(410, 'CODE_EXPIRED');
      if (row.attempts >= CODE_MAX_ATTEMPTS) throw err(423, 'CODE_ATTEMPTS_EXCEEDED');
      const mac = await hmacHex(this.d.config.codeKey, `${row.id}:${code}`);
      if (!/^\d{6}$/.test(code) || mac !== row.code_hmac) {
        const attempts = row.attempts + 1;
        await tx`update public.auth_one_time_codes set attempts = ${attempts} where id = ${row.id}`;
        this.d.log.event('auth.code.failed', { request_id: ctx.requestId, account_id: row.user_id, count: attempts });
        if (attempts >= CODE_MAX_ATTEMPTS) return { failed: 'CODE_ATTEMPTS_EXCEEDED' as const };
        return { failed: 'CODE_INCORRECT' as const };
      }
      await tx`update public.auth_one_time_codes set consumed_at = ${this.d.now()} where id = ${row.id}`;
      this.d.log.event('auth.code.verified', { request_id: ctx.requestId, account_id: row.user_id, reason: purpose });
      return { userId: row.user_id };
    }).then((r) => {
      // Write the attempt count even when we refuse (the transaction above commits it).
      if ('failed' in r) throw r.failed === 'CODE_INCORRECT' ? err(422, 'CODE_INCORRECT') : err(423, 'CODE_ATTEMPTS_EXCEEDED');
      return r.userId;
    });
  }

  private async permit(purpose: 'ISSUE_SESSION' | 'SET_PASSWORD', userId: string) {
    const [row] = await this.sql<{ id: string }[]>`
      insert into public.auth_permits (purpose, user_id, expires_at)
      values (${purpose}, ${userId}, ${new Date(this.nowMs() + 30_000)}) returning id`;
    return row!.id;
  }

  private async dropPermit(id: string) {
    await this.sql`delete from public.auth_permits where id = ${id} and used_at is null`;
  }

  /** Sets the Supabase Auth password (derived from the user's password with the current pepper). */
  private async setPassword(userId: string, password: string) {
    const pepper = currentPepper(this.d.config);
    const permitId = await this.permit('SET_PASSWORD', userId);
    try {
      await this.d.gotrue.updateUser(userId, { password: await derivePassword(password, pepper) });
    } finally {
      await this.dropPermit(permitId);
    }
    return pepper.version;
  }

  private async rememberDevice(userId: string, ctx: RequestContext) {
    const town = await this.d.locate(ctx.ipPrefix);
    await this.sql`
      insert into public.auth_known_devices (user_id, device_id_hash, platform, label, coarse_location, last_seen_at)
      values (${userId}, ${ctx.deviceHash}, ${ctx.platform}, ${ctx.label}, ${town}, ${this.d.now()})
      on conflict (user_id, device_id_hash) do update
        set last_seen_at = excluded.last_seen_at, label = excluded.label, platform = excluded.platform,
            coarse_location = coalesce(excluded.coarse_location, public.auth_known_devices.coarse_location)`;
  }

  private async isKnownDevice(userId: string, deviceHash: string) {
    const [row] = await this.sql`
      select 1 from public.auth_known_devices where user_id = ${userId} and device_id_hash = ${deviceHash}`;
    return !!row;
  }

  /** Records the session for the device list and returns the spec's token body. */
  private async finishSession(account: Account, session: GoTrueSession, ctx: RequestContext, created: boolean): Promise<TokensBody> {
    const claims = unsafeJwtPayload(session.access_token);
    const sessionId = String(claims.session_id);
    const town = await this.d.locate(ctx.ipPrefix);
    await this.sql`
      insert into public.auth_session_meta (session_id, user_id, device_id_hash, platform, label, coarse_location)
      values (${sessionId}, ${account.user_id}, ${ctx.deviceHash}, ${ctx.platform}, ${ctx.label}, ${town})
      on conflict (session_id) do nothing`;
    await this.rememberDevice(account.user_id, ctx);
    const scope = claims.lifeos_scope === 'PENDING_DELETION' ? 'PENDING_DELETION' : 'FULL';
    this.d.log.event('auth.signin.success', {
      request_id: ctx.requestId,
      account_id: account.user_id,
      device_id_hash: ctx.deviceHash,
      platform: ctx.platform,
      method: account.method,
      scope,
      attestation_result: ctx.deviceCheck,
    });
    return {
      tokens: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at ?? Math.floor(this.nowMs() / 1000) + session.expires_in,
        token_type: 'bearer',
      },
      scope,
      account_created: created,
    };
  }

  /** A session for a user auth-api has already authenticated (code, ticket, Apple/Google). */
  private async mint(account: Account, ctx: RequestContext, created = false): Promise<TokensBody> {
    const permitId = await this.permit('ISSUE_SESSION', account.user_id);
    try {
      const session = await this.d.gotrue.mintSession(account.email);
      return await this.finishSession(account, session, ctx, created);
    } finally {
      await this.dropPermit(permitId);
    }
  }

  private async deleteSession(sessionId: string) {
    await this.sql`delete from auth.sessions where id = ${sessionId}`;
  }

  private async deleteSessions(userId: string, exceptSessionId: string | null = null) {
    const rows = await this.sql<{ id: string }[]>`
      delete from auth.sessions where user_id = ${userId}
        and (${exceptSessionId}::uuid is null or id <> ${exceptSessionId}::uuid) returning id`;
    return rows.length;
  }

  /** Creates a Supabase Auth user, cleaning up an orphan from an interrupted earlier attempt. */
  private async createAuthUser(input: { email: string; password?: string; emailConfirm: boolean; displayName?: string | null }) {
    try {
      return await this.d.gotrue.createUser(input);
    } catch (e) {
      if (!(e instanceof GoTrueError) || e.status !== 422) throw e;
      const [orphan] = await this.sql<{ id: string }[]>`
        select u.id from auth.users u
         where lower(u.email) = ${normaliseEmail(input.email)}
           and not exists (select 1 from public.auth_accounts a where a.user_id = u.id)`;
      if (!orphan) throw e;
      await this.d.gotrue.deleteUser(orphan.id);
      return this.d.gotrue.createUser(input);
    }
  }

  private async ownerAlert(account: Account) {
    // At most one per account per 24 hours (spec 4.1, 7.5).
    const rows = await this.sql`
      insert into public.auth_owner_alerts (user_id, last_sent_at) values (${account.user_id}, ${this.d.now()})
      on conflict (user_id) do update set last_sent_at = excluded.last_sent_at
        where public.auth_owner_alerts.last_sent_at < ${new Date(this.nowMs() - 24 * HOUR * 1000)}
      returning user_id`;
    if (rows.length) {
      await this.enqueueEmail('owner_alert', { userId: account.user_id, email: account.email, deliverable: account.email_deliverable }, { method: account.method });
    }
  }

  // ---------------------------------------------------------------- 2.1 create with email

  async createAccount(ctx: RequestContext, email: string, password: string) {
    await this.lookupLimits(ctx, email);
    if (!isValidEmail(email)) throw err(422, 'EMAIL_INVALID');
    const typed = email.trim();
    await this.validateNewPassword(password, typed);

    const existing = await this.findAccountByEmail(typed);
    if (existing && existing.status !== 'UNCONFIRMED') {
      await this.ownerAlert(existing);
      if (existing.method === 'PASSWORD') throw err(409, 'ACCOUNT_EXISTS');
      throw err(409, 'WRONG_METHOD', { method: existing.method, is_private_relay: existing.is_private_relay });
    }

    let account: Account;
    if (existing) {
      // Unconfirmed accounts can't be squatted: replace the pending password (spec 1.2).
      const version = await this.setPassword(existing.user_id, password);
      await this.sql`update public.auth_accounts set pepper_version = ${version}, email = ${typed} where user_id = ${existing.user_id}`;
      account = { ...existing, email: typed, pepper_version: version };
    } else {
      const pepper = currentPepper(this.d.config);
      const user = await this.createAuthUser({
        email: typed,
        password: await derivePassword(password, pepper),
        emailConfirm: false,
      });
      const [row] = await this.sql<Account[]>`
        insert into public.auth_accounts (user_id, email, method, status, pepper_version, is_private_relay)
        values (${user.id}, ${typed}, 'PASSWORD', 'UNCONFIRMED', ${pepper.version}, ${isPrivateRelayEmail(typed)})
        returning *`;
      account = row!;
      this.d.log.event('auth.account.created', { request_id: ctx.requestId, account_id: account.user_id, method: 'PASSWORD' });
    }
    return this.sendCode(account, 'CONFIRM_EMAIL', ctx);
  }

  // ---------------------------------------------------------------- 2.2 confirm the email

  async confirmEmail(ctx: RequestContext, challengeId: string, code: string): Promise<TokensBody> {
    await this.limit('code:device', ctx.deviceHash, 30, HOUR);
    const userId = await this.checkCode(challengeId, code, 'CONFIRM_EMAIL', ctx);
    const account = await this.findAccount(userId);
    if (!account) throw err(404, 'CHALLENGE_NOT_FOUND');
    await this.d.gotrue.updateUser(userId, { emailConfirm: true });
    await this.sql`
      update public.auth_accounts set status = 'ACTIVE', confirmed_at = coalesce(confirmed_at, ${this.d.now()})
       where user_id = ${userId} and status = 'UNCONFIRMED'`;
    return this.mint({ ...account, status: 'ACTIVE' }, ctx, true);
  }

  async resendCode(ctx: RequestContext, challengeId: string) {
    if (!/^[0-9a-f-]{36}$/.test(challengeId)) throw err(404, 'CHALLENGE_NOT_FOUND');
    const [row] = await this.sql<{ user_id: string; purpose: 'CONFIRM_EMAIL' | 'NEW_DEVICE'; created_at: Date }[]>`
      select c.user_id, c.purpose,
             (select max(c2.created_at) from public.auth_one_time_codes c2
               where c2.user_id = c.user_id and c2.purpose = c.purpose) as created_at
        from public.auth_one_time_codes c where c.id = ${challengeId}`;
    if (!row) throw err(404, 'CHALLENGE_NOT_FOUND');
    const sinceLast = (this.nowMs() - row.created_at.getTime()) / 1000;
    if (sinceLast < RESEND_AFTER_SECONDS) {
      throw err(429, 'RESEND_TOO_SOON', null, Math.ceil(RESEND_AFTER_SECONDS - sinceLast));
    }
    await this.limit(`resend:${row.purpose}`, row.user_id, RESENDS_PER_HOUR, HOUR, 'RESEND_LIMIT');
    const account = await this.findAccount(row.user_id);
    if (!account) throw err(404, 'CHALLENGE_NOT_FOUND');
    return this.sendCode(account, row.purpose, ctx);
  }

  // ---------------------------------------------------------------- 2.3 sign in with email

  async signInWithPassword(ctx: RequestContext, email: string, password: string): Promise<TokensBody> {
    await this.lookupLimits(ctx, email);
    if (!isValidEmail(email)) throw err(422, 'EMAIL_INVALID');
    const norm = normaliseEmail(email);

    const pausedUntil = await this.activePause(norm, ctx);
    if (pausedUntil) throw this.pausedError(pausedUntil);

    const account = await this.findAccountByEmail(norm);
    if (!account) {
      this.d.log.event('auth.signin.failed', { request_id: ctx.requestId, reason: 'ACCOUNT_NOT_FOUND', device_id_hash: ctx.deviceHash });
      throw err(404, 'ACCOUNT_NOT_FOUND');
    }
    if (account.method !== 'PASSWORD') {
      throw err(409, 'WRONG_METHOD', { method: account.method, is_private_relay: account.is_private_relay });
    }

    const session = await this.verifyPassword(account, password, ctx);
    if (session === 'unconfirmed') {
      const challenge = await this.sendCode(account, 'CONFIRM_EMAIL', ctx);
      throw err(403, 'EMAIL_NOT_CONFIRMED', { challenge_id: challenge.challenge_id });
    }
    if (account.step_up_required && !(await this.isKnownDevice(account.user_id, ctx.deviceHash))) {
      // Correct password from an unknown device while the quiet check's flag is set (2.9).
      await this.deleteSession(String(unsafeJwtPayload(session.access_token).session_id));
      const challenge = await this.sendCode(account, 'NEW_DEVICE', ctx);
      throw err(403, 'STEP_UP_REQUIRED', { challenge_id: challenge.challenge_id });
    }
    await this.maybeRehash(account, password);
    return this.finishSession(account, session, ctx, false);
  }

  private async activePause(emailNorm: string, ctx: RequestContext): Promise<Date | null> {
    const [row] = await this.sql<{ until: Date | null }[]>`
      select public.auth_active_pause(${emailNorm}, ${ctx.deviceHash}, ${ctx.ipHash}, ${this.d.now()}) as until`;
    return row?.until ?? null;
  }

  private pausedError(until: Date) {
    return err(429, 'SIGN_IN_PAUSED', null, Math.max(1, Math.ceil((until.getTime() - this.nowMs()) / 1000)));
  }

  /**
   * Checks the password with Supabase Auth's password grant. Wrong → counts towards the pause
   * and the quiet check, then WRONG_PASSWORD (or SIGN_IN_PAUSED on the 5th try).
   */
  private async verifyPassword(account: Account, password: string, ctx: RequestContext): Promise<GoTrueSession | 'unconfirmed'> {
    const pepper = this.d.config.peppers.find((p) => p.version === account.pepper_version) ?? currentPepper(this.d.config);
    const permitId = await this.permit('ISSUE_SESSION', account.user_id);
    try {
      return await this.d.gotrue.signInWithPassword(account.email, await derivePassword(password, pepper));
    } catch (e) {
      if (e instanceof GoTrueError && e.errorCode === 'email_not_confirmed') return 'unconfirmed';
      if (e instanceof GoTrueError && e.errorCode === 'invalid_credentials') {
        const [row] = await this.sql<{ until: Date | null }[]>`
          select public.auth_record_wrong_password(${account.email_norm}, ${account.user_id}, ${ctx.deviceHash}, ${ctx.ipHash}, ${this.d.now()}) as until`;
        const [flag] = await this.sql<{ step_up_required: boolean }[]>`
          select step_up_required from public.auth_accounts where user_id = ${account.user_id}`;
        if (flag?.step_up_required && !account.step_up_required) {
          this.d.log.event('auth.stepup.flagged', { account_id: account.user_id });
        }
        this.d.log.event('auth.signin.failed', { request_id: ctx.requestId, account_id: account.user_id, reason: 'WRONG_PASSWORD', device_id_hash: ctx.deviceHash });
        if (row?.until) {
          this.d.log.event('auth.pause.started', { request_id: ctx.requestId, account_id: account.user_id, device_id_hash: ctx.deviceHash });
          throw this.pausedError(row.until);
        }
        throw err(401, 'WRONG_PASSWORD');
      }
      throw e;
    } finally {
      await this.dropPermit(permitId);
    }
  }

  /** Rehash on sign-in when the pepper version is out of date (spec 5.4). */
  private async maybeRehash(account: Account, password: string) {
    const current = currentPepper(this.d.config);
    if (account.pepper_version === current.version) return;
    const version = await this.setPassword(account.user_id, password);
    await this.sql`update public.auth_accounts set pepper_version = ${version} where user_id = ${account.user_id}`;
  }

  // ---------------------------------------------------------------- 2.9 new-device check

  async stepUp(ctx: RequestContext, challengeId: string, code: string): Promise<TokensBody> {
    await this.limit('code:device', ctx.deviceHash, 30, HOUR);
    const userId = await this.checkCode(challengeId, code, 'NEW_DEVICE', ctx);
    const account = await this.findAccount(userId);
    if (!account) throw err(404, 'CHALLENGE_NOT_FOUND');
    await this.sql`update public.auth_accounts set step_up_required = false, step_up_set_at = null where user_id = ${userId}`;
    this.d.log.event('auth.stepup.passed', { request_id: ctx.requestId, account_id: userId });
    return this.mint({ ...account, step_up_required: false }, ctx);
  }

  // ---------------------------------------------------------------- 2.7 Apple and Google

  async newNonce(ctx: RequestContext) {
    await this.limit('nonce', ctx.deviceHash, 30, HOUR);
    const nonce = randomToken();
    const [row] = await this.sql<{ id: string }[]>`
      insert into public.auth_nonces (nonce_hash, device_id_hash, expires_at)
      values (${await sha256Hex(nonce)}, ${ctx.deviceHash}, ${new Date(this.nowMs() + 10 * 60_000)}) returning id`;
    return { nonce_id: row!.id, nonce };
  }

  /** Marks the nonce used and returns it; any reuse, expiry or device mismatch → TOKEN_INVALID. */
  private async takeNonce(nonceId: string, rawNonce: string | null, ctx: RequestContext): Promise<string> {
    if (!/^[0-9a-f-]{36}$/.test(nonceId)) throw err(401, 'TOKEN_INVALID');
    const [row] = await this.sql<{ nonce_hash: string; device_id_hash: string; expires_at: Date }[]>`
      update public.auth_nonces set used_at = ${this.d.now()}
       where id = ${nonceId} and used_at is null returning nonce_hash, device_id_hash, expires_at`;
    if (!row || row.device_id_hash !== ctx.deviceHash || row.expires_at.getTime() <= this.nowMs()) {
      this.d.log.event('auth.federated.failed', { request_id: ctx.requestId, check: 'nonce' });
      throw err(401, 'TOKEN_INVALID');
    }
    // The client keeps the raw nonce; we only stored its hash.
    if (!rawNonce || (await sha256Hex(rawNonce)) !== row.nonce_hash) {
      this.d.log.event('auth.federated.failed', { request_id: ctx.requestId, check: 'nonce' });
      throw err(401, 'TOKEN_INVALID');
    }
    return rawNonce;
  }

  private async verifyIdToken(provider: FederatedProvider, idToken: string, nonce: string, ctx: RequestContext) {
    try {
      return await this.d.idTokens.verify(provider, idToken, nonce);
    } catch (e) {
      if (e instanceof IdTokenError) {
        this.d.log.event('auth.federated.failed', { request_id: ctx.requestId, provider, check: e.check });
        throw err(401, 'TOKEN_INVALID');
      }
      this.d.log.event('auth.federated.failed', { request_id: ctx.requestId, provider, check: 'provider_error' });
      throw err(502, 'PROVIDER_ERROR');
    }
  }

  private async newTicket(kind: 'SIGN_IN_EXISTING' | 'CREATE_FEDERATED', t: VerifiedIdToken, ctx: RequestContext, extra: { givenName?: string | null; appleRefreshEnc?: string | null }) {
    const ticket = randomToken();
    await this.sql`
      insert into public.auth_tickets (ticket_hash, kind, provider, subject, email, is_private_relay, given_name, apple_refresh_token_enc, device_id_hash, expires_at)
      values (${await sha256Hex(ticket)}, ${kind}, ${t.provider}, ${t.subject}, ${t.verifiedEmail}, ${t.isPrivateRelay},
              ${extra.givenName ?? null}, ${extra.appleRefreshEnc ?? null}, ${ctx.deviceHash}, ${new Date(this.nowMs() + 2 * 60_000)})`;
    return ticket;
  }

  async federated(
    ctx: RequestContext,
    input: { provider: FederatedProvider; idToken: string; nonceId: string; nonce: string | null; intent: 'CREATE' | 'SIGN_IN'; givenName: string | null; authorizationCode: string | null },
  ): Promise<TokensBody> {
    const rawNonce = await this.takeNonce(input.nonceId, input.nonce, ctx);
    const token = await this.verifyIdToken(input.provider, input.idToken, rawNonce, ctx);
    await this.lookupLimits(ctx, token.verifiedEmail);

    // 1. Identity is (provider, sub). An email match only ever picks a message (spec 9.3).
    const [identity] = await this.sql<{ user_id: string; email_at_provider: string | null }[]>`
      select user_id, email_at_provider from public.auth_federated_identities
       where provider = ${token.provider} and subject = ${token.subject}`;
    if (identity) {
      const account = await this.findAccount(identity.user_id);
      if (!account) throw err(502, 'PROVIDER_ERROR');
      if (input.intent === 'CREATE') {
        const ticket = await this.newTicket('SIGN_IN_EXISTING', token, ctx, {});
        throw err(409, 'ACCOUNT_EXISTS', { ticket, method: account.method, email: account.email });
      }
      await this.syncFederatedEmail(account, token);
      return this.mint(account, ctx);
    }

    // 2. No identity. Use the provider's VERIFIED email only to choose the message.
    if (token.verifiedEmail) {
      const byEmail = await this.findAccountByEmail(token.verifiedEmail);
      if (byEmail) {
        if (byEmail.method === token.provider) {
          // Same email, same provider, different sub: never link or replace (spec 2.4 notes).
          this.d.log.event('auth.federated.mismatch', { request_id: ctx.requestId, provider: token.provider, account_id: byEmail.user_id });
          throw err(409, 'PROVIDER_ACCOUNT_MISMATCH');
        }
        throw err(409, 'WRONG_METHOD', { method: byEmail.method, is_private_relay: byEmail.is_private_relay, email: byEmail.email });
      }
    }

    // Apple: keep the refresh token from the first authorisation code (spec 9.2).
    const appleRefreshEnc = await this.appleRefreshToken(token, input.authorizationCode);
    const givenName = cleanName(input.givenName);

    if (input.intent === 'SIGN_IN') {
      const ticket = await this.newTicket('CREATE_FEDERATED', token, ctx, { givenName, appleRefreshEnc });
      throw err(404, 'ACCOUNT_NOT_FOUND', { ticket, email: token.verifiedEmail });
    }
    return this.createFederated(token, givenName, appleRefreshEnc, ctx);
  }

  private async appleRefreshToken(token: VerifiedIdToken, code: string | null) {
    if (token.provider !== 'APPLE' || !code) return null;
    try {
      const refresh = await this.d.apple.exchange(code, token.audience);
      return refresh ? await encryptText(this.d.config.tokenEncKey, refresh) : null;
    } catch {
      // Not fatal for sign-in; revocation on deletion then relies on the user (logged).
      this.d.log.event('auth.federated.apple_code_failed', { provider: 'APPLE' });
      return null;
    }
  }

  private async createFederated(token: VerifiedIdToken, givenName: string | null, appleRefreshEnc: string | null, ctx: RequestContext) {
    if (!token.verifiedEmail) {
      // Supabase Auth needs an email to hold the session; Apple and Google always send one
      // when the email scope is granted.
      throw err(401, 'TOKEN_INVALID');
    }
    const user = await this.createAuthUser({ email: token.verifiedEmail, emailConfirm: true, displayName: givenName });
    let account: Account | undefined;
    try {
      [account] = (await this.sql.begin(async (tx) => {
        const rows = await tx<Account[]>`
          insert into public.auth_accounts (user_id, email, method, status, confirmed_at, is_private_relay)
          values (${user.id}, ${token.verifiedEmail}, ${token.provider}, 'ACTIVE', ${this.d.now()},
                  ${token.isPrivateRelay || isPrivateRelayEmail(token.verifiedEmail!)}) returning *`;
        await tx`
          insert into public.auth_federated_identities (user_id, provider, subject, email_at_provider, is_private_relay, apple_refresh_token_enc)
          values (${user.id}, ${token.provider}, ${token.subject}, ${token.verifiedEmail}, ${token.isPrivateRelay}, ${appleRefreshEnc})`;
        return rows;
      })) as Account[];
    } catch (e) {
      await this.d.gotrue.deleteUser(user.id).catch(() => undefined);
      // A concurrent request created the same email or identity first.
      if ((e as { code?: string }).code === '23505') throw err(409, 'ACCOUNT_EXISTS');
      throw e;
    }
    this.d.log.event('auth.account.created', { request_id: ctx.requestId, account_id: account!.user_id, method: token.provider });
    return this.mint(account!, ctx, true);
  }

  /** Same sub, new email at the provider: update ours, never match on the new one first (1.4). */
  private async syncFederatedEmail(account: Account, token: VerifiedIdToken) {
    if (!token.verifiedEmail || normaliseEmail(token.verifiedEmail) === account.email_norm) return;
    try {
      await this.d.gotrue.updateUser(account.user_id, { email: token.verifiedEmail });
      await this.sql`update public.auth_accounts set email = ${token.verifiedEmail}, is_private_relay = ${token.isPrivateRelay} where user_id = ${account.user_id}`;
      await this.sql`update public.auth_federated_identities set email_at_provider = ${token.verifiedEmail} where user_id = ${account.user_id}`;
      account.email = token.verifiedEmail;
    } catch {
      // The new email belongs to another account (unique index): keep the old one.
    }
  }

  async exchangeTicket(ctx: RequestContext, ticket: string): Promise<TokensBody> {
    const [row] = await this.sql<
      { kind: string; provider: FederatedProvider; subject: string; email: string | null; is_private_relay: boolean; given_name: string | null; apple_refresh_token_enc: string | null; device_id_hash: string; expires_at: Date }[]
    >`update public.auth_tickets set used_at = ${this.d.now()}
       where ticket_hash = ${await sha256Hex(ticket)} and used_at is null returning *`;
    if (!row || row.device_id_hash !== ctx.deviceHash || row.expires_at.getTime() <= this.nowMs()) {
      throw err(410, 'TICKET_EXPIRED');
    }
    const token: VerifiedIdToken = { provider: row.provider, subject: row.subject, verifiedEmail: row.email, isPrivateRelay: row.is_private_relay, audience: '' };
    const [identity] = await this.sql<{ user_id: string }[]>`
      select user_id from public.auth_federated_identities where provider = ${row.provider} and subject = ${row.subject}`;
    if (row.kind === 'SIGN_IN_EXISTING') {
      const account = identity ? await this.findAccount(identity.user_id) : null;
      if (!account) throw err(410, 'TICKET_EXPIRED');
      return this.mint(account, ctx);
    }
    // CREATE_FEDERATED: re-check nothing appeared in the 2 minutes.
    if (identity) throw err(410, 'TICKET_EXPIRED');
    if (row.email) {
      const byEmail = await this.findAccountByEmail(row.email);
      if (byEmail) throw err(409, 'WRONG_METHOD', { method: byEmail.method, is_private_relay: byEmail.is_private_relay });
    }
    return this.createFederated(token, row.given_name, row.apple_refresh_token_enc, ctx);
  }

  // ---------------------------------------------------------------- 2.8 forgot password

  async requestReset(ctx: RequestContext, email: string) {
    // Per device/IP limits are visible; the per-email limit is silent (spec 3.2).
    await this.limit('reset:device', ctx.deviceHash, LOOKUP_LIMIT, HOUR);
    if (ctx.ipHash) await this.limit('reset:ip', ctx.ipHash, LOOKUP_LIMIT, HOUR);
    if (!isValidEmail(email)) return;
    const account = await this.findAccountByEmail(email);
    let outcome: 'sent_link' | 'sent_method_email' | 'none' | 'limited' = 'none';
    if (account) {
      try {
        await this.limit('reset:email', await this.keyHash('email', account.email_norm), 3, HOUR);
        if (account.method === 'PASSWORD') {
          const token = randomToken();
          const now = this.d.now();
          await this.sql`update public.auth_reset_tokens set superseded_at = ${now}
                          where user_id = ${account.user_id} and used_at is null and superseded_at is null`;
          await this.sql`insert into public.auth_reset_tokens (token_hash, user_id, expires_at)
                         values (${await sha256Hex(token)}, ${account.user_id}, ${new Date(now.getTime() + RESET_TTL_SECONDS * 1000)})`;
          await this.enqueueEmail('reset_link', { userId: account.user_id, email: account.email, deliverable: account.email_deliverable }, { link: `${this.d.config.resetLinkBase}#t=${token}` });
          outcome = 'sent_link';
        } else {
          await this.enqueueEmail('reset_uses_provider', { userId: account.user_id, email: account.email, deliverable: account.email_deliverable }, { provider: account.method });
          outcome = 'sent_method_email';
        }
      } catch (e) {
        if ((e as { code?: string }).code !== 'RATE_LIMITED') throw e;
        outcome = 'limited';
      }
    }
    this.d.log.event('auth.reset.requested', { request_id: ctx.requestId, outcome, device_id_hash: ctx.deviceHash });
  }

  private async liveResetToken(token: string) {
    const [row] = await this.sql<{ user_id: string; expires_at: Date; used_at: Date | null; superseded_at: Date | null }[]>`
      select user_id, expires_at, used_at, superseded_at from public.auth_reset_tokens where token_hash = ${await sha256Hex(token)}`;
    if (!row || row.used_at || row.superseded_at || row.expires_at.getTime() <= this.nowMs()) {
      throw err(410, 'RESET_LINK_INVALID');
    }
    const account = await this.findAccount(row.user_id);
    if (!account || account.method !== 'PASSWORD') throw err(410, 'RESET_LINK_INVALID');
    return account;
  }

  async verifyReset(token: string) {
    const account = await this.liveResetToken(token);
    return { email_masked: false, email: account.email };
  }

  async completeReset(ctx: RequestContext, token: string, newPassword: string) {
    const account = await this.liveResetToken(token);
    await this.validateNewPassword(newPassword, account.email);
    // Claim the token first so it can only ever be used once.
    const claimed = await this.sql`
      update public.auth_reset_tokens set used_at = ${this.d.now()}
       where token_hash = ${await sha256Hex(token)} and used_at is null and superseded_at is null returning user_id`;
    if (!claimed.length) throw err(410, 'RESET_LINK_INVALID');
    const version = await this.setPassword(account.user_id, newPassword);
    if (account.status === 'UNCONFIRMED') await this.d.gotrue.updateUser(account.user_id, { emailConfirm: true });
    const now = this.d.now();
    const revoked = await this.sql.begin(async (tx) => {
      await tx`update public.auth_accounts
                  set pepper_version = ${version}, password_changed_at = ${now},
                      step_up_required = false, step_up_set_at = null,
                      status = case when status = 'UNCONFIRMED' then 'ACTIVE' else status end,
                      confirmed_at = coalesce(confirmed_at, ${now})
                where user_id = ${account.user_id}`;
      await tx`update public.auth_reset_tokens set superseded_at = ${now}
                where user_id = ${account.user_id} and used_at is null and superseded_at is null`;
      await tx`update public.auth_one_time_codes set superseded_at = ${now}
                where user_id = ${account.user_id} and consumed_at is null and superseded_at is null`;
      const rows = await tx`delete from auth.sessions where user_id = ${account.user_id} returning id`;
      return rows.length;
    });
    await this.enqueueEmail('password_changed', { userId: account.user_id, email: account.email, deliverable: account.email_deliverable }, { changed_at: now.toISOString() });
    this.d.log.event('auth.reset.completed', { request_id: ctx.requestId, account_id: account.user_id, count: revoked });
    this.d.log.event('auth.session.revoked', { account_id: account.user_id, reason: 'password_reset', count: revoked });
  }

  // ---------------------------------------------------------------- 3.2 breach range

  async breachRange(ctx: RequestContext, prefix: string): Promise<string> {
    if (!/^[0-9A-Fa-f]{5}$/.test(prefix)) throw err(400, 'SERVER_ERROR');
    await this.limit('breach-range', ctx.deviceHash, 60, 60);
    const rows = this.d.config.breachCheck
      ? await this.sql<{ suffix: string; breach_count: number }[]>`
          select suffix, breach_count from public.auth_breached_hashes where prefix = ${prefix.toUpperCase()}`
      : [];
    // Pad to a constant size with random suffixes and count 0, so the response size says
    // nothing about how many real matches there are (spec 3.2).
    const lines = rows.map((r) => `${r.suffix}:${r.breach_count}`);
    const PAD = 800;
    while (lines.length < PAD) {
      lines.push(`${randomHex(35)}:0`);
    }
    return lines.sort().join('\n');
  }

  // ---------------------------------------------------------------- tokens and sessions

  async refresh(refreshToken: string): Promise<TokensBody> {
    try {
      const s = await this.d.gotrue.refresh(refreshToken);
      const claims = unsafeJwtPayload(s.access_token);
      const scope = claims.lifeos_scope === 'PENDING_DELETION' ? 'PENDING_DELETION' : 'FULL';
      return {
        tokens: { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at ?? Math.floor(this.nowMs() / 1000) + s.expires_in, token_type: 'bearer' },
        scope,
        account_created: false,
      };
    } catch (e) {
      if (e instanceof GoTrueError) {
        if (e.errorCode === 'refresh_token_already_used') {
          this.d.log.event('auth.refresh.reuse', { reason: e.errorCode });
          throw err(401, 'SESSION_REVOKED');
        }
        if (e.status === 401 && /expired/.test(e.errorCode)) throw err(401, 'SESSION_EXPIRED');
        if (e.status === 400 || e.status === 401 || e.status === 403 || e.status === 404) throw err(401, 'SESSION_REVOKED');
      }
      throw e;
    }
  }

  /** Authenticates a Bearer token: signature AND live session, via Supabase Auth (spec 8.1). */
  async authenticate(accessToken: string | null): Promise<Caller> {
    if (!accessToken) throw err(401, 'SESSION_REVOKED');
    try {
      await this.d.gotrue.getUser(accessToken);
    } catch {
      throw err(401, 'SESSION_REVOKED');
    }
    const claims = unsafeJwtPayload(accessToken);
    const userId = String(claims.sub);
    const account = await this.findAccount(userId);
    if (!account) throw err(401, 'SESSION_REVOKED');
    return { userId, sessionId: String(claims.session_id), accessToken, account };
  }

  async signOutCurrent(caller: Caller) {
    await this.deleteSession(caller.sessionId);
    this.d.log.event('auth.session.revoked', { account_id: caller.userId, reason: 'sign_out' });
  }

  async security(caller: Caller) {
    const a = caller.account;
    const [row] = await this.sql<{ n: number }[]>`
      select count(*)::int as n from public.auth_session_meta m join auth.sessions s on s.id = m.session_id
       where m.user_id = ${caller.userId}`;
    const n = row?.n ?? 0;
    return {
      method: a.method,
      email: a.email,
      is_private_relay: a.is_private_relay,
      email_deliverable: a.email_deliverable,
      password_changed_at: a.password_changed_at?.toISOString() ?? null,
      device_count: n,
      coming_later: ['TWO_STEP_VERIFICATION', 'PASSKEYS', 'CHANGE_SIGN_IN_METHOD'],
    };
  }

  async listSessions(caller: Caller) {
    const rows = await this.sql<{ id: string; label: string; platform: string; coarse_location: string | null; last_active_at: Date }[]>`
      select s.id, m.label, m.platform, m.coarse_location,
             greatest(coalesce(s.refreshed_at, s.created_at), s.updated_at, m.created_at) as last_active_at
        from auth.sessions s join public.auth_session_meta m on m.session_id = s.id
       where s.user_id = ${caller.userId}
       order by (s.id = ${caller.sessionId}) desc, last_active_at desc`;
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      platform: r.platform,
      coarse_location: r.coarse_location,
      last_active_at: new Date(r.last_active_at).toISOString(),
      is_current: r.id === caller.sessionId,
    }));
  }

  async revokeSession(caller: Caller, sessionId: string) {
    if (!/^[0-9a-f-]{36}$/.test(sessionId)) throw err(404, 'SESSION_NOT_FOUND');
    const rows = await this.sql`delete from auth.sessions where id = ${sessionId} and user_id = ${caller.userId} returning id`;
    if (!rows.length) throw err(404, 'SESSION_NOT_FOUND');
    this.d.log.event('auth.session.revoked', { account_id: caller.userId, reason: 'device_removed' });
  }

  async revokeAll(caller: Caller) {
    const n = await this.deleteSessions(caller.userId);
    this.d.log.event('auth.session.revoked', { account_id: caller.userId, reason: 'sign_out_everywhere', count: n });
  }

  // ---------------------------------------------------------------- S-2 change password

  async changePassword(ctx: RequestContext, caller: Caller, current: string, next: string) {
    const a = caller.account;
    if (a.method !== 'PASSWORD') throw err(409, 'NO_PASSWORD');
    const pausedUntil = await this.activePause(a.email_norm, ctx);
    if (pausedUntil) throw this.pausedError(pausedUntil);
    const check = await this.verifyPassword(a, current, ctx);
    if (check !== 'unconfirmed') await this.deleteSession(String(unsafeJwtPayload(check.access_token).session_id));
    if (normalisePassword(current) === normalisePassword(next)) throw err(422, 'PASSWORD_SAME_AS_CURRENT');
    await this.validateNewPassword(next, a.email);
    const version = await this.setPassword(a.user_id, next);
    const now = this.d.now();
    await this.sql`update public.auth_accounts set pepper_version = ${version}, password_changed_at = ${now} where user_id = ${a.user_id}`;
    const n = await this.deleteSessions(a.user_id, caller.sessionId);
    await this.enqueueEmail('password_changed', { userId: a.user_id, email: a.email, deliverable: a.email_deliverable }, { changed_at: now.toISOString() });
    this.d.log.event('auth.session.revoked', { account_id: a.user_id, reason: 'password_changed', count: n });
  }

  // ---------------------------------------------------------------- S-5 delete account

  async reauth(ctx: RequestContext, caller: Caller, input: { password?: string | null; provider?: FederatedProvider | null; idToken?: string | null; nonceId?: string | null; nonce?: string | null }) {
    const a = caller.account;
    if (a.method === 'PASSWORD') {
      if (!input.password) throw err(401, 'WRONG_PASSWORD');
      const pausedUntil = await this.activePause(a.email_norm, ctx);
      if (pausedUntil) throw this.pausedError(pausedUntil);
      const s = await this.verifyPassword(a, input.password, ctx);
      if (s !== 'unconfirmed') await this.deleteSession(String(unsafeJwtPayload(s.access_token).session_id));
    } else {
      if (!input.idToken || !input.nonceId || input.provider !== a.method) throw err(401, 'TOKEN_INVALID');
      const raw = await this.takeNonce(input.nonceId, input.nonce ?? null, ctx);
      const t = await this.verifyIdToken(a.method, input.idToken, raw, ctx);
      const [identity] = await this.sql`select 1 from public.auth_federated_identities
                                          where user_id = ${a.user_id} and provider = ${t.provider} and subject = ${t.subject}`;
      if (!identity) throw err(401, 'TOKEN_INVALID');
    }
    const token = randomToken();
    await this.sql`insert into public.auth_reauth_tokens (token_hash, user_id, session_id, scope, expires_at)
                   values (${await sha256Hex(token)}, ${a.user_id}, ${caller.sessionId}, 'DELETE_ACCOUNT', ${new Date(this.nowMs() + 5 * 60_000)})`;
    return { reauth_token: token };
  }

  async requestDeletion(caller: Caller, reauthToken: string | null, confirmation: string | null) {
    if (confirmation !== 'DELETE') throw err(422, 'CONFIRMATION_MISMATCH');
    if (!reauthToken) throw err(401, 'REAUTH_REQUIRED');
    const rows = await this.sql`
      update public.auth_reauth_tokens set used_at = ${this.d.now()}
       where token_hash = ${await sha256Hex(reauthToken)} and user_id = ${caller.userId} and session_id = ${caller.sessionId}
         and scope = 'DELETE_ACCOUNT' and used_at is null and expires_at > ${this.d.now()} returning user_id`;
    if (!rows.length) throw err(401, 'REAUTH_REQUIRED');
    const now = this.d.now();
    const due = new Date(now.getTime() + DELETION_GRACE_DAYS * 24 * HOUR * 1000);
    await this.sql.begin(async (tx) => {
      await tx`update public.auth_accounts set status = 'PENDING_DELETION' where user_id = ${caller.userId}`;
      await tx`insert into public.auth_deletion_requests (user_id, requested_at, due_at) values (${caller.userId}, ${now}, ${due})
               on conflict (user_id) where cancelled_at is null and completed_at is null do nothing`;
    });
    const n = await this.deleteSessions(caller.userId, caller.sessionId);
    const a = caller.account;
    await this.enqueueEmail('deletion_requested', { userId: a.user_id, email: a.email, deliverable: a.email_deliverable }, { requested_at: now.toISOString(), due_at: due.toISOString() });
    this.d.log.event('auth.deletion.requested', { account_id: a.user_id, count: n });
    return { deletion_due_at: (await this.deletionDue(caller.userId))?.toISOString() ?? due.toISOString() };
  }

  private async deletionDue(userId: string): Promise<Date | null> {
    const [row] = await this.sql<{ due_at: Date }[]>`
      select due_at from public.auth_deletion_requests where user_id = ${userId} and cancelled_at is null and completed_at is null`;
    return row?.due_at ?? null;
  }

  async getDeletion(caller: Caller) {
    const due = await this.deletionDue(caller.userId);
    if (!due) throw err(409, 'NOT_PENDING');
    return { deletion_due_at: due.toISOString() };
  }

  async cancelDeletion(caller: Caller) {
    const rows = await this.sql`
      update public.auth_deletion_requests set cancelled_at = ${this.d.now()}
       where user_id = ${caller.userId} and cancelled_at is null and completed_at is null returning id`;
    if (!rows.length) throw err(409, 'NOT_PENDING');
    await this.sql`update public.auth_accounts set status = 'ACTIVE' where user_id = ${caller.userId}`;
    const a = caller.account;
    await this.enqueueEmail('deletion_cancelled', { userId: a.user_id, email: a.email, deliverable: a.email_deliverable }, {});
    this.d.log.event('auth.deletion.cancelled', { account_id: a.user_id });
  }

  // ---------------------------------------------------------------- 9.4 Apple notifications

  async appleEvent(event: { type: string; sub: string; eventKey: string }) {
    const inserted = await this.sql`
      insert into public.auth_apple_events (event_key, event_type, subject) values (${event.eventKey}, ${event.type}, ${event.sub})
      on conflict (event_key) do nothing returning event_key`;
    if (!inserted.length) return 'duplicate';
    const [identity] = await this.sql<{ user_id: string }[]>`
      select user_id from public.auth_federated_identities where provider = 'APPLE' and subject = ${event.sub}`;
    if (identity) {
      const userId = identity.user_id;
      switch (event.type) {
        case 'consent-revoked':
          await this.deleteSessions(userId);
          this.d.log.event('auth.session.revoked', { account_id: userId, reason: 'apple_consent_revoked' });
          break;
        case 'account-delete': {
          const now = this.d.now();
          await this.deleteSessions(userId);
          await this.sql`update public.auth_accounts set status = 'PENDING_DELETION' where user_id = ${userId}`;
          await this.sql`insert into public.auth_deletion_requests (user_id, requested_at, due_at, source)
                         values (${userId}, ${now}, ${new Date(now.getTime() + DELETION_GRACE_DAYS * 24 * HOUR * 1000)}, 'apple_account_delete')
                         on conflict (user_id) where cancelled_at is null and completed_at is null do nothing`;
          this.d.log.event('auth.deletion.requested', { account_id: userId, reason: 'apple_account_delete' });
          break;
        }
        case 'email-disabled':
          await this.sql`update public.auth_accounts set email_deliverable = false where user_id = ${userId}`;
          break;
        case 'email-enabled':
          await this.sql`update public.auth_accounts set email_deliverable = true where user_id = ${userId}`;
          break;
      }
    }
    await this.sql`update public.auth_apple_events set processed_at = ${this.d.now()} where event_key = ${event.eventKey}`;
    this.d.log.event('auth.webhook.apple.processed', { event_type: event.type, outcome: identity ? 'applied' : 'unknown_sub' });
    return 'processed';
  }
}

function cleanName(name: string | null): string | null {
  if (!name) return null;
  const n = name.trim().slice(0, 60);
  return n || null;
}

function randomHex(n: number): string {
  const bytes = new Uint8Array(Math.ceil(n / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, n).toUpperCase();
}
