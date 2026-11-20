
'use strict';

// Vercel OAuth 2.0 Proxy for Digital Hotelier
// Node.js 22+ — No external packages required

const { createHmac, timingSafeEqual } = require('node:crypto');

const CLIENT_ID = process.env.OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET;
const UPSTREAM_TOKEN = process.env.DIGITAL_HOTELIER_TOKEN;
const SIGNING_SECRET = process.env.OAUTH_SIGNING_SECRET;

const TTL = 3600;

// JSON response helper
function respond(res, code, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(code).json(body);
}

// Secure string comparison
function same(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));

  return aa.length === bb.length &&
    timingSafeEqual(aa, bb);
}

// Sign OAuth access token
function sign(content) {
  return createHmac('sha256', SIGNING_SECRET)
    .update(content)
    .digest('base64url');
}

// Generate signed, expiring OAuth token
function issueToken() {
  const payload = Buffer.from(JSON.stringify({
    sub: CLIENT_ID,
    exp: Math.floor(Date.now() / 1000) + TTL
  })).toString('base64url');

  return `${payload}.${sign(payload)}`;
}

// Validate OAuth access token
function validToken(req) {
  const match = /^Bearer\s+(\S+)$/i.exec(
    req.headers.authorization || ''
  );

  if (!match) return false;

  const parts = match[1].split('.');

  if (parts.length !== 2 ||
      !same(parts[1], sign(parts[0]))) {
    return false;
  }

  try {
    const data = JSON.parse(
      Buffer.from(parts[0], 'base64url').toString()
    );

    return data.sub === CLIENT_ID &&
      Number.isSafeInteger(data.exp) &&
      data.exp > Date.now() / 1000;

  } catch {
    return false;
  }
}

// Vercel Serverless Function
module.exports = async function handler(req, res) {

  if (!CLIENT_ID || !CLIENT_SECRET ||
      !UPSTREAM_TOKEN || !SIGNING_SECRET) {
    return respond(res, 500, {
      error: 'server_configuration_missing'
    });
  }

  const url = new URL(req.url, 'https://example.invalid');
  const operation = url.searchParams.get('operation');

  // HEALTH CHECK
  if (req.method === 'GET' && operation === 'health') {
    return respond(res, 200, { status: 'ok' });
  }

  // OAUTH 2.0 TOKEN GENERATION
  if (req.method === 'POST' && operation === 'token') {

    let body;

    if (typeof req.body === 'string') {
      body = new URLSearchParams(req.body);
    } else if (req.body && typeof req.body === 'object') {
      body = new URLSearchParams(req.body);
    } else {
      body = new URLSearchParams();
    }

    if (body.get('grant_type') !== 'client_credentials') {
      return respond(res, 400, {
        error: 'unsupported_grant_type'
      });
    }

    let id = body.get('client_id') || '';
    let secret = body.get('client_secret') || '';

    const basic = /^Basic\s+(\S+)$/i.exec(
      req.headers.authorization || ''
    );

    if (basic) {
      try {
        const pair = Buffer.from(
          basic[1], 'base64'
        ).toString('utf8');

        const colon = pair.indexOf(':');

        if (colon < 0) throw new Error('invalid');

        id = decodeURIComponent(pair.slice(0, colon));
        secret = decodeURIComponent(pair.slice(colon + 1));

      } catch {
        return respond(res, 401, {
          error: 'invalid_client'
        });
      }
    }

    if (!same(id, CLIENT_ID) ||
        !same(secret, CLIENT_SECRET)) {
      return respond(res, 401, {
        error: 'invalid_client'
      });
    }

    return respond(res, 200, {
      access_token: issueToken(),
      token_type: 'Bearer',
      expires_in: TTL
    });
  }

  // DIGITAL HOTELIER ITEMS API
  if (req.method === 'GET' && operation === 'items') {

    if (!validToken(req)) {
      return respond(res, 401, {
        error: 'invalid_token'
      });
    }

    const hotelId = url.searchParams.get('hotel_id');

    if (!hotelId || !/^\d{1,12}$/.test(hotelId)) {
      return respond(res, 400, {
        error: 'invalid_hotel_id'
      });
    }

    try {
      const upstreamUrl =
        `https://dashboard.thedigitalhotelier.com/api/feed-data/businesses/${hotelId}/items`;

      const upstream = await fetch(upstreamUrl, {
        headers: {
          Authorization: `Bearer ${UPSTREAM_TOKEN}`,
          Accept: 'application/json'
        },
        signal: AbortSignal.timeout(15000)
      });

      if (!upstream.ok) {
        return respond(
          res,
          upstream.status === 404 ? 404 : 502,
          {
            error: 'upstream_failed',
            upstream_status: upstream.status
          }
        );
      }

      const data = await upstream.json();

      return respond(res, 200, data);

    } catch (e) {
      console.error('Upstream error:', e.message);

      return respond(res, 502, {
        error: 'upstream_unavailable_or_invalid_json'
      });
    }
  }

  return respond(res, 404, {
    error: 'not_found',
    hint: 'Use ?operation=token (POST) or ?operation=items&hotel_id=1 (GET)'
  });
};
