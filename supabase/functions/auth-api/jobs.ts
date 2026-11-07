// Background work, run by POST /v1/internal/jobs/run (pg_cron → pg_net every minute in the
// hosted project; tests call it directly):
//   * send due emails from the outbox, then clear the address and params from the row;
//   * revoke Apple tokens queued by the day-30 deletion job.
import type { Sql } from 'postgres';
import type { AuthConfig } from './config.ts';
import { decryptText } from './crypto.ts';
import { renderEmail, type EmailSender, type EmailTemplate } from './email.ts';
import type { AuthLogger } from './log.ts';

export async function drainOutbox(
  sql: Sql,
  sender: EmailSender,
  log: AuthLogger,
  limit = 50,
): Promise<number> {
  let sent = 0;
  for (;;) {
    const rows = await sql<
      {
        id: string;
        to_email: string;
        template: EmailTemplate;
        params: Record<string, unknown>;
        attempts: number;
      }[]
    >`
      update public.auth_email_outbox set attempts = attempts + 1, send_after = now() + interval '2 minutes'
       where id in (select id from public.auth_email_outbox
                     where sent_at is null and failed_at is null and send_after <= now()
                     order by created_at limit ${limit} for update skip locked)
       returning id, to_email, template, params, attempts`;
    if (!rows.length) return sent;
    for (const row of rows) {
      try {
        const email = renderEmail(row.template, row.params ?? {});
        await sender.send({ to: row.to_email, ...email });
        await sql`update public.auth_email_outbox set sent_at = now(), to_email = null, params = '{}'::jsonb where id = ${row.id}`;
        log.event('auth.email.sent', { template: row.template });
        sent++;
      } catch {
        if (row.attempts >= 5) {
          await sql`update public.auth_email_outbox set failed_at = now(), to_email = null, params = '{}'::jsonb where id = ${row.id}`;
        }
        log.event('auth.email.failed', { template: row.template, count: row.attempts });
      }
    }
    if (rows.length < limit) return sent;
  }
}

export async function processAppleRevocations(
  sql: Sql,
  config: AuthConfig,
  revoke: (refreshToken: string) => Promise<boolean>,
  log: AuthLogger,
): Promise<number> {
  const rows = await sql<{ id: string; refresh_token_enc: string; attempts: number }[]>`
    update public.auth_apple_revocations set attempts = attempts + 1
     where id in (select id from public.auth_apple_revocations where revoked_at is null and attempts < 10
                   order by created_at limit 50 for update skip locked)
     returning id, refresh_token_enc, attempts`;
  let done = 0;
  for (const row of rows) {
    try {
      const ok = await revoke(await decryptText(config.tokenEncKey, row.refresh_token_enc));
      if (ok) {
        await sql`update public.auth_apple_revocations set revoked_at = now(), refresh_token_enc = 'revoked' where id = ${row.id}`;
        done++;
      }
    } catch {
      log.event('auth.apple.revoke_failed', { count: row.attempts });
    }
  }
  return done;
}
