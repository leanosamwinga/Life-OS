// Client half of the DeviceCheck interface (decision 8). auth-api checks every unauthenticated
// sign-in request; this adds the header it needs.
//   EXPO_PUBLIC_DEVICE_CHECKS=off  Expo Go / local development: nothing is sent (the server's
//                                  AUTH_DEVICE_CHECKS=off must match).
//   web                            Cloudflare Turnstile token (invisible widget), X-Turnstile.
//   iPhone                         App Attest assertion over "<METHOD> <path>\n<body>"
//                                  (X-App-Attest + X-App-Attest-Key-Id). Needs a native App Attest
//                                  module in a development/store build; until one is added the
//                                  app sends nothing and auth-api treats the device as
//                                  "unsupported" (stricter look-up limits). See SPEC-QUESTIONS.
import { Platform } from 'react-native';

export interface DeviceCheckClient {
  headers(method: string, path: string, body: string): Promise<Record<string, string>>;
}

export const deviceChecksOff: DeviceCheckClient = {
  async headers() {
    return {};
  },
};

/** Native App Attest, if a module that provides it has been installed (dev/store builds). */
export interface AppAttestModule {
  /** Returns base64 assertion + key ID for this client data, attesting first if needed. */
  assert(clientData: string): Promise<{ assertion: string; keyId: string } | null>;
}

export function appAttestClient(module: AppAttestModule | null): DeviceCheckClient {
  return {
    async headers(method, path, body): Promise<Record<string, string>> {
      if (!module) return {};
      const r = await module.assert(`${method} ${path}\n${body}`).catch(() => null);
      return r ? { 'X-App-Attest': r.assertion, 'X-App-Attest-Key-Id': r.keyId } : {};
    },
  };
}

interface Turnstile {
  render(el: HTMLElement, o: Record<string, unknown>): string;
  execute(id: string): void;
  reset(id: string): void;
}

export function turnstileClient(siteKey: string): DeviceCheckClient {
  let widget: Promise<{ t: Turnstile; id: string; next: () => Promise<string> }> | null = null;
  const setup = () =>
    (widget ??= new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onerror = reject;
      s.onload = () => {
        const t = (window as unknown as { turnstile: Turnstile }).turnstile;
        const el = document.createElement('div');
        el.style.display = 'none';
        document.body.appendChild(el);
        let pending: ((token: string) => void) | null = null;
        const id = t.render(el, {
          sitekey: siteKey,
          execution: 'execute',
          appearance: 'interaction-only',
          callback: (token: string) => pending?.(token),
        });
        resolve({
          t,
          id,
          next: () =>
            new Promise<string>((res) => {
              pending = res;
              t.reset(id);
              t.execute(id);
            }),
        });
      };
      document.head.appendChild(s);
    }));
  return {
    async headers(): Promise<Record<string, string>> {
      try {
        const w = await setup();
        return { 'X-Turnstile': await w.next() };
      } catch {
        return {};
      }
    },
  };
}

export function defaultDeviceCheck(): DeviceCheckClient {
  if (process.env.EXPO_PUBLIC_DEVICE_CHECKS === 'off') return deviceChecksOff;
  if (Platform.OS === 'web') {
    const key = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY;
    return key ? turnstileClient(key) : deviceChecksOff;
  }
  return appAttestClient(null);
}
