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
/** How every fix text spells the Supabase CLI: it works whether or not the CLI is installed. */
export const SUPABASE = 'npx supabase';
/** Expo Go's own bundle id — what Apple puts in the token's audience inside Expo Go. */
export const EXPO_GO_BUNDLE_ID = 'host.exp.Exponent';
const LEGACY_APPLE = 'SUPABASE_AUTH_EXTERNAL_APPLE_CLIENT_ID';
const LEGACY_GOOGLE = 'SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID';
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

/**
 * The `status -o env` output of an installed Supabase CLI, else through npx (the CLI is often only used as
 * `npx supabase …`). `run(cmd, args, timeoutMs)` returns stdout or throws. Null if neither answers.
 */
export function supabaseStatus(run) {
  const attempts = [
    ['supabase', ['status', '-o', 'env'], 20_000],
    ['npx', ['--yes', 'supabase', 'status', '-o', 'env'], 90_000],
  ];
  for (const [cmd, args, timeout] of attempts) {
    try {
      const env = parseEnv(run(cmd, args, timeout));
      if (env.API_URL) return env;
    } catch {
      /* not installed, or not started */
    }
  }
  return null;
}

/**
 * Apple and Google ids that still sit in supabase/.env from before sign-in v3. Supabase Auth's
 * own providers are off now, so nothing reads them there; auth-api reads supabase/functions/.env.
 */
export function legacyIdMoves(legacy, env) {
  const out = [];
  const apple = legacy?.[LEGACY_APPLE]?.split(',')[0]?.trim();
  if (apple && !env?.APPLE_BUNDLE_ID)
    out.push(
      `${LEGACY_APPLE} in supabase/.env moved: copy it to supabase/functions/.env as APPLE_BUNDLE_ID=${apple}`,
    );
  const google = legacy?.[LEGACY_GOOGLE];
  if (google && !env?.GOOGLE_CLIENT_IDS)
    out.push(
      `${LEGACY_GOOGLE} in supabase/.env moved: copy it to supabase/functions/.env as GOOGLE_CLIENT_IDS=${google}`,
    );
  return out;
}

/** Leftover SUPABASE_AUTH_EXTERNAL_* values whose new home is already filled in: harmless. */
export function checkLegacySupabaseEnv(legacy, env) {
  const name = 'supabase/.env';
  const left = Object.keys(legacy ?? {}).filter(
    (k) => k.startsWith('SUPABASE_AUTH_EXTERNAL_') && legacy[k],
  );
  if (!left.length) return null;
  if (legacyIdMoves(legacy, env).length) return null; // reported as ✗ by checkFunctionsEnv
  return warn(
    name,
    `${left.join(', ')} ${left.length === 1 ? 'is' : 'are'} no longer read (auth-api reads supabase/functions/.env) — you can delete ${left.length === 1 ? 'it' : 'them'}`,
  );
}

export function checkFunctionsEnv(env, appEnv, name = 'supabase/functions/.env', legacy = null) {
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
  const moves = legacyIdMoves(legacy, env);
  if (moves.length) problems.push(...moves);
  if (!env.APPLE_BUNDLE_ID && !moves.some((m) => m.includes('APPLE_BUNDLE_ID')))
    problems.push(
      `APPLE_BUNDLE_ID is empty, so Sign in with Apple ends on 0b-8g — APPLE_BUNDLE_ID=${EXPO_GO_BUNDLE_ID} for Expo Go (local only), your own bundle id in a development build`,
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
      `EXPO_PUBLIC_SUPABASE_ANON_KEY is empty — use the Publishable (anon) key from \`${SUPABASE} status\``,
    );
  if (stack && stack.keys.length && !stack.keys.includes(appEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY))
    return fail(
      name,
      `EXPO_PUBLIC_SUPABASE_ANON_KEY is not this stack's key — copy the Publishable key from \`${SUPABASE} status\` (never the Secret key), then \`npm run mobile -- --clear\``,
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

/**
 * Apple Health (Phase 3) is only read in a development build: Expo Go has no HealthKit module.
 * Always a note (!), never a failure — Expo Go still works and shows what has been synced.
 */
export function appleHealthNote() {
  return warn(
    'Apple Health',
    'needs a development build on the iPhone — Expo Go has no HealthKit, so Health shows only synced data. Build one with `cd apps/mobile`, `npx expo prebuild --platform ios --clean`, `npx expo run:ios --device` (README › Health)',
  );
}

/** One output line per check. */
export function line(r) {
  const mark = r.ok === true ? '✓' : r.ok === false ? '✗' : '!';
  return `${mark} ${r.name} — ${r.detail}`;
}

// ---------------------------------------------------------------- where am I?

/** The first lines doctor prints: which checkout and branch it's looking at. */
export function whereLines(root, branch) {
  return [
    `Repo: ${root.replace(/\/$/, '')}`,
    `Branch: ${branch || 'unknown (not a git checkout?)'}`,
  ];
}

/** `https://github.com/Owner/Repo.git`, `git@github.com:owner/repo` → `github.com/owner/repo`. */
export function normaliseRemote(url) {
  if (!url) return null;
  return url
    .trim()
    .replace(/^[a-z+]+:\/\//i, '')
    .replace(/^[^@/]+@/, '')
    .replace(':', '/')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

/** The origin URL in a `.git/config` file's text, or null. */
export function originFromGitConfig(text) {
  const m = /\[remote "origin"\][^[]*?\burl\s*=\s*(\S+)/.exec(text ?? '');
  return m ? m[1] : null;
}

const SKIP_DIRS = new Set(['node_modules', '.git']);

/**
 * Folders under `root` (up to `maxDepth` levels) that are another clone of this repo: a `.git`
 * inside them and the same origin, or a package.json named like the root's (a clone made from a
 * local path has a different origin).
 * `fs` is injected for tests: `list(dir)` → [{ name, dir }], `read(path)` → text or null.
 */
export function findNestedClones(root, fs, maxDepth = 4) {
  const base = root.replace(/\/$/, '');
  const ownOrigin = normaliseRemote(originFromGitConfig(fs.read(`${base}/.git/config`)));
  const ownName = packageName(fs.read(`${base}/package.json`));
  const found = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    for (const e of fs.list(dir)) {
      if (!e.dir || SKIP_DIRS.has(e.name)) continue;
      const path = `${dir}/${e.name}`;
      const hasGit = fs.list(path).some((c) => c.name === '.git');
      if (hasGit) {
        const origin = normaliseRemote(originFromGitConfig(fs.read(`${path}/.git/config`)));
        const name = packageName(fs.read(`${path}/package.json`));
        const same =
          Boolean(origin && ownOrigin && origin === ownOrigin) || Boolean(name && name === ownName);
        if (same) {
          found.push(path.slice(base.length + 1));
          continue;
        }
      }
      walk(path, depth + 1);
    }
  };
  walk(base, 1);
  return found;
}

function packageName(text) {
  try {
    return text ? (JSON.parse(text).name ?? null) : null;
  } catch {
    return null;
  }
}

/** A warning for each nested clone (doctor may be running in the wrong one). */
export function checkNestedClones(found, root) {
  if (found.length === 0) return null;
  const base = root.replace(/\/$/, '');
  return warn(
    'nested clone',
    `${found.join(', ')} ${found.length === 1 ? 'is another clone' : 'are other clones'} of this repo inside ${base} — run commands from the one you mean, and move the nested one out`,
  );
}
