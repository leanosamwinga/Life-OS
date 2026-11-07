// App Attest verification against a locally built chain (a fake "Apple" root and intermediate,
// P-384, and a P-256 credential key), made with openssl. No real Apple material is used.
import { execFileSync } from 'node:child_process';
import { createHash, createPrivateKey, sign as nodeSign } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { verifyAppAttestAssertion, verifyAppAttestation, type AppAttestKey } from './app-attest.ts';

const APP_ID = 'TEAMID1234.test.lifeos.app';
const sha = (...b: Buffer[]) => createHash('sha256').update(Buffer.concat(b)).digest();

// Minimal CBOR encoder for the test fixtures.
function cbor(v: unknown): Buffer {
  const head = (major: number, n: number) =>
    n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
  if (typeof v === 'string') return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cbor)]);
  const entries = Object.entries(v as Record<string, unknown>);
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, x]) => [cbor(k), cbor(x)])]);
}

const openssl = (dir: string, ...args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' });

describe('App Attest', () => {
  let dir: string;
  let rootPem: string;
  let attestation: string;
  let keyIdB64: string;
  let credKeyPem: string;
  const challenge = 'one-time-challenge-from-auth-api';

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'appattest-'));
    openssl(dir, 'ecparam', '-name', 'secp384r1', '-genkey', '-noout', '-out', 'root.key');
    openssl(dir, 'req', '-x509', '-new', '-key', 'root.key', '-subj', '/CN=Fake App Attestation Root CA', '-days', '30', '-out', 'root.pem', '-sha384');
    openssl(dir, 'ecparam', '-name', 'secp384r1', '-genkey', '-noout', '-out', 'int.key');
    openssl(dir, 'req', '-new', '-key', 'int.key', '-subj', '/CN=Fake App Attestation CA 1', '-out', 'int.csr');
    writeFileSync(join(dir, 'int.ext'), 'basicConstraints=critical,CA:true\nkeyUsage=critical,keyCertSign\n');
    openssl(dir, 'x509', '-req', '-in', 'int.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-CAcreateserial', '-days', '30', '-sha384', '-extfile', 'int.ext', '-out', 'int.pem');

    openssl(dir, 'ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'cred.key');
    credKeyPem = readFileSync(join(dir, 'cred.key'), 'utf8');
    const pubDer = execFileSync('openssl', ['ec', '-in', 'cred.key', '-pubout', '-outform', 'DER'], { cwd: dir, stdio: 'pipe' });
    const point = pubDer.subarray(pubDer.length - 65);
    const keyId = sha(point);
    keyIdB64 = keyId.toString('base64');

    const authData = Buffer.concat([
      sha(Buffer.from(APP_ID)),
      Buffer.from([0x40]),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('appattestdevelop'),
      Buffer.from([0, keyId.length]),
      keyId,
    ]);
    const nonce = sha(authData, sha(Buffer.from(challenge)));
    writeFileSync(join(dir, 'leaf.ext'), `1.2.840.113635.100.8.2=DER:3024A1220420${nonce.toString('hex')}\n`);
    openssl(dir, 'req', '-new', '-key', 'cred.key', '-subj', '/CN=credential', '-out', 'leaf.csr');
    openssl(dir, 'x509', '-req', '-in', 'leaf.csr', '-CA', 'int.pem', '-CAkey', 'int.key', '-CAcreateserial', '-days', '30', '-sha256', '-extfile', 'leaf.ext', '-out', 'leaf.pem');
    const der = (f: string) => execFileSync('openssl', ['x509', '-in', f, '-outform', 'DER'], { cwd: dir, stdio: 'pipe' });
    rootPem = readFileSync(join(dir, 'root.pem'), 'utf8');
    attestation = cbor({ fmt: 'apple-appattest', attStmt: { x5c: [der('leaf.pem'), der('int.pem')], receipt: Buffer.from('receipt') }, authData }).toString('base64');
  });

  const attest = (o: Partial<Parameters<typeof verifyAppAttestation>[0]> = {}) =>
    verifyAppAttestation({ keyIdB64, attestationB64: attestation, challenge, appIds: [APP_ID], rootCaPem: rootPem, allowDevelopment: true, ...o });

  it('accepts a valid attestation and returns the credential key', async () => {
    const r = await attest();
    expect(r.publicKeySpki.length).toBeGreaterThan(80);
  });

  it('rejects the wrong challenge, App ID, root, key ID or a development key in production', async () => {
    await expect(attest({ challenge: 'another' })).rejects.toThrow('nonce');
    await expect(attest({ appIds: ['TEAMID1234.someone.else'] })).rejects.toThrow('app id');
    openssl(dir, 'ecparam', '-name', 'secp384r1', '-genkey', '-noout', '-out', 'evil.key');
    openssl(dir, 'req', '-x509', '-new', '-key', 'evil.key', '-subj', '/CN=Fake App Attestation Root CA', '-days', '30', '-out', 'evil.pem', '-sha384');
    await expect(attest({ rootCaPem: readFileSync(join(dir, 'evil.pem'), 'utf8') })).rejects.toThrow('chain');
    await expect(attest({ keyIdB64: Buffer.alloc(32, 1).toString('base64') })).rejects.toThrow('key id');
    await expect(attest({ allowDevelopment: false })).rejects.toThrow('aaguid');
    await expect(attest({ now: new Date(Date.now() + 365 * 86400_000) })).rejects.toThrow('validity');
  });

  it('verifies assertions over the request; the counter must go up', async () => {
    const { publicKeySpki } = await attest();
    const store: AppAttestKey = { keyId: keyIdB64, publicKeySpki, counter: 0 };
    const keys = {
      get: async (id: string) => (id === keyIdB64 ? store : null),
      updateCounter: async (_: string, c: number) => {
        store.counter = c;
      },
    };
    const assertion = (counter: number, clientData: string, key = credKeyPem) => {
      const c = Buffer.alloc(4);
      c.writeUInt32BE(counter);
      const authenticatorData = Buffer.concat([sha(Buffer.from(APP_ID)), Buffer.from([0x40]), c]);
      const nonce = sha(authenticatorData, sha(Buffer.from(clientData)));
      const signature = nodeSign('sha256', nonce, createPrivateKey(key));
      return cbor({ signature, authenticatorData }).toString('base64');
    };
    const body = 'POST /v1/sessions/password\n{"email":"sam@example.test"}';
    const check = (a: string, data = body) => verifyAppAttestAssertion({ assertionB64: a, keyId: keyIdB64, clientData: data, appIds: [APP_ID], keys });
    expect(await check(assertion(1, body))).toBe(true);
    expect(await check(assertion(1, body))).toBe(false); // replay: counter didn't go up
    expect(await check(assertion(2, body), 'POST /v1/sessions/password\n{"email":"other@example.test"}')).toBe(false);
    openssl(dir, 'ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'other.key');
    expect(await check(assertion(3, body, readFileSync(join(dir, 'other.key'), 'utf8')))).toBe(false);
    expect(await check(assertion(4, body))).toBe(true);
  });
});
