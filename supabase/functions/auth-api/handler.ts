// auth-api router: spec 3.2 endpoints under /v1. Supabase serves the function at
// /functions/v1/auth-api, so a request path looks like /auth-api/v1/accounts.
import type { FederatedProvider } from '@life-os/core';
import { buildContext, type RequestContext } from './context.ts';
import type { DeviceCheck } from './device-check.ts';
import { ApiError, corsHeaders, err, errorResponse, json, padTo, readJson, str } from './http.ts';
import type { AuthLogger } from './log.ts';
import type { AuthService, Caller } from './service.ts';
import { exportZip, exportJson } from './export.ts';
import type { AppleWebhookVerifier } from './apple.ts';
import type { Sql } from 'postgres';
import type { AuthConfig } from './config.ts';
import { timingSafeEqual } from './crypto.ts';

export interface HandlerDeps {
  config: AuthConfig;
  service: AuthService;
  deviceCheck: DeviceCheck;
  log: AuthLogger;
  sql: Sql;
  appleWebhook: AppleWebhookVerifier;
  runJobs(): Promise<Record<string, number>>;
  newRequestId(): string;
}

type Route = (req: Request, ctx: () => Promise<RequestContext>, body: Record<string, unknown>, raw: string) => Promise<Response>;

const PROVIDERS = new Set(['APPLE', 'GOOGLE']);

/** Look-up endpoints padded to the timing floor whatever the outcome (spec 6.3). */
const PADDED = new Set(['POST /v1/accounts', 'POST /v1/sessions/password', 'POST /v1/password-resets', 'POST /v1/sessions/federated']);

/** The only things a PENDING_DELETION account can do (spec 8.1). */
const PENDING_ALLOWED = new Set(['GET /v1/me/deletion', 'DELETE /v1/me/deletion', 'POST /v1/sessions/current/sign-out', 'GET /v1/me/export']);

function routeKey(method: string, path: string): { key: string; param: string | null } {
  const m = path.match(/^\/v1\/me\/sessions\/([0-9a-f-]{36})$/);
  if (m) return { key: `${method} /v1/me/sessions/:id`, param: m[1]! };
  const b = path.match(/^\/v1\/password\/breach-range\/([0-9A-Fa-f]{5})$/);
  if (b) return { key: `${method} /v1/password/breach-range/:prefix`, param: b[1]! };
  return { key: `${method} ${path}`, param: null };
}

