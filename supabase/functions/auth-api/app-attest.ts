// App Attest (iPhone, spec 6.2) on Web Crypto only, so it runs the same in Deno and Node.
//
// Once per install the app attests a key (POST /v1/device/attest): we check Apple's
// certificate chain, the nonce, the App ID and the key ID, then keep the public key. Every
// unauthenticated sign-in request then carries an assertion over that request
// (X-App-Attest, X-App-Attest-Key-Id), which we verify with the stored key; its counter must
// increase every time.
// Apple's reference: https://developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server
import { base64UrlToBytes, bytesToBase64Url } from './crypto.ts';

export interface AppAttestKey {
  keyId: string;
  publicKeySpki: string;
  counter: number;
}

export interface AppAttestKeyStore {
  get(keyId: string): Promise<AppAttestKey | null>;
  updateCounter(keyId: string, counter: number): Promise<void>;
}

// ---------------------------------------------------------------------------- CBOR (subset)

type Cbor = number | Uint8Array | string | Cbor[] | Map<Cbor, Cbor> | boolean | null;

export function decodeCbor(data: Uint8Array): Cbor {
  let pos = 0;
  const readLen = (info: number): number => {
    if (info < 24) return info;
    if (info === 24) return data[pos++]!;
    if (info === 25) {
      const v = (data[pos]! << 8) | data[pos + 1]!;
      pos += 2;
      return v;
    }
    if (info === 26) {
      const v = ((data[pos]! << 24) >>> 0) + (data[pos + 1]! << 16) + (data[pos + 2]! << 8) + data[pos + 3]!;
      pos += 4;
      return v;
    }
    throw new Error('cbor: unsupported length');
  };
  const item = (): Cbor => {
    const byte = data[pos++];
    if (byte === undefined) throw new Error('cbor: truncated');
    const major = byte >> 5;
    const info = byte & 31;
    switch (major) {
      case 0:
        return readLen(info);
      case 1:
        return -1 - readLen(info);
      case 2: {
        const n = readLen(info);
        const out = data.slice(pos, pos + n);
        pos += n;
        return out;
      }
      case 3: {
        const n = readLen(info);
        const out = new TextDecoder().decode(data.slice(pos, pos + n));
        pos += n;
        return out;
      }
      case 4: {
        const n = readLen(info);
        return Array.from({ length: n }, () => item());
      }
      case 5: {
        const n = readLen(info);
        const m = new Map<Cbor, Cbor>();
        for (let i = 0; i < n; i++) m.set(item(), item());
        return m;
      }
      case 7:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        throw new Error('cbor: unsupported simple value');
      default:
        throw new Error('cbor: unsupported type');
    }
  };
  return item();
}

// ---------------------------------------------------------------------------- DER (subset)

interface Der {
  tag: number;
  /** Whole element (header + content). */
  raw: Uint8Array;
  content: Uint8Array;
}

export function readDer(data: Uint8Array, offset = 0): Der & { end: number } {
  const tag = data[offset]!;
  let len = data[offset + 1]!;
  let hdr = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + data[offset + 2 + i]!;
    hdr += n;
  }
  const end = offset + hdr + len;
  if (end > data.length) throw new Error('der: truncated');
  return { tag, raw: data.slice(offset, end), content: data.slice(offset + hdr, end), end };
}

export function derChildren(el: Der): Der[] {
  const out: Der[] = [];
  let p = 0;
  while (p < el.content.length) {
    const c = readDer(el.content, p);
    out.push(c);
    p = c.end;
  }
  return out;
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

function oidToString(content: Uint8Array): string {
  const parts = [Math.floor(content[0]! / 40), content[0]! % 40];
  let v = 0;
  for (let i = 1; i < content.length; i++) {
    v = v * 128 + (content[i]! & 0x7f);
    if (!(content[i]! & 0x80)) {
      parts.push(v);
      v = 0;
    }
  }
  return parts.join('.');
}

function parseTime(el: Der): Date {
  const s = new TextDecoder().decode(el.content);
  if (el.tag === 0x17) {
    // UTCTime YYMMDDHHMMSSZ
    const yy = Number(s.slice(0, 2));
    return new Date(Date.UTC(yy < 50 ? 2000 + yy : 1900 + yy, Number(s.slice(2, 4)) - 1, Number(s.slice(4, 6)), Number(s.slice(6, 8)), Number(s.slice(8, 10)), Number(s.slice(10, 12))));
  }
  return new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)), Number(s.slice(8, 10)), Number(s.slice(10, 12)), Number(s.slice(12, 14))));
}

