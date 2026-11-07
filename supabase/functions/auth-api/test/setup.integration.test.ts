// A broken local setup must fail loudly (C in the phase 2 end-to-end task): Supabase Auth
// started without supabase/config.toml's [auth.hook.*] settings issues tokens without
// lifeos_scope, which the Data API then refuses. auth-api must refuse to hand such a token out.
//
// Starts a second Supabase Auth (the pinned binary from scripts/local-auth) on :9998 with the
// same database and settings minus the hooks, i.e. what `supabase start` on an old branch runs.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SETUP_PROBLEMS } from '../log.ts';
import { localEnv, startHarness, type Harness } from './harness.ts';

const STATE = fileURLToPath(new URL('../../../../.local-auth/', import.meta.url));
const runnable = localEnv() !== null && existsSync(`${STATE}auth.env`);
const PORT = 9998;

describe.skipIf(!runnable)('auth-api with Supabase Auth hooks not running', () => {
  let gotrue: ChildProcess;
  let h: Harness;

  beforeAll(async () => {
    gotrue = spawn(
      'bash',
      [
        '-c',
        `set -a; source "${STATE}auth.env"; set +a
         for v in $(env | grep -o '^GOTRUE_HOOK_[A-Z_]*'); do unset "$v"; done
         PORT=${PORT} API_EXTERNAL_URL=http://127.0.0.1:${PORT} exec "${STATE}bin/auth/auth" serve`,
      ],
      { stdio: 'ignore' },
    );
    const url = `http://127.0.0.1:${PORT}`;
    for (let i = 0; i < 100; i++) {
      if (
        await fetch(`${url}/health`).then(
          (r) => r.ok,
          () => false,
        )
      )
        break;
      await new Promise((r) => setTimeout(r, 100));
    }
    h = await startHarness({ authUrl: url });
  });

  afterAll(async () => {
    await h?.close();
    gotrue?.kill();
  });

  it('confirming a new account returns SERVER_ERROR, says how to fix it and keeps no session', async () => {
    const email = `hooks-off-${Date.now()}@example.test`;
    const dev = h.device();
    const created = await h.call(
      'POST',
      '/v1/accounts',
      { email, password: 'a long enough password for this test' },
      dev,
    );
    expect(created.status).toBe(202);
    const confirmed = await h.call(
      'POST',
      '/v1/accounts/confirm',
      { challenge_id: created.body.challenge_id, code: h.lastCode(email) },
      dev,
    );
    expect(confirmed.status).toBe(500);
    expect(confirmed.body.error.code).toBe('SERVER_ERROR');
    expect(confirmed.body.tokens).toBeUndefined();
    expect(h.logs).toContain(SETUP_PROBLEMS.HOOKS_NOT_RUNNING);
    const [row] = await h.sql<{ n: number }[]>`
      select count(*)::int as n from auth.sessions s
        join public.auth_accounts a on a.user_id = s.user_id where a.email = ${email}`;
    expect(row?.n).toBe(0);
  });
});
