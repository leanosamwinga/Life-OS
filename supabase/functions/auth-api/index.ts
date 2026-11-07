// Supabase Edge Function: auth-api — Life OS sign-in v3 (docs/sign-in-spec.md).
//
// verify_jwt = false in config.toml: sign-in endpoints have no user yet, and authenticated
// endpoints check the Bearer token themselves with Supabase Auth (signature + live session).
//
// Secrets (edge function secrets; never in the repo): see supabase/functions/.env.example.
import postgres from 'postgres';
import { createApp } from './app.ts';
import { configFromEnv } from './config.ts';
import { MailpitSender, type EmailSender } from './email.ts';
import { consoleSink } from './log.ts';

const env = (k: string) => Deno.env.get(k);
const config = configFromEnv((k) => {
  // The edge runtime injects SUPABASE_URL; Auth lives under /auth/v1.
  if (k === 'SUPABASE_AUTH_URL')
    return env(k) ?? (env('SUPABASE_URL') ? `${env('SUPABASE_URL')}/auth/v1` : undefined);
  return env(k);
});

const dbUrl = env('SUPABASE_DB_URL');
if (!dbUrl) throw new Error('SUPABASE_DB_URL must be set');
const sql = postgres(dbUrl, { max: 5, prepare: false, idle_timeout: 20 });

function emailSender(): EmailSender {
  const mailpit = env('MAILPIT_URL');
  if (mailpit) return new MailpitSender(mailpit);
  // The production provider is chosen later (decision 11). Until then nothing is sent from
  // the hosted project, and the outbox keeps the rows (failing after 5 tries).
  return {
    async send() {
      throw new Error('No email provider configured (EmailSender)');
    },
  };
}

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const { handler } = createApp({
  config,
  sql,
  emailSender: emailSender(),
  logSink: consoleSink,
  later: (task) => {
    const p = task().catch(() => undefined);
    if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(p);
  },
});

Deno.serve(handler);