export interface Cert {
  tbs: Uint8Array;
  sigAlg: string;
  signature: Uint8Array;
  spki: Uint8Array;
  subject: Uint8Array;
  issuer: Uint8Array;
  notBefore: Date;
  notAfter: Date;
  extensions: Map<string, Uint8Array>;
}

export function parseCert(der: Uint8Array): Cert {
  const cert = readDer(der);
  const [tbs, sigAlg, sig] = derChildren(cert);
  const t = derChildren(tbs!);
  let i = 0;
  if (t[0]!.tag === 0xa0) i++; // version
  const issuer = t[i + 2]!;
  const validity = derChildren(t[i + 3]!);
  const subject = t[i + 4]!;
  const spki = t[i + 5]!;
  const extensions = new Map<string, Uint8Array>();
  for (const el of t.slice(i + 6)) {
    if (el.tag !== 0xa3) continue;
    for (const ext of derChildren(derChildren(el)[0]!)) {
      const parts = derChildren(ext);
      const oid = oidToString(parts[0]!.content);
      const value = parts[parts.length - 1]!.content; // OCTET STRING content
      extensions.set(oid, value);
    }
  }
  return {
    tbs: tbs!.raw,
    sigAlg: oidToString(derChildren(sigAlg!)[0]!.content),
    signature: sig!.content.slice(1), // BIT STRING: drop the unused-bits byte
    spki: spki.raw,
    subject: subject.raw,
    issuer: issuer.raw,
    notBefore: parseTime(validity[0]!),
    notAfter: parseTime(validity[1]!),
    extensions,
  };
}

/** The curve of an EC SubjectPublicKeyInfo. */
function spkiCurve(spki: Uint8Array): 'P-256' | 'P-384' {
  const alg = derChildren(derChildren(readDer(spki))[0]!);
  const curve = oidToString(alg[1]!.content);
  if (curve === '1.2.840.10045.3.1.7') return 'P-256';
  if (curve === '1.3.132.0.34') return 'P-384';
  throw new Error(`unsupported curve ${curve}`);
}

/** ECDSA DER signature → raw r||s for Web Crypto. */
export function derSigToRaw(sig: Uint8Array, size: number): Uint8Array {
  const [r, s] = derChildren(readDer(sig));
  const fix = (b: Uint8Array) => {
    let x = b;
    while (x.length > size && x[0] === 0) x = x.slice(1);
    const out = new Uint8Array(size);
    out.set(x, size - x.length);
    return out;
  };
  const out = new Uint8Array(size * 2);
  out.set(fix(r!.content), 0);
  out.set(fix(s!.content), size);
  return out;
}

async function importEc(spki: Uint8Array): Promise<{ key: CryptoKey; size: number }> {
  const curve = spkiCurve(spki);
  const key = await crypto.subtle.importKey('spki', spki as BufferSource, { name: 'ECDSA', namedCurve: curve }, false, ['verify']);
  return { key, size: curve === 'P-256' ? 32 : 48 };
}

async function verifyEcdsa(spki: Uint8Array, hash: 'SHA-256' | 'SHA-384', derSig: Uint8Array, data: Uint8Array) {
  const { key, size } = await importEc(spki);
  return crypto.subtle.verify({ name: 'ECDSA', hash }, key, derSigToRaw(derSig, size) as BufferSource, data as BufferSource);
}

const SIG_HASH: Record<string, 'SHA-256' | 'SHA-384'> = {
  '1.2.840.10045.4.3.2': 'SHA-256',
  '1.2.840.10045.4.3.3': 'SHA-384',
};

async function certSignedBy(child: Cert, parent: Cert): Promise<boolean> {
  const hash = SIG_HASH[child.sigAlg];
  if (!hash || hex(child.issuer) !== hex(parent.subject)) return false;
  return verifyEcdsa(parent.spki, hash, child.signature, child.tbs);
}

