import { AUTH_ERROR_CODES, type AuthErrorCode, type SignInMethod } from '@life-os/core';

/**
 * Codes the app can see: the API's (spec 3.2), a network failure, and three development-only
 * notes: DEV_BUILD_REQUIRED (Google tapped in Expo Go, expoGo.ts) and WEB_APPLE_SETUP /
 * WEB_GOOGLE_SETUP (Apple/Google tapped on a local web build without their ids, webProviders.ts).
 */
export type AuthCode =
  AuthErrorCode | 'NETWORK' | 'DEV_BUILD_REQUIRED' | 'WEB_APPLE_SETUP' | 'WEB_GOOGLE_SETUP';

export interface AuthErrorDetails {
  method?: SignInMethod;
  is_private_relay?: boolean;
  email?: string;
  challenge_id?: string;
  ticket?: string;
}

/** An auth-api error. `message` is never shown: screens map `code` to spec copy (copy.ts). */
export class AuthError extends Error {
  override name = 'AuthError';
  constructor(
    readonly code: AuthCode,
    readonly details: AuthErrorDetails = {},
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(code);
  }
}

const KNOWN = new Set<string>(AUTH_ERROR_CODES);

/** Turns any thrown value into an AuthError; unknown codes become SERVER_ERROR (spec 3.1). */
export function toAuthError(err: unknown): AuthError {
  if (err instanceof AuthError) return err;
  if (err instanceof TypeError) return new AuthError('NETWORK');
  return new AuthError('SERVER_ERROR');
}

export function fromBody(status: number, body: unknown): AuthError {
  const e = (
    body as {
      error?: {
        code?: string;
        details?: AuthErrorDetails | null;
        retry_after_seconds?: number | null;
      };
    } | null
  )?.error;
  const code = e?.code && KNOWN.has(e.code) ? (e.code as AuthErrorCode) : 'SERVER_ERROR';
  return new AuthError(
    status >= 500 && code !== 'PROVIDER_ERROR' ? 'SERVER_ERROR' : code,
    e?.details ?? {},
    e?.retry_after_seconds ?? null,
  );
}
