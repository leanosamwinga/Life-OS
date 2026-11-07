// One DeviceCheck interface for every unauthenticated sign-in endpoint (spec 6.2, decision 8):
//   iPhone  → App Attest assertion (X-App-Attest + X-App-Attest-Key-Id)
//   web     → Cloudflare Turnstile token (X-Turnstile), verified with siteverify
//   Android → Play Integrity: later (decision 9). Until then Android requests are treated as
//             "unsupported" and get the stricter look-up limit (spec 6.2 assumption 11).
// AUTH_DEVICE_CHECKS=off turns every check off (Expo Go, local development). On by default.
import { verifyAppAttestAssertion, type AppAttestKeyStore } from './app-attest.ts';

export type DeviceCheckResult = 'passed' | 'failed' | 'unsupported' | 'off';

export interface DeviceCheck {
  verify(req: Request, bodyText: string): Promise<DeviceCheckResult>;
}

export class DeviceChecksOff implements DeviceCheck {
  async verify(): Promise<DeviceCheckResult> {
    return 'off';
  }
}

export interface TurnstileOptions {
  secret: string;
  siteverifyUrl: string;
  fetchImpl?: typeof fetch;
}

export async function verifyTurnstile(token: string, ip: string | null, opts: TurnstileOptions) {
  const form = new URLSearchParams({ secret: opts.secret, response: token });
  if (ip) form.set('remoteip', ip);
  const res = await (opts.fetchImpl ?? fetch)(opts.siteverifyUrl, { method: 'POST', body: form });
  if (!res.ok) return false;
  const data = (await res.json()) as { success?: boolean };
  return data.success === true;
}

export class RealDeviceChecks implements DeviceCheck {
  constructor(
    private readonly turnstile: TurnstileOptions,
    private readonly appAttest: { appIds: string[]; keys: AppAttestKeyStore },
  ) {}

  async verify(req: Request, bodyText: string): Promise<DeviceCheckResult> {
    const platform = req.headers.get('x-device-platform');
    if (platform === 'web') {
      const token = req.headers.get('x-turnstile');
      if (!token || !this.turnstile.secret) return 'failed';
      const ip = clientIp(req);
      return (await verifyTurnstile(token, ip, this.turnstile)) ? 'passed' : 'failed';
    }
    if (platform === 'ios') {
      const assertion = req.headers.get('x-app-attest');
      const keyId = req.headers.get('x-app-attest-key-id');
      // Devices that can't attest (old hardware, simulator) send nothing: allowed with
      // stricter limits rather than blocked (spec 6.2).
      if (!assertion || !keyId) return 'unsupported';
      const ok = await verifyAppAttestAssertion({
        assertionB64: assertion,
        keyId,
        clientData: bodyText,
        appIds: this.appAttest.appIds,
        keys: this.appAttest.keys,
      });
      return ok ? 'passed' : 'failed';
    }
    return 'unsupported';
  }
}

/** First address in X-Forwarded-For (set by the Supabase edge), else null. */
export function clientIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  const first = fwd?.split(',')[0]?.trim();
  return first || null;
}

/** IPv4 → a.b.c.0/24, IPv6 → first 3 groups. Only this ever reaches logs. */
export function ipPrefix(ip: string | null): string | null {
  if (!ip) return null;
  if (ip.includes('.')) return ip.split('.').slice(0, 3).join('.') + '.0/24';
  return ip.split(':').slice(0, 3).join(':') + '::/48';
}
