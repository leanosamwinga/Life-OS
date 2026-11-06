/** Loose email check for the sign-in form; the server is the real judge. */
export const isPlausibleEmail = (email: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

export const MIN_PASSWORD_LENGTH = 8;

/** Local development accounts (see supabase/seed.sql) live at this obviously fake domain. */
export const DEV_ACCOUNT_DOMAIN = 'example.test';

/**
 * The email to sign in with. In development builds a bare username such as "admin" means the
 * seeded local account admin@example.test. Release builds only accept real email addresses.
 */
export function resolveSignInEmail(input: string, dev: boolean): string | null {
  const t = input.trim();
  if (isPlausibleEmail(t)) return t;
  if (dev && /^[a-z0-9._-]{2,40}$/i.test(t)) return `${t.toLowerCase()}@${DEV_ACCOUNT_DOMAIN}`;
  return null;
}
