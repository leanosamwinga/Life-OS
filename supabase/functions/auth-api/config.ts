// auth-api configuration. Every secret comes from the environment (edge function secrets in
// the hosted project; supabase/functions/.env locally — git-ignored; see .env.example).

export interface PepperKey {
  version: number;
  secret: string;
}

export interface ProviderConfig {
  /** Accepted `iss` values. */
  issuers: string[];
  /** JWKS endpoint. Tests point this at a local fake. */
  jwksUrl: string;
  /** Accepted `aud` values (client IDs / bundle ID / Services ID). Empty = provider off. */
  audiences: string[];
}

export interface AuthConfig {
  /** Supabase Auth base URL, e.g. https://<ref>.supabase.co/auth/v1 */
  authUrl: string;
  /** Publishable / anon key (needed by Supabase Auth's public endpoints). */
  anonKey: string;
  /** Service-role / secret key (admin API). Edge runtime only. */
  serviceKey: string;
  /** Password peppers; the highest version is current (spec 5.4). */
  peppers: PepperKey[];
  /** HMAC key for 6-digit codes. */
  codeKey: string;
  /** HMAC key for device and IP keys in rate-limit tables. */
  keyHashKey: string;
  /** HMAC key for emails in logs only. */
  logKey: string;
  /** AES key for Apple refresh tokens at rest. */
  tokenEncKey: string;
  /** Shared secret for the internal job endpoint (pg_cron → auth-api). */
  jobSecret: string;
  timingFloorMs: number;
  timingJitterMs: number;
  /** Turn device checks off in Expo Go / local development. On by default. */
  deviceChecks: boolean;
  /** Use the breached-password table (fixture locally, full dataset in production). */
  breachCheck: boolean;
  appAttest: { appIds: string[]; allowDevelopmentEnvironment: boolean; rootCaPem: string };
  turnstile: { secret: string; siteverifyUrl: string };
  google: ProviderConfig;
  apple: ProviderConfig & {
    /** iOS bundle ID: native tokens carry SHA256(nonce). */
    bundleId: string;
    teamId: string;
    keyId: string;
    /** PEM of the Sign in with Apple .p8 key. Never committed. */
    privateKey: string;
    tokenUrl: string;
    revokeUrl: string;
    /** Services ID used as client_id for web tokens and the webhook audience. */
    servicesId: string;
  };
  /** Base of the reset link; the token goes in the fragment (spec 2.8). */
  resetLinkBase: string;
  /** Web origins allowed to call auth-api (the BFF and local web). */
  allowedOrigins: string[];
  /** Plain link (no token) used in "Open Life OS" email buttons. */
  appLink: string;
}

const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

function required(env: (k: string) => string | undefined, key: string): string {
  const v = env(key);
  if (!v) throw new Error(`${key} must be set`);
  return v;
}

export function configFromEnv(env: (k: string) => string | undefined): AuthConfig {
  const peppers: PepperKey[] = [];
  for (let v = 1; v <= 9; v++) {
    const secret = env(`AUTH_PASSWORD_PEPPER_V${v}`);
    if (secret) peppers.push({ version: v, secret });
  }
  if (!peppers.length) throw new Error('AUTH_PASSWORD_PEPPER_V1 must be set');
  const bundleId = env('APPLE_BUNDLE_ID') ?? '';
  const servicesId = env('APPLE_SERVICES_ID') ?? '';
  return {
    authUrl: required(env, 'SUPABASE_AUTH_URL'),
    anonKey: required(env, 'SUPABASE_ANON_KEY'),
    serviceKey: required(env, 'SUPABASE_SERVICE_ROLE_KEY'),
    peppers,
    codeKey: required(env, 'AUTH_CODE_HMAC_KEY'),
    keyHashKey: required(env, 'AUTH_KEY_HASH_KEY'),
    logKey: required(env, 'AUTH_LOG_HMAC_KEY'),
    tokenEncKey: required(env, 'AUTH_TOKEN_ENC_KEY'),
    jobSecret: required(env, 'AUTH_JOB_SECRET'),
    timingFloorMs: Number(env('AUTH_TIMING_FLOOR_MS') ?? 600),
    timingJitterMs: Number(env('AUTH_TIMING_JITTER_MS') ?? 50),
    deviceChecks: (env('AUTH_DEVICE_CHECKS') ?? 'on') !== 'off',
    breachCheck: (env('AUTH_BREACH_CHECK') ?? 'on') !== 'off',
    appAttest: {
      appIds: list(env('APP_ATTEST_APP_IDS')),
      allowDevelopmentEnvironment: env('APP_ATTEST_ALLOW_DEVELOPMENT') === 'true',
      // Apple App Attestation Root CA (public), from
      // https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem
      rootCaPem: env('APP_ATTEST_ROOT_CA_PEM') ?? '',
    },
    turnstile: {
      secret: env('TURNSTILE_SECRET_KEY') ?? '',
      siteverifyUrl:
        env('TURNSTILE_SITEVERIFY_URL') ??
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    },
    google: {
      issuers: list(env('GOOGLE_ISSUERS') ?? 'https://accounts.google.com,accounts.google.com'),
      jwksUrl: env('GOOGLE_JWKS_URL') ?? 'https://www.googleapis.com/oauth2/v3/certs',
      audiences: list(env('GOOGLE_CLIENT_IDS')),
    },
    apple: {
      issuers: list(env('APPLE_ISSUERS') ?? 'https://appleid.apple.com'),
      jwksUrl: env('APPLE_JWKS_URL') ?? 'https://appleid.apple.com/auth/keys',
      audiences: [bundleId, servicesId].filter(Boolean),
      bundleId,
      servicesId,
      teamId: env('APPLE_TEAM_ID') ?? '',
      keyId: env('APPLE_KEY_ID') ?? '',
      privateKey: env('APPLE_PRIVATE_KEY') ?? '',
      tokenUrl: env('APPLE_TOKEN_URL') ?? 'https://appleid.apple.com/auth/token',
      revokeUrl: env('APPLE_REVOKE_URL') ?? 'https://appleid.apple.com/auth/revoke',
    },
    resetLinkBase: env('AUTH_RESET_LINK_BASE') ?? 'https://lifeos.app/reset',
    allowedOrigins: list(env('AUTH_ALLOWED_ORIGINS')),
    appLink: env('AUTH_APP_LINK') ?? 'https://lifeos.app/open',
  };
}

export function currentPepper(config: AuthConfig): PepperKey {
  return config.peppers.reduce((a, b) => (b.version > a.version ? b : a));
}
