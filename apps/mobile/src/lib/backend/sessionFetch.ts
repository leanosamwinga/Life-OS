// What the app does when the Data API (PostgREST) or an edge function turns down the session
// (spec 3.3). Every Data API call goes through this fetch, so the rules live in one place:
//
//   SESSION_REVOKED / SESSION_EXPIRED   from public.check_request (signed out elsewhere, the
//   or a token PostgREST can't verify   session was deleted, the database was reset …)
//                                       → forget the session on this device → 0a, no message.
//   JWT expired (PGRST303), or 401      the server thinks the access token has run out (the phone's
//   from a JWT-checked edge function    clock is behind): refresh once through auth-api and retry.
//   PENDING_DELETION                    → ask auth-api whether the account is being deleted; if so
//                                       the scope becomes PENDING_DELETION and the app shows S-5h.
//
// Network failures and 5xx are left alone: the caller shows "Couldn't load your data" with a
// working "Try again".
import type { SessionScope } from './types';

/** The part of AuthClient this needs (src/lib/auth/client.ts). */
export interface SessionControl {
  endSession(): Promise<void>;
  /** A fresh access token, or null if there's none (web, signed out, refresh refused). */
  refreshNow(): Promise<string | null>;
  recheckScope(): Promise<SessionScope | null>;
}

export const SESSION_ENDED_CODES = new Set(['SESSION_REVOKED', 'SESSION_EXPIRED']);
/** PostgREST: no/invalid JWT (PGRST301, PGRST302). */
const BAD_JWT_CODES = new Set(['PGRST301', 'PGRST302']);
const JWT_EXPIRED_CODE = 'PGRST303';

async function errorCode(res: Response): Promise<string | null> {
  try {
    const body = (await res.clone().json()) as {
      code?: unknown;
      error?: { code?: unknown };
      message?: unknown;
      msg?: unknown;
    } | null;
    const code = body?.code ?? body?.error?.code;
    if (typeof code === 'string') return code;
    const message = String(body?.message ?? body?.msg ?? '');
    return /jwt/i.test(message) ? 'INVALID_JWT' : null;
  } catch {
    return null;
  }
}

function withToken(init: RequestInit | undefined, token: string): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return { ...init, headers };
}

export function sessionAwareFetch(session: SessionControl, base: typeof fetch): typeof fetch {
  return async (input, init) => {
    const res = await base(input, init);
    if (res.status !== 401 && res.status !== 403) return res;
    const code = await errorCode(res);
    if (code && (SESSION_ENDED_CODES.has(code) || BAD_JWT_CODES.has(code))) {
      await session.endSession();
      return res;
    }
    if (code === JWT_EXPIRED_CODE || (res.status === 401 && code === 'INVALID_JWT')) {
      const token = await session.refreshNow();
      return token ? base(input, withToken(init, token)) : res;
    }
    if (code === 'PENDING_DELETION') {
      await session.recheckScope().catch(() => null);
      return res;
    }
    return res;
  };
}
