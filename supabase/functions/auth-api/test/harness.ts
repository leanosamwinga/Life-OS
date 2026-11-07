// Integration-test harness: auth-api against a REAL Supabase Auth (scripts/local-auth/start.sh).
// Apple and Google are faked with locally generated RSA keys served from a local JWKS URL —
// a test-only provider configuration. No real Apple or Google credentials are ever used.
import { readFileSync, existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey as JoseKey } from 'jose';
import postgres, { type Sql } from 'postgres';
import { createApp } from '../app.ts';
import type { AuthConfig } from '../config.ts';
import { sha256Hex } from '../crypto.ts';
import { MemorySender } from '../email.ts';

export function localEnv(): Record<string, string> | null {
  const file = fileURLToPath(new URL('../../../../.local-auth/env', import.meta.url));
  if (!existsSync(file)) return null;
  const env: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]!] = m[2]!;
  }
  return env.LOCAL_AUTH_URL ? env : null;
}

export const GOOGLE_ISS = 'https://accounts.google.test';
export const APPLE_ISS = 'https://appleid.apple.test';
export const GOOGLE_CLIENT = 'test-google-client.apps.example.test';
export const APPLE_BUNDLE = 'test.lifeos.app';
export const APPLE_SERVICES = 'test.lifeos.web';

export interface FakeProvider {
  sign(claims: Record<string, unknown>, opts?: { alg?: 'RS256'; key?: 'other'; kid?: string }): Promise<string>;
}

export interface Harness {
  sql: Sql;
  mail: MemorySender;
  logs: string[];
  config: AuthConfig;
  call(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: any; headers: Headers }>;
  google: FakeProvider;
  apple: FakeProvider;
  /** Last 6-digit code emailed to `email`. */
  lastCode(email: string): string;
  lastLink(email: string): string;
  /** Headers for a fresh device (own device ID and IP), or a given ID/IP. */
  device(id?: string, ip?: string): Record<string, string>;
  close(): Promise<void>;
  env: Record<string, string>;
}

export async function startHarness(opts: { timingFloorMs?: number } = {}): Promise<Harness> {
  const env = localEnv();
  if (!env) throw new Error('local auth stack not running (bash scripts/local-auth/start.sh)');

  // Fake Apple/Google signing keys and JWKS server.
  const keys = { google: await generateKeyPair('RS256'), apple: await generateKeyPair('RS256'), other: await generateKeyPair('RS256') };
  const jwk = async (k: JoseKey, kid: string) => ({ ...(await exportJWK(k)), kid, alg: 'RS256', use: 'sig' });
  const jwks: Record<string, unknown> = {
    '/google/certs': { keys: [await jwk(keys.google.publicKey, 'g1')] },
    '/apple/keys': { keys: [await jwk(keys.apple.publicKey, 'a1')] },
  };
  const server: Server = createServer((req, res) => {
    const body = jwks[req.url ?? ''];
    res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body ?? {}));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;

  const config: AuthConfig = {
    authUrl: env.LOCAL_AUTH_URL!,
    anonKey: env.LOCAL_ANON_KEY!,
    serviceKey: env.LOCAL_SERVICE_ROLE_KEY!,
    peppers: [{ version: 1, secret: 'local-dev-pepper-NOT-A-SECRET' }],
    codeKey: `${env.LOCAL_SERVER_SECRET}-code`,
    keyHashKey: `${env.LOCAL_SERVER_SECRET}-key`,
    logKey: `${env.LOCAL_SERVER_SECRET}-log`,
    tokenEncKey: `${env.LOCAL_SERVER_SECRET}-enc`,
    jobSecret: `${env.LOCAL_SERVER_SECRET}-job`,
    timingFloorMs: opts.timingFloorMs ?? 0,
    timingJitterMs: opts.timingFloorMs ? 50 : 0,
    deviceChecks: false,
    breachCheck: true,
    appAttest: { appIds: [], allowDevelopmentEnvironment: true },
    turnstile: { secret: '', siteverifyUrl: '' },
    google: { issuers: [GOOGLE_ISS], jwksUrl: `http://127.0.0.1:${port}/google/certs`, audiences: [GOOGLE_CLIENT] },
    apple: {
      issuers: [APPLE_ISS],
      jwksUrl: `http://127.0.0.1:${port}/apple/keys`,
      audiences: [APPLE_BUNDLE, APPLE_SERVICES],
      bundleId: APPLE_BUNDLE,
      servicesId: APPLE_SERVICES,
      teamId: '',
      keyId: '',
      privateKey: '',
      tokenUrl: '',
      revokeUrl: '',
    },
    resetLinkBase: 'https://lifeos.app/reset',
    allowedOrigins: ['http://localhost:8081'],
    appLink: 'https://lifeos.app/open',
  };

  const sql = postgres(env.LOCAL_DB_URL!, { max: 4, onnotice: () => undefined });
  const mail = new MemorySender();
  const logs: string[] = [];
  const pending: Promise<void>[] = [];
  const app = createApp({
    config,
    sql,
    emailSender: mail,
    logSink: { write: (l) => logs.push(l) },
    later: (task) => {
      pending.push(task());
    },
  });

  const signer = (which: 'google' | 'apple', iss: string): FakeProvider => ({
    async sign(claims, o = {}) {
      const key = o.key === 'other' ? keys.other.privateKey : keys[which].privateKey;
      const now = Math.floor(Date.now() / 1000);
      return new SignJWT({ iat: now, exp: now + 600, iss, ...claims })
        .setProtectedHeader({ alg: o.alg ?? 'RS256', kid: o.kid ?? (which === 'google' ? 'g1' : 'a1') })
        .sign(key);
    },
  });

  let deviceSeq = 0;
  return {
    sql,
    mail,
    logs,
    config,
    env,
    google: signer('google', GOOGLE_ISS),
    apple: signer('apple', APPLE_ISS),
    device(id, ip) {
      const n = deviceSeq++;
      return {
        'X-Device-Id': id ?? `test-device-${Date.now()}-${n}-abcdef`,
        'X-Device-Platform': 'ios',
        'X-Device-Label': 'iPhone 15',
        'X-Forwarded-For': ip ?? `10.${(Date.now() >> 8) & 255}.${(n >> 8) & 255}.${n & 255}`,
      };
    },
    async call(method, path, body, headers = {}) {
      const res = await app.handler(
        new Request(`http://127.0.0.1/auth-api${path}`, {
          method,
          headers: { 'Content-Type': 'application/json', ...headers },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
      await Promise.all(pending.splice(0));
      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        /* plain text */
      }
      return { status: res.status, body: parsed, headers: res.headers };
    },
    lastCode(email) {
      const m = [...mail.sent].reverse().find((e) => e.to === email && /\b\d{6}\b/.test(e.text));
      const code = m?.text.match(/\b(\d{6})\b/)?.[1];
      if (!code) throw new Error(`no code emailed to ${email}`);
      return code;
    },
    lastLink(email) {
      const m = [...mail.sent].reverse().find((e) => e.to === email && e.text.includes('#t='));
      const link = m?.text.match(/(https:\/\/\S+#t=\S+)/)?.[1];
      if (!link) throw new Error(`no link emailed to ${email}`);
      return link;
    },
    async close() {
      await Promise.all(pending.splice(0));
      await sql.end({ timeout: 2 });
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

/** A unique, obviously fake email for one test. */
export function testEmail(tag: string): string {
  return `${tag}.${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}@example.test`;
}

export async function hashNonce(nonce: string) {
  return sha256Hex(nonce);
}
