// Local stand-ins for the outside services the Docker-free stack can't (and shouldn't) call in
// tests. LOCAL ONLY — started by scripts/local-auth/start.sh unless LOCAL_FAKES=off.
//
//   /apple/keys, /google/certs   JWKS for a fake Apple and a fake Google: freshly generated RSA
//                                keys on every start, the same issuers and audiences as the
//                                integration tests (supabase/functions/auth-api/test/harness.ts).
//                                The private keys go to .local-auth/fakes.json (git-ignored) so
//                                the e2e test can sign ID tokens like Apple's and Google's.
//   /off/api/v2/product/<code>   Open Food Facts: answers every barcode the way OFF answers an
//                                unknown product (404, status 0), so "not found → add it from
//                                the label" (7e) is tested without the internet.
//
// No real Apple, Google or Open Food Facts account, key or request is involved.
//
// Usage: node scripts/local-auth/fakes.mjs <state dir>   (env FAKES_HOST, FAKES_PORT)
import { writeFileSync } from 'node:fs';
import http from 'node:http';
import { exportJWK, generateKeyPair } from 'jose';

export const FAKE_APPLE = {
  issuer: 'https://appleid.apple.test',
  bundleId: 'test.lifeos.app',
  servicesId: 'test.lifeos.web',
  kid: 'fake-apple-1',
};
export const FAKE_GOOGLE = {
  issuer: 'https://accounts.google.test',
  clientId: 'test-google-client.apps.example.test',
  kid: 'fake-google-1',
};

const stateDir = process.argv[2];
const host = process.env.FAKES_HOST ?? '127.0.0.1';
const port = Number(process.env.FAKES_PORT ?? 54333);
if (!stateDir) throw new Error('usage: node fakes.mjs <state dir>');

const pair = async (kid) => {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const meta = { kid, alg: 'RS256', use: 'sig' };
  return {
    publicJwk: { ...(await exportJWK(publicKey)), ...meta },
    privateJwk: { ...(await exportJWK(privateKey)), ...meta },
  };
};
const apple = await pair(FAKE_APPLE.kid);
const google = await pair(FAKE_GOOGLE.kid);
const base = `http://${host}:${port}`;

writeFileSync(
  `${stateDir}/fakes.json`,
  JSON.stringify(
    {
      note: 'LOCAL ONLY test keys, regenerated on every start (scripts/local-auth/fakes.mjs)',
      apple: { ...FAKE_APPLE, jwksUrl: `${base}/apple/keys`, privateJwk: apple.privateJwk },
      google: { ...FAKE_GOOGLE, jwksUrl: `${base}/google/certs`, privateJwk: google.privateJwk },
      openFoodFactsUrl: `${base}/off`,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);

const routes = {
  '/apple/keys': () => [200, { keys: [apple.publicJwk] }],
  '/google/certs': () => [200, { keys: [google.publicJwk] }],
  '/health': () => [200, { ok: true }],
};

http
  .createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    let [status, body] = routes[path]?.() ?? [404, { error: 'not found' }];
    const off = /^\/off\/api\/v2\/product\/([^/]+)\.json$/.exec(path);
    if (off)
      [status, body] = [404, { code: off[1], status: 0, status_verbose: 'product not found' }];
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  })
  .listen(port, host);