export function pemToDer(pem: string): Uint8Array {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return base64UrlToBytes(b64.replace(/\+/g, '-').replace(/\//g, '_'));
}

async function sha256(...parts: Uint8Array[]): Promise<Uint8Array> {
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.length;
  }
  return new Uint8Array(await crypto.subtle.digest('SHA-256', all as BufferSource));
}

const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

const NONCE_OID = '1.2.840.113635.100.8.2';
const AAGUID_PROD = new TextEncoder().encode('appattest\0\0\0\0\0\0\0');
const AAGUID_DEV = new TextEncoder().encode('appattestdevelop');

/** The EC point inside an SPKI (uncompressed, 65 bytes for P-256). */
function spkiPoint(spki: Uint8Array): Uint8Array {
  return derChildren(readDer(spki))[1]!.content.slice(1);
}

function asBytes(v: Cbor | undefined): Uint8Array {
  if (!(v instanceof Uint8Array)) throw new Error('expected bytes');
  return v;
}

export interface AttestationInput {
  keyIdB64: string;
  attestationB64: string;
  /** The one-time challenge we gave the app (raw string). */
  challenge: string;
  appIds: string[];
  rootCaPem: string;
  allowDevelopment: boolean;
  now?: Date;
}

/** Verifies an App Attest attestation and returns the credential's public key (SPKI, base64url). */
export async function verifyAppAttestation(input: AttestationInput): Promise<{ publicKeySpki: string }> {
  const now = input.now ?? new Date();
  const obj = decodeCbor(b64(input.attestationB64)) as Map<Cbor, Cbor>;
  if (obj.get('fmt') !== 'apple-appattest') throw new Error('fmt');
  const stmt = obj.get('attStmt') as Map<Cbor, Cbor>;
  const x5c = (stmt.get('x5c') as Cbor[]).map(asBytes);
  const authData = asBytes(obj.get('authData'));
  if (x5c.length < 2) throw new Error('x5c');
  const leaf = parseCert(x5c[0]!);
  const intermediate = parseCert(x5c[1]!);
  const root = parseCert(pemToDer(input.rootCaPem));
  for (const c of [leaf, intermediate]) if (now < c.notBefore || now > c.notAfter) throw new Error('validity');
  if (!(await certSignedBy(leaf, intermediate)) || !(await certSignedBy(intermediate, root))) throw new Error('chain');

  const clientDataHash = await sha256(new TextEncoder().encode(input.challenge));
  const nonce = await sha256(authData, clientDataHash);
  const ext = leaf.extensions.get(NONCE_OID);
  if (!ext) throw new Error('nonce ext');
  // SEQUENCE { [1] { OCTET STRING nonce } }
  const seq = readDer(ext);
  const tagged = derChildren(seq)[0]!;
  const octet = derChildren(tagged)[0]!;
  if (!equal(octet.content, nonce)) throw new Error('nonce');

  const keyId = b64(input.keyIdB64);
  if (!equal(await sha256(spkiPoint(leaf.spki)), keyId)) throw new Error('key id');

  const rpIdHash = authData.slice(0, 32);
  const appOk = await Promise.all(input.appIds.map(async (id) => equal(await sha256(new TextEncoder().encode(id)), rpIdHash)));
  if (!appOk.some(Boolean)) throw new Error('app id');
  const counter = new DataView(authData.buffer, authData.byteOffset).getUint32(33);
  if (counter !== 0) throw new Error('counter');
  const aaguid = authData.slice(37, 53);
  if (!equal(aaguid, AAGUID_PROD) && !(input.allowDevelopment && equal(aaguid, AAGUID_DEV))) throw new Error('aaguid');
  const credLen = (authData[53]! << 8) | authData[54]!;
  if (!equal(authData.slice(55, 55 + credLen), keyId)) throw new Error('credential id');
  return { publicKeySpki: bytesToBase64Url(leaf.spki) };
}

function b64(text: string): Uint8Array {
  return base64UrlToBytes(text.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
}

/** Verifies an assertion over `clientData` with the stored key; the counter must go up. */
export async function verifyAppAttestAssertion(input: {
  assertionB64: string;
  keyId: string;
  clientData: string;
  appIds: string[];
  keys: AppAttestKeyStore;
}): Promise<boolean> {
  try {
    const stored = await input.keys.get(input.keyId);
    if (!stored) return false;
    const obj = decodeCbor(b64(input.assertionB64)) as Map<Cbor, Cbor>;
    const signature = asBytes(obj.get('signature'));
    const authData = asBytes(obj.get('authenticatorData'));
    const clientDataHash = await sha256(new TextEncoder().encode(input.clientData));
    const nonce = await sha256(authData, clientDataHash);
    const spki = b64(stored.publicKeySpki);
    if (!(await verifyEcdsa(spki, 'SHA-256', signature, nonce))) return false;
    const rpIdHash = authData.slice(0, 32);
    const appOk = await Promise.all(input.appIds.map(async (id) => equal(await sha256(new TextEncoder().encode(id)), rpIdHash)));
    if (!appOk.some(Boolean)) return false;
    const counter = new DataView(authData.buffer, authData.byteOffset).getUint32(33);
    if (counter <= stored.counter) return false;
    await input.keys.updateCounter(input.keyId, counter);
    return true;
  } catch {
    return false;
  }
}
