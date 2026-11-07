// Small Web Crypto helpers that work the same in Deno (edge runtime) and Node (tests).

const enc = new TextEncoder();

export function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

/** 256 random bits, base64url (reset tokens, tickets, nonces, re-auth tokens). */
export function randomToken(): string {
  return bytesToBase64Url(randomBytes(32));
}

/** A uniformly random 6-digit code (no modulo bias). */
export function randomCode(): string {
  const limit = Math.floor(0xffffffff / 1_000_000) * 1_000_000;
  for (;;) {
    const [n] = crypto.getRandomValues(new Uint32Array(1));
    if (n! < limit) return String(n! % 1_000_000).padStart(6, '0');
  }
}

export async function sha256Hex(text: string | Uint8Array): Promise<string> {
  const data = typeof text === 'string' ? enc.encode(text) : text;
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource)));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

export async function hmacBytes(secret: string, message: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(message)),
  );
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  return bytesToHex(await hmacBytes(secret, message));
}

/** Constant-time comparison of two equal-length strings. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function aesKey(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(secret));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** AES-256-GCM (key derived from `secret`), output "v1.<iv>.<ciphertext>" in base64url. */
export async function encryptText(secret: string, plain: string): Promise<string> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      await aesKey(secret),
      enc.encode(plain),
    ),
  );
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(ct)}`;
}

export async function decryptText(secret: string, packed: string): Promise<string> {
  const [v, iv, ct] = packed.split('.');
  if (v !== 'v1' || !iv || !ct) throw new Error('bad ciphertext');
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlToBytes(iv) as BufferSource },
    await aesKey(secret),
    base64UrlToBytes(ct) as BufferSource,
  );
  return new TextDecoder().decode(plain);
}

/** Reads the payload of a JWT WITHOUT checking it. Only for tokens Supabase Auth just issued us. */
export function unsafeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split('.')[1];
  if (!part) throw new Error('not a JWT');
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(part))) as Record<string, unknown>;
}
