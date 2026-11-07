// Pure checks for `npm run doctor` (scripts/doctor/doctor.mjs). Each returns
// { ok: true|false|null, name, detail } — null means "couldn't check" (a warning, not a failure).
import { isIP } from 'node:net';

/** Parses KEY=value lines (# comments, optional quotes). */
export function parseEnv(text) {
  const out = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

export const pass = (name, detail) => ({ ok: true, name, detail });
export const fail = (name, detail) => ({ ok: false, name, detail });
export const warn = (name, detail) => ({ ok: null, name, detail });

/** auth-api's required secrets (supabase/functions/.env.example). */
export const FUNCTION_SECRETS = [
  'AUTH_PASSWORD_PEPPER_V1',
  'AUTH_CODE_HMAC_KEY',
  'AUTH_KEY_HASH_KEY',
  'AUTH_LOG_HMAC_KEY',
  'AUTH_TOKEN_ENC_KEY',
  'AUTH_JOB_SECRET',
];

export function checkFunctionsEnv(env, appEnv, name = 'supabase/functions/.env') {
  if (!env)
    return fail(name, 'missing — run `cp supabase/functions/.env.example supabase/functions/.env`');
  const missing = FUNCTION_SECRETS.filter((k) => !env[k]);
  if (missing.length)
    return fail(
      name,
      `missing ${missing.join(', ')} — copy them from supabase/functions/.env.example`,
    );
  if (!env.MAILPIT_URL)
    return fail(
      name,
      'MAILPIT_URL is empty — locally set MAILPIT_URL=http://host.docker.internal:54324 (as in .env.example)',
    );
  const problems = [];
  const app = appEnv ?? {};
  if (
    (app.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || app.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID) &&
    !env.GOOGLE_CLIENT_IDS
  )
    problems.push(
      'GOOGLE_CLIENT_IDS is empty but the app has a Google client id (Google ends on 0b-8g) — set GOOGLE_CLIENT_IDS=<web id>,<ios id>',
    );
  for (const id of [
    app.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    app.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  ].filter(Boolean)) {
    if (
      env.GOOGLE_CLIENT_IDS &&
      !env.GOOGLE_CLIENT_IDS.split(',')
        .map((s) => s.trim())
        .includes(id)
    )
      problems.push(`GOOGLE_CLIENT_IDS doesn't include the app's ${id.slice(0, 12)}… — add it`);
  }
  const notes = [];
  if (!env.APPLE_BUNDLE_ID)
    notes.push(
      'APPLE_BUNDLE_ID is empty, so Sign in with Apple ends on 0b-8g — in Expo Go set APPLE_BUNDLE_ID=host.exp.Exponent (local only)',
    );
  if (!env.GOOGLE_CLIENT_IDS && !problems.length)
    notes.push('GOOGLE_CLIENT_IDS is empty, so Google sign-in is off');
  const deviceChecks = (env.AUTH_DEVICE_CHECKS ?? 'on') !== 'off';
  const appChecks = (app.EXPO_PUBLIC_DEVICE_CHECKS ?? 'on') !== 'off';
  if (appEnv && deviceChecks !== appChecks)
    problems.push(
      'AUTH_DEVICE_CHECKS and the app\'s EXPO_PUBLIC_DEVICE_CHECKS differ — set both to "off" for Expo Go',
    );
  if (problems.length) return fail(name, problems.join('; '));
  if (notes.length) return warn(name, `secrets and Mailpit set; ${notes.join('; ')}`);
  return pass(name, 'secrets, Mailpit, Apple and Google ids set');
}

export function checkAppEnv(appEnv, stack) {
  const name = 'apps/mobile/.env.local';
  if (!appEnv)
    return fail(
      name,
      'missing — run `cp apps/mobile/.env.example apps/mobile/.env.local` and fill in the URL and key',
    );
  if (!appEnv.EXPO_PUBLIC_SUPABASE_URL)
    return fail(name, "EXPO_PUBLIC_SUPABASE_URL is empty — http://<your Mac's Wi-Fi IP>:54321");
  if (!appEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY)
    return fail(
      name,
      'EXPO_PUBLIC_SUPABASE_ANON_KEY is empty — use the Publishable (anon) key from `supabase status`',
    );
  if (stack && stack.keys.length && !stack.keys.includes(appEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY))
    return fail(
      name,
      "EXPO_PUBLIC_SUPABASE_ANON_KEY is not this stack's key — copy the Publishable key from `supabase status` (never the Secret key), then `npm run mobile -- --clear`",
    );
  if (stack && stack.secretKeys.includes(appEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY))
    return fail(
      name,
      'EXPO_PUBLIC_SUPABASE_ANON_KEY is the SECRET key — it ships in the app; use the Publishable key',
    );
  return pass(name, 'URL and anon key set');
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

/** Whether a phone on the same Wi-Fi can reach the URL (by its address alone). */
export function checkPhoneUrl(url, localAddresses, target = 'phone') {
  const name = 'EXPO_PUBLIC_SUPABASE_URL from the phone';
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return fail(name, `"${url}" isn't a URL — use http://<your Mac's Wi-Fi IP>:54321`);
  }
  const lan = localAddresses.find((a) => !a.startsWith('127.') && a !== '::1');
  if (LOOPBACK.has(host)) {
    if (target !== 'phone') return pass(name, `${host} is fine for the simulator and web`);
    return fail(
      name,
      `${host} is the phone itself — use ${lan ? `http://${lan}:54321` : "your Mac's Wi-Fi address (`ipconfig getifaddr en0`)"}, then \`npm run mobile -- --clear\``,
    );
  }
  if (isIP(host) && !localAddresses.includes(host))
    return fail(
      name,
      `${host} isn't an address of this machine (${localAddresses.filter((a) => !a.startsWith('127.')).join(', ') || 'none'}) — your Wi-Fi IP changed? Update it and \`npm run mobile -- --clear\``,
    );
  return pass(name, `${host} is this machine on the network`);
}

/** One output line per check. */
export function line(r) {
  const mark = r.ok === true ? '✓' : r.ok === false ? '✗' : '!';
  return `${mark} ${r.name} — ${r.detail}`;
}
