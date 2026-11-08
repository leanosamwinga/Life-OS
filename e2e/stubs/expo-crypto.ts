import { createHash, randomBytes } from 'node:crypto';
export const CryptoDigestAlgorithm = { SHA256: 'SHA-256' } as const;
export const CryptoEncoding = { HEX: 'hex', BASE64: 'base64' } as const;
export function getRandomBytes(n: number) {
  return new Uint8Array(randomBytes(n));
}
export async function digestStringAsync(
  _alg: string,
  text: string,
  opts: { encoding?: 'hex' | 'base64' } = {},
) {
  return createHash('sha256')
    .update(text)
    .digest(opts.encoding ?? 'hex');
}
