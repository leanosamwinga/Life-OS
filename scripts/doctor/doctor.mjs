#!/usr/bin/env node
// npm run doctor — is the local setup right for running Life OS on a phone?
// Prints one line per check with the fix, and exits 1 if anything is wrong.
//
//   npm run doctor                 checks for a phone (Expo Go / dev build on your Wi-Fi)
//   npm run doctor -- --simulator  127.0.0.1 is fine (iOS simulator, web)
//
// Works with `npx supabase start` (Docker; the CLI installed or only used through npx) or the
// Docker-free `npm run local-auth` stack. Every fix it prints spells the CLI `npx supabase …`.
/* eslint-disable no-console -- a command-line tool that prints its report */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import {
  SUPABASE,
  appleHealthNote,
  checkAppEnv,
  checkFunctionsEnv,
  checkNestedClones,
  findNestedClones,
  checkLegacySupabaseEnv,
  checkPhoneUrl,
  fail,
  line,
  parseEnv,
  pass,
  supabaseStatus,
  warn,
  whereLines,
} from './checks.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const target = process.argv.includes('--simulator') ? 'simulator' : 'phone';
const read = (p) => (existsSync(ROOT + p) ? parseEnv(readFileSync(ROOT + p, 'utf8')) : null);
const sh = (cmd, args, timeout = 15_000) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout });
const results = [];
const report = (r) => {
  results.push(r);
  console.log(line(r));
};

// ---------------------------------------------------------------- 0. which checkout?
let branch = null;
try {
  branch = sh('git', ['-C', ROOT, 'rev-parse', '--abbrev-ref', 'HEAD'], 5000).trim();
} catch {
  /* not a git checkout */
}
for (const l of whereLines(ROOT, branch)) console.log(l);
console.log('');
const nested = checkNestedClones(
  findNestedClones(ROOT, {
    list: (dir) => {
      try {
        return readdirSync(dir, { withFileTypes: true }).map((e) => ({
          name: e.name,
          dir: e.isDirectory() || e.name === '.git',
        }));
      } catch {
        return [];
      }
    },
    read: (p) => {
      try {
        return readFileSync(p, 'utf8');
      } catch {
        return null;
      }
    },
  }),
  ROOT,
);
if (nested) report(nested);

async function http(url, init = {}, ms = 4000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------- 1. which stack?
function findStack() {
  let docker = false;
  try {
    sh('docker', ['info', '--format', '{{.ServerVersion}}'], 8000);
    docker = true;
  } catch {
    /* no daemon */
  }
  if (docker) {
    // The Supabase CLI may be installed, or only used through npx.
    const env = supabaseStatus(sh);
    const api = env?.API_URL;
    if (env && api) {
      return {
        kind: `${SUPABASE} start`,
        api,
        db: env.DB_URL,
        mailpit: env.INBUCKET_URL ?? env.MAILPIT_URL ?? 'http://127.0.0.1:54324',
        service: env.SERVICE_ROLE_KEY ?? env.SECRET_KEY,
        keys: [env.ANON_KEY, env.PUBLISHABLE_KEY].filter(Boolean),
        secretKeys: [env.SERVICE_ROLE_KEY, env.SECRET_KEY].filter(Boolean),
        functionsEnvPath: 'supabase/functions/.env',
        projectId: /project_id\s*=\s*"([^"]+)"/.exec(
          readFileSync(ROOT + 'supabase/config.toml', 'utf8'),
        )?.[1],
      };
    }
  }
  const local = read('.local-auth/env');
  if (local?.LOCAL_API_URL) {
    return {
      kind: 'npm run local-auth (no Docker)',
      api: local.LOCAL_API_URL,
      db: local.LOCAL_DB_URL,
      mailpit: local.LOCAL_MAILPIT_URL,
      service: local.LOCAL_SERVICE_ROLE_KEY,
      keys: [local.LOCAL_ANON_KEY],
      secretKeys: [local.LOCAL_SERVICE_ROLE_KEY],
      functionsEnvPath: '.local-auth/functions.env',
    };
  }
  return { kind: null, docker };
}

const stack = findStack();
const isDocker = stack.kind === `${SUPABASE} start` || !stack.kind;
const restart = isDocker ? `${SUPABASE} stop && ${SUPABASE} start` : 'npm run local-auth';
const resetDb = isDocker ? `${SUPABASE} db reset` : 'npm run local-auth';
const serveFunctions = isDocker
  ? `${SUPABASE} functions serve --env-file supabase/functions/.env`
  : 'npm run local-auth';
