import { err } from './http.ts';
import { hmacHex, sha256Hex } from './crypto.ts';
import { clientIp, ipPrefix, type DeviceCheckResult } from './device-check.ts';

export type Platform = 'ios' | 'android' | 'web';

export interface RequestContext {
  requestId: string;
  /** SHA-256 of the client's random device_id (spec 1.1). */
  deviceHash: string;
  /** HMAC of the IP (never stored or logged in full). Null if unknown. */
  ipHash: string | null;
  ipPrefix: string | null;
  platform: Platform;
  /** "iPhone 15", "MacBook · Safari" — built by the client from platform and model. */
  label: string;
  appVersion: string | null;
  deviceCheck: DeviceCheckResult;
  startedAt: number;
}

const DEVICE_ID = /^[A-Za-z0-9_-]{16,64}$/;

export async function buildContext(
  req: Request,
  keyHashKey: string,
  requestId: string,
  deviceCheck: DeviceCheckResult,
  startedAt: number,
): Promise<RequestContext> {
  const deviceId = req.headers.get('x-device-id') ?? '';
  if (!DEVICE_ID.test(deviceId)) throw err(403, 'DEVICE_CHECK_FAILED');
  const p = req.headers.get('x-device-platform');
  const platform: Platform = p === 'ios' || p === 'android' ? p : 'web';
  const ip = clientIp(req);
  const rawLabel = (req.headers.get('x-device-label') ?? '').replace(/[^\p{L}\p{N} ·.,()'-]/gu, '').slice(0, 60);
  return {
    requestId,
    deviceHash: await sha256Hex(deviceId),
    ipHash: ip ? await hmacHex(keyHashKey, `ip:${ip}`) : null,
    ipPrefix: ipPrefix(ip),
    platform,
    label: rawLabel || (platform === 'ios' ? 'iPhone' : platform === 'android' ? 'Android phone' : 'Web browser'),
    appVersion: (req.headers.get('x-client-info') ?? '').slice(0, 40) || null,
    deviceCheck,
    startedAt,
  };
}
