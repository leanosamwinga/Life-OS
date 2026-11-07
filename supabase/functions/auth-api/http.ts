import type { AuthErrorCode } from '@life-os/core';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: AuthErrorCode,
    readonly details: Record<string, unknown> | null = null,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(code);
  }
}

export const err = (
  status: number,
  code: AuthErrorCode,
  details: Record<string, unknown> | null = null,
  retryAfterSeconds: number | null = null,
) => new ApiError(status, code, details, retryAfterSeconds);

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

export function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers':
      'authorization, apikey, content-type, x-client-info, x-device-id, x-device-platform, x-device-label, x-app-attest, x-app-attest-key-id, x-turnstile, x-play-integrity, idempotency-key, x-csrf-token',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    Vary: 'Origin',
  };
}

export function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { ...SECURITY_HEADERS, ...extra },
  });
}

export function errorResponse(
  e: ApiError,
  requestId: string,
  extra: Record<string, string> = {},
): Response {
  const headers = { ...extra };
  if (e.retryAfterSeconds != null) headers['Retry-After'] = String(e.retryAfterSeconds);
  return json(
    e.status,
    {
      error: { code: e.code, retry_after_seconds: e.retryAfterSeconds, details: e.details },
      request_id: requestId,
    },
    headers,
  );
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  if (req.method === 'GET' || req.method === 'DELETE') return {};
  const text = await req.text();
  if (text.length > 16_384) throw err(413, 'SERVER_ERROR');
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw err(400, 'SERVER_ERROR');
  }
}

export function str(body: Record<string, unknown>, key: string): string | null {
  const v = body[key];
  return typeof v === 'string' ? v : null;
}

/**
 * Waits until at least `floorMs` (± jitter) has passed since `startedAt`, so look-up endpoints
 * take the same time whether or not an account exists (spec 6.3).
 */
export async function padTo(
  startedAt: number,
  floorMs: number,
  jitterMs: number,
  now = () => Date.now(),
) {
  if (floorMs <= 0) return;
  const target = floorMs + (Math.random() * 2 - 1) * jitterMs;
  const wait = startedAt + target - now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}
