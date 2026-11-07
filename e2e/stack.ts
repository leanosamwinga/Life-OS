// Where the e2e test finds the local stack, and a few helpers that act like the person
// holding the phone (reading the code from Mailpit).
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface Stack {
  /** What the app has as EXPO_PUBLIC_SUPABASE_URL. */
  apiUrl: string;
  /** What the app has as EXPO_PUBLIC_SUPABASE_ANON_KEY. */
  anonKey: string;
  mailpitUrl: string;
  /** Direct database URL, for checks only (never what the app uses). */
  dbUrl: string | null;
}

/**
 * E2E_API_URL / E2E_ANON_KEY / E2E_MAILPIT_URL / E2E_DB_URL win (e.g. for `supabase start`:
 * http://127.0.0.1:54321, the publishable key, http://127.0.0.1:54324,
 * postgresql://postgres:postgres@127.0.0.1:54322/postgres); otherwise .local-auth/env.
 */
export function findStack(): Stack | null {
  if (process.env.E2E_API_URL && process.env.E2E_ANON_KEY) {
    return {
      apiUrl: process.env.E2E_API_URL,
      anonKey: process.env.E2E_ANON_KEY,
      mailpitUrl: process.env.E2E_MAILPIT_URL ?? 'http://127.0.0.1:54324',
      dbUrl: process.env.E2E_DB_URL ?? null,
    };
  }
  const file = fileURLToPath(new URL('../.local-auth/env', import.meta.url));
  if (!existsSync(file)) return null;
  const env: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line);
    if (m) env[m[1]!] = m[2]!;
  }
  if (!env.LOCAL_API_URL) return null;
  return {
    apiUrl: env.LOCAL_API_URL,
    anonKey: env.LOCAL_ANON_KEY!,
    mailpitUrl: env.LOCAL_MAILPIT_URL!,
    dbUrl: env.LOCAL_DB_URL ?? null,
  };
}

/** The newest 6-digit code Mailpit has for `email` (waits for the outbox to send it). */
export async function codeFromMailpit(stack: Stack, email: string, after = 0): Promise<string> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const r = await fetch(
      `${stack.mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
    );
    const list = (await r.json()) as { messages: { ID: string; Created: string }[] };
    const fresh = list.messages.filter((m) => Date.parse(m.Created) >= after);
    if (fresh.length) {
      const m = (await (
        await fetch(`${stack.mailpitUrl}/api/v1/message/${fresh[0]!.ID}`)
      ).json()) as {
        Text: string;
      };
      const code = /\b(\d{6})\b/.exec(m.Text)?.[1];
      if (code) return code;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no code emailed to ${email}`);
}

export const uniqueEmail = (tag: string) =>
  `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;
