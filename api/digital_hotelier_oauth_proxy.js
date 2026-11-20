
'use strict';

const http = require('node:http');
const { randomBytes, timingSafeEqual } = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);

const CLIENT_ID = process.env.OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET;
const UPSTREAM_TOKEN = process.env.DIGITAL_HOTELIER_TOKEN;

const TOKEN_LIFETIME_SECONDS = 3600;
const tokens = new Map();

if (!CLIENT_ID || !CLIENT_SECRET || !UPSTREAM_TOKEN) {
  console.error(
    'Set OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET and DIGITAL_HOTELIER_TOKEN.'
  );
  process.exit(1);
}

function reply(res, status, value, extra = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extra
  });
  res.end(JSON.stringify(value));
}

function equal(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function bearerToken(req) {
  const match = /^Bearer\s+(\S+)$/i.exec(
    req.headers.authorization || ''
  );

  if (!match) return null;

  const expiry = tokens.get(match[1]);

  if (!expiry || expiry <= Date.now()) {
    if (expiry) tokens.delete(match[1]);
    return null;
  }

  return match[1];
}

async function readBody(req, limit = 8192) {
  let result = '';

  for await (const chunk of req) {
    result += chunk.toString('utf8');

    if (Buffer.byteLength(result) > limit) {
      throw new Error('request_too_large');
    }
  }

  return result;
}

// OAuth 2.0 Client Credentials endpoint
async function tokenEndpoint(req, res) {
  let data;

  try {
    data = new URLSearchParams(await readBody(req));
  } catch {
    return reply(res, 400, { error: 'invalid_request' });
  }

  if (data.get('grant_type') !== 'client_credentials') {
    return reply(res, 400, {
      error: 'unsupported_grant_type'
    });
  }

  let id = data.get('client_id') || '';
  let secret = data.get('client_secret') || '';

  const basic = /^Basic\s+(.+)$/i.exec(
    req.headers.authorization || ''
  );

  if (basic) {
    try {
      const decoded = Buffer.from(
        basic[1], 'base64'
      ).toString('utf8');

      const separator = decoded.indexOf(':');

      if (separator < 0) throw new Error('invalid_basic');

      id = decodeURIComponent(
        decoded.slice(0, separator).replace(/\+/g, '%20')
      );

      secret = decodeURIComponent(
        decoded.slice(separator + 1).replace(/\+/g, '%20')
      );
    } catch {
      return reply(res, 401,
        { error: 'invalid_client' },
        { 'WWW-Authenticate': 'Basic realm="oauth"' }
      );
    }
  }

  if (!equal(id, CLIENT_ID) || !equal(secret, CLIENT_SECRET)) {
    return reply(res, 401,
      { error: 'invalid_client' },
      { 'WWW-Authenticate': 'Basic realm="oauth"' }
    );
  }

  const token = randomBytes(32).toString('base64url');

  tokens.set(
    token,
    Date.now() + TOKEN_LIFETIME_SECONDS * 1000
  );

  if (tokens.size > 1000) {
    for (const [key, expiry] of tokens) {
      if (expiry <= Date.now()) tokens.delete(key);
    }
  }

  return reply(res, 200, {
    access_token: token,
    token_type: 'Bearer',
    expires_in: TOKEN_LIFETIME_SECONDS
  });
}

// Secured Digital Hotelier GET API
async function itemsEndpoint(req, res, hotelId, requestUrl) {
  if (!bearerToken(req)) {
    return reply(res, 401,
      { error: 'invalid_token' },
      {
        'WWW-Authenticate':
          'Bearer realm="hotelier", error="invalid_token"'
      }
    );
  }

  const upstream = new URL(
    `https://dashboard.thedigitalhotelier.com/api/feed-data/businesses/${hotelId}/items`
  );

  for (const key of ['page', 'per_page']) {
    const value = requestUrl.searchParams.get(key);

    if (value !== null) {
      if (!/^\d{1,5}$/.test(value)) {
        return reply(res, 400, {
          error: 'invalid_pagination'
        });
      }
      upstream.searchParams.set(key, value);
    }
  }

  try {
    const response = await fetch(upstream, {
      headers: {
        Authorization: `Bearer ${UPSTREAM_TOKEN}`,
        Accept: 'application/json'
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      console.error(
        'Digital Hotelier returned:',
        response.status
      );

      return reply(
        res,
        response.status === 404 ? 404 : 502,
        {
          error: 'upstream_request_failed',
          upstream_status: response.status
        }
      );
    }

    const payload = await response.json();
    return reply(res, 200, payload);

  } catch (err) {
    console.error(err.message);

    return reply(res, 502, {
      error: 'upstream_unavailable_or_invalid_json'
    });
  }
}

// HTTP server and routing
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/health') {
      return reply(res, 200, { status: 'ok' });
    }

    if (req.method === 'POST' &&
        url.pathname === '/oauth/token') {
      return await tokenEndpoint(req, res);
    }

    const match =
      /^\/api\/feed-data\/businesses\/(\d+)\/items\/?$/
      .exec(url.pathname);

    if (req.method === 'GET' && match) {
      return await itemsEndpoint(req, res, match[1], url);
    }

    return reply(res, 404, { error: 'not_found' });

  } catch (err) {
    console.error(err.message);

    return reply(res, 500, {
      error: 'internal_server_error'
    });
  }
});

server.listen(PORT, () => {
  console.log(`OAuth proxy listening on port ${PORT}`);
});