export function createHandler(deps: HandlerDeps) {
  const { service } = deps;

  const bearer = (req: Request) => {
    const h = req.headers.get('authorization') ?? '';
    return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : null;
  };

  const authed = async (req: Request, key: string): Promise<Caller> => {
    const caller = await service.authenticate(bearer(req));
    if (caller.account.status === 'PENDING_DELETION' && !PENDING_ALLOWED.has(key)) {
      throw err(403, 'PENDING_DELETION');
    }
    return caller;
  };

  const tokensOrCookies = (body: unknown, status = 200) => json(status, body);

  const routes: Record<string, (req: Request, ctx: () => Promise<RequestContext>, body: Record<string, unknown>, param: string | null, key: string) => Promise<Response>> = {
    'POST /v1/auth/nonce': async (_req, ctx) => json(200, await service.newNonce(await ctx())),

    'GET /v1/password/breach-range/:prefix': async (_req, ctx, _b, prefix) =>
      new Response(await service.breachRange(await ctx(), prefix!), {
        status: 200,
        headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
      }),

    'POST /v1/accounts': async (_req, ctx, b) =>
      json(202, await service.createAccount(await ctx(), str(b, 'email') ?? '', str(b, 'password') ?? '')),

    'POST /v1/accounts/confirm': async (_req, ctx, b) =>
      tokensOrCookies(await service.confirmEmail(await ctx(), str(b, 'challenge_id') ?? '', str(b, 'code') ?? '')),

    'POST /v1/codes/resend': async (_req, ctx, b) => json(202, await service.resendCode(await ctx(), str(b, 'challenge_id') ?? '')),

    'POST /v1/sessions/password': async (_req, ctx, b) =>
      tokensOrCookies(await service.signInWithPassword(await ctx(), str(b, 'email') ?? '', str(b, 'password') ?? '')),

    'POST /v1/sessions/step-up': async (_req, ctx, b) =>
      tokensOrCookies(await service.stepUp(await ctx(), str(b, 'challenge_id') ?? '', str(b, 'code') ?? '')),

    'POST /v1/sessions/federated': async (_req, ctx, b) => {
      const provider = str(b, 'provider');
      const intent = str(b, 'intent');
      if (!provider || !PROVIDERS.has(provider) || (intent !== 'CREATE' && intent !== 'SIGN_IN')) throw err(401, 'TOKEN_INVALID');
      return tokensOrCookies(
        await service.federated(await ctx(), {
          provider: provider as FederatedProvider,
          idToken: str(b, 'id_token') ?? '',
          nonceId: str(b, 'nonce_id') ?? '',
          nonce: str(b, 'nonce'),
          intent,
          givenName: str(b, 'given_name'),
          authorizationCode: str(b, 'authorization_code'),
        }),
      );
    },

    'POST /v1/sessions/ticket': async (_req, ctx, b) => tokensOrCookies(await service.exchangeTicket(await ctx(), str(b, 'ticket') ?? '')),

    'POST /v1/password-resets': async (_req, ctx, b) => {
      await service.requestReset(await ctx(), str(b, 'email') ?? '');
      return json(202, {});
    },

    'POST /v1/password-resets/verify': async (_req, _ctx, b) => json(200, await service.verifyReset(str(b, 'token') ?? '')),

    'POST /v1/password-resets/complete': async (_req, ctx, b) => {
      await service.completeReset(await ctx(), str(b, 'token') ?? '', str(b, 'new_password') ?? '');
      return json(204, null);
    },

    'POST /v1/tokens/refresh': async (_req, _ctx, b) => tokensOrCookies(await service.refresh(str(b, 'refresh_token') ?? '')),

    'POST /v1/sessions/current/sign-out': async (req, _ctx, _b, _p, key) => {
      try {
        await service.signOutCurrent(await authed(req, key));
      } catch (e) {
        // Always succeeds locally (spec 3.2).
        if (!(e instanceof ApiError)) throw e;
      }
      return json(204, null);
    },

    'GET /v1/me/security': async (req, _ctx, _b, _p, key) => json(200, await service.security(await authed(req, key))),

    'POST /v1/me/password': async (req, ctx, b, _p, key) => {
      const caller = await authed(req, key);
      await service.changePassword(await ctx(), caller, str(b, 'current_password') ?? '', str(b, 'new_password') ?? '');
      return json(204, null);
    },

    'GET /v1/me/sessions': async (req, _ctx, _b, _p, key) => json(200, await service.listSessions(await authed(req, key))),

    'DELETE /v1/me/sessions/:id': async (req, _ctx, _b, id, key) => {
      await service.revokeSession(await authed(req, key), id!);
      return json(204, null);
    },

    'POST /v1/me/sessions/revoke-all': async (req, _ctx, _b, _p, key) => {
      await service.revokeAll(await authed(req, key));
      return json(204, null);
    },

    'POST /v1/me/reauth': async (req, ctx, b, _p, key) => {
      const caller = await authed(req, key);
      const provider = str(b, 'provider');
      return json(
        200,
        await service.reauth(await ctx(), caller, {
          password: str(b, 'password'),
          provider: provider && PROVIDERS.has(provider) ? (provider as FederatedProvider) : null,
          idToken: str(b, 'id_token'),
          nonceId: str(b, 'nonce_id'),
          nonce: str(b, 'nonce'),
        }),
      );
    },

    'POST /v1/me/deletion': async (req, _ctx, b, _p, key) =>
      json(202, await service.requestDeletion(await authed(req, key), str(b, 'reauth_token'), str(b, 'confirmation'))),

    'GET /v1/me/deletion': async (req, _ctx, _b, _p, key) => json(200, await service.getDeletion(await authed(req, key))),

    'DELETE /v1/me/deletion': async (req, _ctx, _b, _p, key) => {
      await service.cancelDeletion(await authed(req, key));
      return json(204, null);
    },

    'GET /v1/me/export': async (req, _ctx, _b, _p, key) => {
      const caller = await authed(req, key);
      const format = new URL(req.url).searchParams.get('format') === 'csv' ? 'csv' : 'json';
      const stamp = new Date().toISOString().slice(0, 10);
      if (format === 'csv') {
        return new Response((await exportZip(deps.sql, caller.userId)) as BodyInit, {
          status: 200,
          headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="life-os-export-${stamp}.zip"`,
            'Cache-Control': 'no-store',
          },
        });
      }
      return new Response(JSON.stringify(await exportJson(deps.sql, caller.userId), null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="life-os-export-${stamp}.json"`,
          'Cache-Control': 'no-store',
        },
      });
    },

    'POST /v1/webhooks/apple': async (_req, _ctx, b) => {
      const payload = str(b, 'payload');
      let event;
      try {
        event = await deps.appleWebhook.verify(payload ?? '');
      } catch {
        deps.log.event('auth.webhook.apple.rejected', { reason: 'signature_or_claims' });
        return json(400, { error: { code: 'TOKEN_INVALID', retry_after_seconds: null, details: null } });
      }
      await service.appleEvent(event);
      return json(200, {});
    },

    'POST /v1/internal/jobs/run': async (req) => {
      const secret = req.headers.get('x-job-secret') ?? '';
      if (!deps.config.jobSecret || !timingSafeEqual(secret, deps.config.jobSecret)) throw err(401, 'SESSION_REVOKED');
      return json(200, await deps.runJobs());
    },
  };

  /** Endpoints with no signed-in user: every one needs a device ID and the device check. */
  const UNAUTHENTICATED = new Set([
    'POST /v1/auth/nonce',
    'GET /v1/password/breach-range/:prefix',
    'POST /v1/accounts',
    'POST /v1/accounts/confirm',
    'POST /v1/codes/resend',
    'POST /v1/sessions/password',
    'POST /v1/sessions/step-up',
    'POST /v1/sessions/federated',
    'POST /v1/sessions/ticket',
    'POST /v1/password-resets',
    'POST /v1/password-resets/verify',
    'POST /v1/password-resets/complete',
  ]);

  return async function handle(req: Request): Promise<Response> {
    const startedAt = Date.now();
    const requestId = deps.newRequestId();
    const origin = req.headers.get('origin');
    const cors = corsHeaders(origin, deps.config.allowedOrigins);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(req.url);
    const path = url.pathname.replace(/^.*?(\/v1\/)/, '/v1/');
    const { key, param } = routeKey(req.method, path);
    const route = routes[key];
    const padded = PADDED.has(key);
    try {
      if (!route) throw err(404, 'SERVER_ERROR');
      const raw = req.method === 'GET' || req.method === 'DELETE' ? '' : await req.clone().text();
      const body = await readJson(req);
      let ctxPromise: Promise<RequestContext> | null = null;
      const ctx = () => {
        ctxPromise ??= (async () => {
          const result = UNAUTHENTICATED.has(key) ? await deps.deviceCheck.verify(req, raw) : 'off';
          if (result === 'failed') {
            deps.log.event('auth.attestation.failed', { request_id: requestId, route: key.split(' ')[1] ?? '' });
            throw err(403, 'DEVICE_CHECK_FAILED');
          }
          return buildContext(req, deps.config.keyHashKey, requestId, result, startedAt);
        })();
        return ctxPromise;
      };
      // Device check before anything else on unauthenticated routes (spec 2.3.3.1).
      if (UNAUTHENTICATED.has(key)) await ctx();
      const res = await route(req, ctx, body, param, key);
      if (padded) await padTo(startedAt, deps.config.timingFloorMs, deps.config.timingJitterMs);
      for (const [h, v] of Object.entries(cors)) res.headers.set(h, v);
      return res;
    } catch (e) {
      if (padded) await padTo(startedAt, deps.config.timingFloorMs, deps.config.timingJitterMs);
      if (e instanceof ApiError) return errorResponse(e, requestId, cors);
      deps.log.event('auth.error', { request_id: requestId, route: key.split(' ')[1] ?? '', reason: (e as Error)?.name ?? 'Error' });
      return errorResponse(err(500, 'SERVER_ERROR'), requestId, cors);
    }
  };
}

export type { Route };
