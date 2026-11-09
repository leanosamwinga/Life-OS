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
//                                the label" (7e) is tested without the internet — except one
//                                obviously fake drink (FAKE_OFF_DRINK), shaped like OFF's answer
//                                for a 330 ml bottle, so "a drink comes back per 100 ml" (7d-U)
//                                is tested too.
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
/** A made-up 330 ml drink, as Open Food Facts would answer for it (values per 100 ml). */
export const FAKE_OFF_DRINK = {
  code: '0000000000962',
  status: 1,
  status_verbose: 'product found',
  product: {
    code: '0000000000962',
    product_name: 'Sample protein shake',
    brands: 'Sample Brand',
    quantity: '330 ml',
    product_quantity: 330,
    product_quantity_unit: 'ml',
    nutrition_data_per: '100g',
    nutriments: {
      'energy-kcal_100g': 62,
      proteins_100g: 6.1,
      carbohydrates_100g: 6.6,
      fat_100g: 1.2,
    },
  },
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
      [status, body] =
        off[1] === FAKE_OFF_DRINK.code
          ? [200, FAKE_OFF_DRINK]
          : [404, { code: off[1], status: 0, status_verbose: 'product not found' }];
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  })
  .listen(port, host);
