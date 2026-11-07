// What Supabase Auth stores (spec 5.4, as changed in docs/SPEC-QUESTIONS.md Q-HASH):
//
//   Supabase Auth password = base64url( HMAC-SHA256( pepper, NFKC(password) ) )   (43 chars)
//
// Supabase Auth then hashes that with its own bcrypt. Why the HMAC step:
//   * the pepper (an edge-function secret, versioned for rotation) means a copy of the
//     database alone can't be used to guess passwords;
//   * bcrypt only uses the first 72 bytes, and a 128-character password can be up to 512
//     bytes of UTF-8 — the 43-character HMAC always fits, so every character counts;
//   * NFKC happens once, here, so the same password typed on iOS and Android matches;
//   * a password only works through auth-api: calling Supabase Auth directly with the
//     user's real password fails.
import { normalisePassword } from '@life-os/core';
import type { PepperKey } from './config.ts';
import { bytesToBase64Url, hmacBytes } from './crypto.ts';

export async function derivePassword(password: string, pepper: PepperKey): Promise<string> {
  return bytesToBase64Url(await hmacBytes(pepper.secret, normalisePassword(password)));
}
