// Sign in with Apple server pieces (spec 9.2, 9.4):
//   * exchanging the first authorisation code for a refresh token (kept encrypted);
//   * revoking that token when the account is deleted (Apple requires it);
//   * verifying server-to-server notifications.
import { SignJWT, createRemoteJWKSet, importPKCS8, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { AuthConfig } from './config.ts';
import type { AppleCodeExchange } from './service.ts';

export interface AppleEvent {
  type: string;
  sub: string;
  eventKey: string;
}

export interface AppleWebhookVerifier {
  verify(payload: string): Promise<AppleEvent>;
}

const KNOWN_EVENTS = new Set([
  'consent-revoked',
  'account-delete',
  'email-disabled',
  'email-enabled',
]);

export class JoseAppleWebhookVerifier implements AppleWebhookVerifier {
  private jwks: JWTVerifyGetKey | null = null;
  constructor(private readonly config: AuthConfig) {}

  async verify(payload: string): Promise<AppleEvent> {
    const a = this.config.apple;
    this.jwks ??= createRemoteJWKSet(new URL(a.jwksUrl));
    const { payload: claims } = await jwtVerify(payload, this.jwks, {
      algorithms: ['RS256'],
      issuer: a.issuers,
      audience: a.audiences,
      clockTolerance: 300,
      requiredClaims: ['iat', 'events'],
    });
    const raw = claims.events;
    const events = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
      type?: string;
      sub?: string;
      event_time?: number;
    };
    if (!events?.type || !events.sub || !KNOWN_EVENTS.has(events.type))
      throw new Error('unknown event');
    const key = `${claims.jti ?? ''}|${events.type}|${events.sub}|${events.event_time ?? claims.iat}`;
    return { type: events.type, sub: events.sub, eventKey: key };
  }
}

/** Short-lived ES256 client secret signed with our Apple key (Team ID, Key ID). */
export async function appleClientSecret(
  config: AuthConfig,
  clientId: string,
  now = new Date(),
): Promise<string> {
  const a = config.apple;
  const key = await importPKCS8(a.privateKey, 'ES256');
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: a.keyId })
    .setIssuer(a.teamId)
    .setSubject(clientId)
    .setAudience('https://appleid.apple.com')
    .setIssuedAt(iat)
    .setExpirationTime(iat + 300)
    .sign(key);
}

export class AppleClient implements AppleCodeExchange {
  constructor(
    private readonly config: AuthConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get configured(): boolean {
    const a = this.config.apple;
    return !!(a.teamId && a.keyId && a.privateKey);
  }

  async exchange(code: string, clientId: string): Promise<string | null> {
    if (!this.configured) return null;
    const res = await this.fetchImpl(this.config.apple.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: await appleClientSecret(this.config, clientId),
        code,
        grant_type: 'authorization_code',
      }),
    });
    if (!res.ok) throw new Error(`apple token ${res.status}`);
    const data = (await res.json()) as { refresh_token?: string };
    return data.refresh_token ?? null;
  }

  /** Revokes a refresh token. The bundle ID is the client for native sign-ins. */
  async revoke(refreshToken: string): Promise<boolean> {
    if (!this.configured) return false;
    const clientId = this.config.apple.bundleId || this.config.apple.servicesId;
    const res = await this.fetchImpl(this.config.apple.revokeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: await appleClientSecret(this.config, clientId),
        token: refreshToken,
        token_type_hint: 'refresh_token',
      }),
    });
    return res.ok;
  }
}
