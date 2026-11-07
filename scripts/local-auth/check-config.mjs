// Fails if the Docker-free local stack (config-to-env.sh) and supabase/config.toml disagree on
// the settings sign-in v3 depends on. Run in CI: node scripts/local-auth/check-config.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const toml = readFileSync(`${root}/supabase/config.toml`, 'utf8');
const envText = execFileSync('bash', [`${root}/scripts/local-auth/config-to-env.sh`], {
  encoding: 'utf8',
});
const env = Object.fromEntries(
  envText
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);

/** Value of `key` inside `[section]` of config.toml (first match, comments ignored). */
function tomlValue(section, key) {
  const lines = toml.split('\n');
  let inSection = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('[')) inSection = line === `[${section}]`;
    else if (inSection && !line.startsWith('#')) {
      const m = line.match(new RegExp(`^${key}\\s*=\\s*(.+)$`));
      if (m) return m[1].trim().replace(/^"(.*)"$/, '$1');
    }
  }
  return undefined;
}

const checks = [
  ['auth', 'enable_signup', 'GOTRUE_DISABLE_SIGNUP', (t, e) => (t === 'false') === (e === 'true')],
  ['auth', 'minimum_password_length', 'GOTRUE_PASSWORD_MIN_LENGTH', (t, e) => t === e],
  [
    'auth',
    'enable_refresh_token_rotation',
    'GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED',
    (t, e) => t === e,
  ],
  [
    'auth',
    'refresh_token_reuse_interval',
    'GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL',
    (t, e) => t === e,
  ],
  [
    'auth',
    'enable_anonymous_sign_ins',
    'GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED',
    (t, e) => t === e,
  ],
  ['auth', 'enable_manual_linking', 'GOTRUE_SECURITY_MANUAL_LINKING_ENABLED', (t, e) => t === e],
  [
    'auth.email',
    'enable_confirmations',
    'GOTRUE_MAILER_AUTOCONFIRM',
    (t, e) => (t === 'true') === (e === 'false'),
  ],
  ['auth.email', 'otp_length', 'GOTRUE_MAILER_OTP_LENGTH', (t, e) => t === e],
  ['auth.email', 'otp_expiry', 'GOTRUE_MAILER_OTP_EXP', (t, e) => t === e],
  ['auth.external.apple', 'enabled', 'GOTRUE_EXTERNAL_APPLE_ENABLED', (t, e) => t === e],
  ['auth.external.google', 'enabled', 'GOTRUE_EXTERNAL_GOOGLE_ENABLED', (t, e) => t === e],
  [
    'auth.hook.custom_access_token',
    'uri',
    'GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI',
    (t, e) => t === e,
  ],
  ['auth.hook.send_email', 'uri', 'GOTRUE_HOOK_SEND_EMAIL_URI', (t, e) => t === e],
  [
    'auth.hook.before_user_created',
    'uri',
    'GOTRUE_HOOK_BEFORE_USER_CREATED_URI',
    (t, e) => t === e,
  ],
];

let failed = 0;
for (const [section, key, envKey, same] of checks) {
  const t = tomlValue(section, key);
  const e = env[envKey];
  if (t === undefined || e === undefined || !same(t, e)) {
    console.error(`drift: [${section}] ${key} = ${t} vs ${envKey}=${e}`);
    failed++;
  }
}
if (failed) process.exit(1);
console.warn(`config.toml and scripts/local-auth agree (${checks.length} settings)`);
