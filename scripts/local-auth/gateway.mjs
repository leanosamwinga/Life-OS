// A small stand-in for Supabase's API gateway (Kong) for the Docker-free local stack.
// LOCAL ONLY. Routes exactly the way `supabase start` does on :54321:
//
//   /auth/v1/*            → Supabase Auth (GoTrue)              apikey required (like Kong key-auth)
//   /rest/v1/*            → PostgREST (Data API)                apikey required
//   /functions/v1/<name>  → that edge function (Deno), path kept as /<name>/…; functions with
//                           verify_jwt = true in config.toml need a valid HS256 JWT (anon or user)
//
// Usage: node scripts/local-auth/gateway.mjs   (env: GATEWAY_HOST, GATEWAY_PORT, AUTH_UPSTREAM,
// REST_UPSTREAM, FUNCTIONS = "auth-api=http://127.0.0.1:54331:nojwt,food-lookup=…:jwt",
// JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY)
import http from 'node:http';
import { jwtVerify } from 'jose';

const env = process.env;
const host = env.GATEWAY_HOST ?? '127.0.0.1';
const port = Number(env.GATEWAY_PORT ?? 54321);
const keys = new Set([env.ANON_KEY, env.SERVICE_ROLE_KEY].filter(Boolean));
const secret = new TextEncoder().encode(env.JWT_SECRET ?? '');
const functions = new Map(
  (env.FUNCTIONS ?? '')
    .split(',')
    .filter(Boolean)
    .map((entry) => {
      const [name, rest] = entry.split('=');
      const verifyJwt = rest.endsWith(':jwt');
      return [name, { url: rest.replace(/:(no)?jwt$/, ''), verifyJwt }];
    }),
);

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function proxy(req, res, upstream, path) {
  const target = new URL(path, upstream);
  const headers = { ...req.headers, host: target.host };
  // Kong adds these; auth-api reads the client IP from x-forwarded-for.
  // Like Kong: append the peer address to any X-Forwarded-For the client sent.
  const peer = req.socket.remoteAddress ?? '127.0.0.1';
  headers['x-forwarded-for'] = req.headers['x-forwarded-for']
    ? `${req.headers['x-forwarded-for']}, ${peer}`
    : peer;
  headers['x-forwarded-host'] = req.headers.host ?? `${host}:${port}`;
  headers['x-forwarded-proto'] = 'http';
  const up = http.request(target, { method: req.method, headers }, (upRes) => {
    res.writeHead(upRes.statusCode ?? 502, upRes.headers);
    upRes.pipe(res);
  });
  up.on('error', () => {
    if (!res.headersSent)
      send(res, 502, { message: 'An invalid response was received from the upstream server' });
    else res.destroy();
  });
  req.pipe(up);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://gateway');
  const path = url.pathname + url.search;
  if (url.pathname === '/health') return send(res, 200, { ok: true });

  if (url.pathname.startsWith('/auth/v1/') || url.pathname.startsWith('/rest/v1/')) {
    const apikey = req.headers.apikey ?? url.searchParams.get('apikey');
    if (!apikey || !keys.has(String(apikey))) {
      return send(res, 401, { message: 'Invalid API key' });
    }
    const auth = url.pathname.startsWith('/auth/v1/');
    return proxy(
      req,
      res,
      auth ? env.AUTH_UPSTREAM : env.REST_UPSTREAM,
      path.replace(auth ? /^\/auth\/v1/ : /^\/rest\/v1/, ''),
    );
  }

  const fn = /^\/functions\/v1\/([^/?]+)/.exec(url.pathname);
  if (fn) {
    const target = functions.get(fn[1]);
    if (!target) return send(res, 404, { message: 'Function not found' });
    if (target.verifyJwt && req.method !== 'OPTIONS') {
      const bearer = /^Bearer (.+)$/i.exec(req.headers.authorization ?? '')?.[1];
      try {
        if (!bearer) throw new Error('missing');
        await jwtVerify(bearer, secret);
      } catch {
        return send(res, 401, { code: 401, message: 'Invalid JWT' });
      }
    }
    return proxy(req, res, target.url, path.replace(/^\/functions\/v1/, ''));
  }
  send(res, 404, { message: 'no Route matched with those values' });
});

server.listen(port, host, () => {
  console.warn(`gateway on http://${host}:${port}`);
});
