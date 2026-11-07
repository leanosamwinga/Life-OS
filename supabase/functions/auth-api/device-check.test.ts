import { describe, expect, it } from 'vitest';
import { DeviceChecksOff, RealDeviceChecks, assertionClientData, ipPrefix } from './device-check.ts';

const req = (headers: Record<string, string>, path = '/auth-api/v1/sessions/password') =>
  new Request(`http://localhost${path}`, { method: 'POST', headers });

function fakeSiteverify(ok: boolean) {
  const calls: URLSearchParams[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    calls.push(init.body as URLSearchParams);
    return new Response(JSON.stringify({ success: ok }), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const noKeys = { get: async () => null, updateCounter: async () => undefined };

describe('DeviceCheck', () => {
  it('off in Expo Go / local development', async () => {
    expect(await new DeviceChecksOff().verify()).toBe('off');
  });

  it('web: Turnstile token verified server-side with siteverify', async () => {
    const good = fakeSiteverify(true);
    const checks = new RealDeviceChecks({ secret: 'test-secret', siteverifyUrl: 'https://siteverify.test', fetchImpl: good.fetchImpl }, { appIds: [], keys: noKeys });
    expect(await checks.verify(req({ 'x-device-platform': 'web', 'x-turnstile': 'tok', 'x-forwarded-for': '198.51.100.4' }), '')).toBe('passed');
    expect(good.calls[0]!.get('response')).toBe('tok');
    expect(good.calls[0]!.get('remoteip')).toBe('198.51.100.4');
    const bad = fakeSiteverify(false);
    const failing = new RealDeviceChecks({ secret: 'test-secret', siteverifyUrl: 'https://siteverify.test', fetchImpl: bad.fetchImpl }, { appIds: [], keys: noKeys });
    expect(await failing.verify(req({ 'x-device-platform': 'web', 'x-turnstile': 'tok' }), '')).toBe('failed');
    expect(await failing.verify(req({ 'x-device-platform': 'web' }), '')).toBe('failed');
  });

  it('iPhone: no assertion → unsupported (stricter limits); a bad assertion → failed', async () => {
    const checks = new RealDeviceChecks({ secret: 's', siteverifyUrl: 'x' }, { appIds: ['T.app'], keys: noKeys });
    expect(await checks.verify(req({ 'x-device-platform': 'ios' }), '')).toBe('unsupported');
    expect(await checks.verify(req({ 'x-device-platform': 'ios', 'x-app-attest': 'AAAA', 'x-app-attest-key-id': 'k' }), '')).toBe('failed');
  });

  it('Android: unsupported until Play Integrity (decision 9)', async () => {
    const checks = new RealDeviceChecks({ secret: 's', siteverifyUrl: 'x' }, { appIds: [], keys: noKeys });
    expect(await checks.verify(req({ 'x-device-platform': 'android' }), '')).toBe('unsupported');
  });

  it('assertion client data is method, path from /v1 and the raw body', () => {
    expect(assertionClientData(req({}), '{"a":1}')).toBe('POST /v1/sessions/password\n{"a":1}');
  });

  it('logs only an IP prefix', () => {
    expect(ipPrefix('198.51.100.42')).toBe('198.51.100.0/24');
    expect(ipPrefix('2001:db8:1:2::1')).toBe('2001:db8:1::/48');
    expect(ipPrefix(null)).toBeNull();
  });
});
