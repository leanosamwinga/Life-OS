// Signs a long-lived HS256 API key (anon / service_role) for the LOCAL auth stack only.
//   node scripts/local-auth/sign-jwt.mjs <secret> <role>
import { createHmac } from 'node:crypto';

const [secret, role] = process.argv.slice(2);
if (!secret || !role) {
  console.error('usage: sign-jwt.mjs <secret> <role>');
  process.exit(1);
}
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase-local', role, iat: now, exp: now + 10 * 365 * 24 * 3600 })}`;
const sig = createHmac('sha256', secret).update(body).digest('base64url');
process.stdout.write(`${body}.${sig}`);