if (!stack.kind) {
  report(
    fail(
      'local stack',
      stack.docker
        ? `Docker is running but Supabase isn't — run \`${SUPABASE} start\` (then \`${SUPABASE} db reset\` after switching branches)`
        : `no Docker and no Docker-free stack — start Docker and run \`${SUPABASE} start\`, or run \`npm run local-auth\``,
    ),
  );
} else {
  const health = await http(`${stack.api}/auth/v1/health`, {
    headers: { apikey: stack.keys[0] ?? '' },
  }).catch(() => null);
  report(
    health && health.status === 200
      ? pass('local stack', `${stack.kind} at ${stack.api}`)
      : fail(
          'local stack',
          `${stack.kind} found but ${stack.api} doesn't answer — run \`${restart}\``,
        ),
  );
}

// ---------------------------------------------------------------- 2. database migrated + Data API guard
if (stack.kind && stack.db) {
  const sql = postgres(stack.db, { max: 1, connect_timeout: 5, onnotice: () => undefined });
  try {
    const [{ accounts }] =
      await sql`select to_regclass('public.auth_accounts') is not null as accounts`;
    const [{ cfg }] =
      await sql`select coalesce(rolconfig, '{}') as cfg from pg_roles where rolname = 'authenticator'`;
    if (!accounts)
      report(
        fail(
          'database',
          `sign-in v3 tables are missing — this branch's migrations aren't applied: run \`${resetDb}\``,
        ),
      );
    else if (!cfg.includes('pgrst.db_pre_request=public.check_request'))
      report(
        fail(
          'database',
          `the Data API guard (pgrst.db_pre_request) isn't set — run \`${resetDb}\``,
        ),
      );
    else report(pass('database', 'migrations applied; Data API runs public.check_request'));
  } catch (e) {
    report(
      warn(
        'database',
        `couldn't connect to ${stack.db.replace(/:[^:@/]+@/, ':…@')} (${e.code ?? e.message})`,
      ),
    );
  } finally {
    await sql.end({ timeout: 1 }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------- 3. config.toml applied: hooks running?
// A throwaway Supabase Auth user (admin API, so no hooks for creating it) asks for a session
// through a magic-link token. With the custom access token hook running, Supabase Auth refuses
// it ("Sign in through Life OS.", no auth-api permit). Without it, a session is issued — the
// stack was started with another branch's config.toml.
if (stack.kind && stack.service) {
  const admin = {
    apikey: stack.service,
    Authorization: `Bearer ${stack.service}`,
    'Content-Type': 'application/json',
  };
  const email = `doctor-${Date.now()}@example.test`;
  let userId = null;
  try {
    const created = await http(`${stack.api}/auth/v1/admin/users`, {
      method: 'POST',
      headers: admin,
      body: JSON.stringify({ email, email_confirm: true }),
    });
    userId = created.body?.id ?? null;
    const link = await http(`${stack.api}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: admin,
      body: JSON.stringify({ type: 'magiclink', email }),
    });
    const tokenHash = link.body?.properties?.hashed_token ?? link.body?.hashed_token;
    const verify = await http(`${stack.api}/auth/v1/verify`, {
      method: 'POST',
      headers: { apikey: stack.keys[0], 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'magiclink', token_hash: tokenHash }),
    });
    if (!userId || !tokenHash)
      report(warn('Auth hooks (config.toml)', "couldn't create a test user to check"));
    else if (verify.body?.access_token)
      report(
        fail(
          'Auth hooks (config.toml)',
          `Supabase Auth hooks aren't running — run \`${restart}\` (config.toml is only read at start)`,
        ),
      );
    else
      report(
        pass(
          'Auth hooks (config.toml)',
          "custom access token hook refuses sessions auth-api didn't permit",
        ),
      );
  } catch (e) {
    report(warn('Auth hooks (config.toml)', `couldn't check (${e.message})`));
  } finally {
    if (userId)
      await http(`${stack.api}/auth/v1/admin/users/${userId}`, {
        method: 'DELETE',
        headers: admin,
      }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------- 4–5. env files
const appEnv = read('apps/mobile/.env.local');
const fnEnv = stack.kind ? read(stack.functionsEnvPath) : read('supabase/functions/.env');
// supabase/.env held the Apple/Google ids before sign-in v3 (Supabase Auth's own providers).
const legacy = isDocker ? read('supabase/.env') : null;
report(checkFunctionsEnv(fnEnv, appEnv, stack.kind ? stack.functionsEnvPath : undefined, legacy));
const leftover = checkLegacySupabaseEnv(legacy, fnEnv);
if (leftover) report(leftover);
report(checkAppEnv(appEnv, stack.kind ? stack : null));

// ---------------------------------------------------------------- 6. auth-api answers
if (stack.kind) {
  const r = await http(`${stack.api}/functions/v1/auth-api/v1/doctor`, {
    headers: { apikey: stack.keys[0] ?? '', Authorization: `Bearer ${stack.keys[0] ?? ''}` },
  }).catch(() => null);
  if (r?.body?.error?.code) report(pass('auth-api', 'running'));
  else
    report(
      fail(
        'auth-api',
        `not answering (${r ? `HTTP ${r.status}` : 'no response'}) — run \`${serveFunctions}\` and read its output`,
      ),
    );
}

// ---------------------------------------------------------------- 7. Mailpit from auth-api
if (stack.kind && fnEnv?.MAILPIT_URL) {
  const name = 'Mailpit from auth-api';
  const url = new URL(fnEnv.MAILPIT_URL);
  const port = url.port || '80';
  if (stack.kind === `${SUPABASE} start`) {
    const container = `supabase_edge_runtime_${stack.projectId ?? 'life-os'}`;
    try {
      sh(
        'docker',
        ['exec', container, 'bash', '-c', `exec 3<>/dev/tcp/${url.hostname}/${port}`],
        8000,
      );
      report(pass(name, `${fnEnv.MAILPIT_URL} reachable from ${container}`));
    } catch (e) {
      const notRunning = /No such container|is not running/.test(String(e.stderr ?? ''));
      report(
        notRunning
          ? warn(name, `couldn't check: ${container} isn't running — start \`${serveFunctions}\``)
          : fail(
              name,
              `${fnEnv.MAILPIT_URL} unreachable from the edge runtime — on Linux Docker use MAILPIT_URL=http://supabase_inbucket_${stack.projectId ?? 'life-os'}:8025 in supabase/functions/.env`,
            ),
      );
    }
  } else {
    const r = await http(`${fnEnv.MAILPIT_URL}/api/v1/info`).catch(() => null);
    report(
      r?.status === 200
        ? pass(name, fnEnv.MAILPIT_URL)
        : fail(name, `${fnEnv.MAILPIT_URL} doesn't answer — run \`npm run local-auth\` again`),
    );
  }
}

// ---------------------------------------------------------------- 8. the phone can reach the API
if (appEnv?.EXPO_PUBLIC_SUPABASE_URL) {
  const addresses = Object.values(networkInterfaces())
    .flat()
    .filter(Boolean)
    .map((i) => i.address);
  const byAddress = checkPhoneUrl(appEnv.EXPO_PUBLIC_SUPABASE_URL, addresses, target);
  if (byAddress.ok === false) report(byAddress);
  else {
    const r = await http(`${appEnv.EXPO_PUBLIC_SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: appEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '' },
    }).catch(() => null);
    report(
      r?.status === 200
        ? pass(
            byAddress.name,
            `${appEnv.EXPO_PUBLIC_SUPABASE_URL} answers (if the phone still can't connect, open ${appEnv.EXPO_PUBLIC_SUPABASE_URL}/auth/v1/health in its browser and allow incoming connections in macOS Firewall)`,
          )
        : fail(
            byAddress.name,
            `${appEnv.EXPO_PUBLIC_SUPABASE_URL} doesn't answer here${r ? ` (HTTP ${r.status})` : ''} — ${
              isDocker
                ? `start Supabase first (\`${SUPABASE} start\`), then \`${SUPABASE} functions serve --env-file supabase/functions/.env\``
                : 'start the Docker-free stack with LOCAL_STACK_HOST=0.0.0.0 npm run local-auth'
            }`,
          ),
    );
  }
}

// ---------------------------------------------------------------- 9. Apple Health (Phase 3)
if (target === 'phone') report(appleHealthNote());

const bad = results.filter((r) => r.ok === false).length;
console.log(bad ? `\n${bad} thing${bad === 1 ? '' : 's'} to fix.` : '\nAll good.');
process.exitCode = bad ? 1 : 0;
