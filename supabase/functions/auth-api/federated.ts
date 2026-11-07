// Apple and Google ID-token checks (spec 9.1). Supabase Auth's own Apple/Google providers are
// switched off (so its automatic linking can't run); this module does the same checks Supabase
// Auth would, plus the spec's single-use, device-bound nonce.
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import type { FederatedProvider } from '@life-os/core';
import type { AuthConfig, ProviderConfig } from './config.ts';
import { sha256Hex } from './crypto.ts';

export interface VerifiedIdToken {
  provider: FederatedProvider;
  subject: string;
  /** Only set when the provider says the email is verified (spec 2.4 notes). */
  verifiedEmail: string | null;
  isPrivateRelay: boolean;
  audience: string;
}

export type IdTokenFailure =
  | 'signature'
  | 'alg'
  | 'iss'
  | 'aud'
  | 'exp'
  | 'iat'
  | 'nonce'
  | 'claims'
  | 'provider_off';

export class IdTokenError extends Error {
  constructor(readonly check: IdTokenFailure) {
    super(`id token failed: ${check}`);
  }
}

export interface IdTokenVerifier {
  verify(provider: FederatedProvider, idToken: string, rawNonce: string): Promise<VerifiedIdToken>;
}

const asBool = (v: unknown) => v === true || v === 'true';

export class JoseIdTokenVerifier implements IdTokenVerifier {
  private readonly jwks = new Map<string, JWTVerifyGetKey>();

  constructor(
    private readonly config: AuthConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private keys(url: string): JWTVerifyGetKey {
    let set = this.jwks.get(url);
    if (!set) {
      // jose caches keys and refetches when an unknown `kid` arrives (spec 9.1).
      set = createRemoteJWKSet(new URL(url), { cooldownDuration: 30_000, cacheMaxAge: 600_000 });
      this.jwks.set(url, set);
    }
    return set;
  }

  async verify(provider: FederatedProvider, idToken: string, rawNonce: string): Promise<VerifiedIdToken> {
    const pc: ProviderConfig = provider === 'GOOGLE' ? this.config.google : this.config.apple;
    if (!pc.audiences.length) throw new IdTokenError('provider_off');
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(idToken, this.keys(pc.jwksUrl), {
        algorithms: ['RS256'],
        issuer: pc.issuers,
        audience: pc.audiences,
        clockTolerance: 60,
        currentDate: this.now(),
        requiredClaims: ['sub', 'iat', 'exp', 'aud', 'iss'],
      }));
    } catch (e) {
      const code = (e as { code?: string; claim?: string }).code ?? '';
      const claim = (e as { claim?: string }).claim;
      if (code === 'ERR_JOSE_ALG_NOT_ALLOWED') throw new IdTokenError('alg');
      if (code === 'ERR_JWT_EXPIRED') throw new IdTokenError('exp');
      if (code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
        if (claim === 'iss') throw new IdTokenError('iss');
        if (claim === 'aud') throw new IdTokenError('aud');
        if (claim === 'iat' || claim === 'nbf') throw new IdTokenError('iat');
        throw new IdTokenError('claims');
      }
      throw new IdTokenError('signature');
    }
    const nowSec = Math.floor(this.now().getTime() / 1000);
    if (typeof payload.iat !== 'number' || payload.iat > nowSec + 60) throw new IdTokenError('iat');

    const aud = Array.isArray(payload.aud) ? payload.aud[0]! : String(payload.aud);
    // Apple native (bundle ID audience) carries SHA256(raw nonce); web and Google carry the raw
    // nonce (spec 9.1).
    const expectedNonce =
      provider === 'APPLE' && aud === this.config.apple.bundleId ? await sha256Hex(rawNonce) : rawNonce;
    if (typeof payload.nonce !== 'string' || payload.nonce !== expectedNonce) {
      throw new IdTokenError('nonce');
    }
    if (!payload.sub) throw new IdTokenError('claims');

    const email = typeof payload.email === 'string' ? payload.email : null;
    const verified = asBool(payload.email_verified);
    return {
      provider,
      subject: payload.sub,
      verifiedEmail: email && verified ? email : null,
      isPrivateRelay: asBool(payload.is_private_email),
      audience: aud,
    };
  }
}
