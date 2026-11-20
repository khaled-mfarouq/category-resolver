
'use strict';

// Portable, single-file Node.js 22+ server.
// Requires a persistent writable disk.

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const PORT = Number(process.env.PORT || 3000);

const CLIENT_ID = process.env.OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET;
const SIGNING_SECRET = process.env.OAUTH_SIGNING_SECRET;
const HOTELIER_TOKEN = process.env.DIGITAL_HOTELIER_TOKEN;
const SYNC_SECRET = process.env.SYNC_SECRET;

const HOTEL_IDS = (process.env.HOTEL_IDS || '1')
  .split(',')
  .map(x => x.trim())
  .filter(Boolean);

const CACHE_DIR = process.env.CACHE_DIR ||
  path.join(process.cwd(), 'hotel-cache');

const TOKEN_TTL = 3600;
const DAY_MS = 24 * 60 * 60 * 1000;

const lastSync = new Map();
const syncInProgress = new Map();

// Validate configuration
if (
  ![CLIENT_ID, CLIENT_SECRET, SIGNING_SECRET,
    HOTELIER_TOKEN, SYNC_SECRET].every(Boolean)
  || SIGNING_SECRET.length < 32
  || !HOTEL_IDS.length
  || HOTEL_IDS.some(x => !/^\d{1,12}$/.test(x))
) {
  console.error(
    'Set OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, ' +
    'OAUTH_SIGNING_SECRET (32+ chars), ' +
    'DIGITAL_HOTELIER_TOKEN, SYNC_SECRET, ' +
    'and valid HOTEL_IDS.'
  );
  process.exit(1);
}

// Return JSON
function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });

  res.end(JSON.stringify(body));
}

// Secure string comparison
function equal(a, b) {
  if (typeof a !== 'string' ||
      typeof b !== 'string') {
    return false;
  }

  const x = Buffer.from(a);
  const y = Buffer.from(b);

  return x.length === y.length &&
    crypto.timingSafeEqual(x, y);
}

// Sign an OAuth access token
function sign(value) {
  return crypto
    .createHmac('sha256', SIGNING_SECRET)
    .update(value)
    .digest('base64url');
}

// Generate an expiring OAuth access token
function issueToken() {
  const payload = Buffer.from(JSON.stringify({
    sub: CLIENT_ID,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL
  })).toString('base64url');

  return payload + '.' + sign(payload);
}

// Validate the OAuth Bearer token
function validToken(req) {
  const auth = /^Bearer\s+(\S+)$/i.exec(
    req.headers.authorization || ''
  );

  if (!auth) return false;

  const parts = auth[1].split('.');

  if (
    parts.length !== 2 ||
    !equal(sign(parts[0]), parts[1])
  ) {
    return false;
  }

  try {
    const data = JSON.parse(
      Buffer.from(parts[0], 'base64url')
        .toString('utf8')
    );

    return (
      data.sub === CLIENT_ID &&
      Number.isSafeInteger(data.exp) &&
      data.exp > Date.now() / 1000
    );

  } catch {
    return false;
  }
}

// Read an HTTP request body
async function readBody(req) {
  let body = '';

  for await (const chunk of req) {
    body += chunk.toString('utf8');

    if (Buffer.byteLength(body) > 8192) {
      throw Error('Request body too large');
    }
  }

  return body;
}

// OAuth 2.0 Client Credentials endpoint
async function tokenEndpoint(req, res) {
  let body;

  try {
    body = new URLSearchParams(await readBody(req));
  } catch {
    return json(res, 400, {
      error: 'invalid_request'
    });
  }

  if (body.get('grant_type') !== 'client_credentials') {
    return json(res, 400, {
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

      const idx = pair.indexOf(':');

      if (idx < 0) {
        throw Error('Invalid Basic authentication');
      }

      id = decodeURIComponent(
        pair.slice(0, idx).replace(/\+/g, '%20')
      );

      secret = decodeURIComponent(
        pair.slice(idx + 1).replace(/\+/g, '%20')
      );

    } catch {
      return json(res, 401, {
        error: 'invalid_client'
      });
    }
  }

  if (
    !equal(id, CLIENT_ID) ||
    !equal(secret, CLIENT_SECRET)
  ) {
    return json(res, 401, {
      error: 'invalid_client'
    });
  }

  return json(res, 200, {
    access_token: issueToken(),
    token_type: 'Bearer',
    expires_in: TOKEN_TTL
  });
}

// Get the local JSON cache filename
function cacheFile(id) {
  return path.join(CACHE_DIR, `hotel-${id}.json`);
}

// Download hotel items and update the cache
async function refreshHotel(id) {

  // Avoid simultaneous synchronization
  if (syncInProgress.has(id)) {
    return syncInProgress.get(id);
  }

  const task = (async () => {

    const apiUrl =
      'https://dashboard.thedigitalhotelier.com' +
      `/api/feed-data/businesses/${id}/items`;

    const started = Date.now();

    try {
      const response = await fetch(apiUrl, {
        headers: {
          Authorization: `Bearer ${HOTELIER_TOKEN}`,
          Accept: 'application/json'
        },
        signal: AbortSignal.timeout(60000)
      });

      if (!response.ok) {
        throw Error(
          `Upstream HTTP ${response.status}`
        );
      }

      const raw = await response.text();

      if (
        Buffer.byteLength(raw, 'utf8') >
        10 * 1024 * 1024
      ) {
        throw Error(
          'Upstream response exceeds 10 MB'
        );
      }

      const data = JSON.parse(raw);

      // Create the cache directory
      await fs.mkdir(CACHE_DIR, {
        recursive: true
      });

      // Write to a temporary file first
      const tmp = cacheFile(id) + '.' +
        crypto.randomBytes(6).toString('hex') +
        '.tmp';

      await fs.writeFile(
        tmp,
        JSON.stringify({
          syncedAt: new Date().toISOString(),
          data
        }),
        { mode: 0o600 }
      );

      // Replace the cache atomically
      await fs.rename(tmp, cacheFile(id));

      lastSync.set(
        id,
        new Date().toISOString()
      );

      console.log(
        `Synced hotel ${id} in ` +
        `${Date.now() - started}ms`
      );

      return true;

    } catch (e) {

      console.error(
        `Sync failed for hotel ${id}: ${e.message}`
      );

      // Preserve the previous successful cache
      return false;

    } finally {
      syncInProgress.delete(id);
    }
  })();

  syncInProgress.set(id, task);

  return task;
}

// Synchronize all configured hotels
async function refreshAll() {
  for (const id of HOTEL_IDS) {
    await refreshHotel(id);
  }
}

// HTTP server
const server = http.createServer(
  async (req, res) => {

    const url = new URL(
      req.url,
      'http://localhost'
    );

    try {

      // ----------------------------------
      // 1. Health check
      // ----------------------------------
      if (
        req.method === 'GET' &&
        url.pathname === '/health'
      ) {
        return json(res, 200, {
          status: 'ok',
          hotels: HOTEL_IDS,
          lastSuccessfulSync:
            Object.fromEntries(lastSync)
        });
      }

      // ----------------------------------
      // 2. OAuth 2.0 token
      // ----------------------------------
      if (
        req.method === 'POST' &&
        url.pathname === '/oauth/token'
      ) {
        return await tokenEndpoint(req, res);
      }

      // ----------------------------------
      // 3. Manual synchronization
      // ----------------------------------
      if (
        req.method === 'POST' &&
        url.pathname === '/admin/sync'
      ) {

        const auth = /^Bearer\s+(\S+)$/i.exec(
          req.headers.authorization || ''
        );

        if (
          !auth ||
          !equal(auth[1], SYNC_SECRET)
        ) {
          return json(res, 401, {
            error: 'unauthorized'
          });
        }

        const id = url.searchParams.get(
          'hotel_id'
        );

        if (
          id &&
          !HOTEL_IDS.includes(id)
        ) {
          return json(res, 400, {
            error: 'hotel_not_configured'
          });
        }

        const ids = id ? [id] : HOTEL_IDS;
        const results = {};

        for (const hotel of ids) {
          results[hotel] =
            await refreshHotel(hotel);
        }

        return json(res, 200, {
          refreshed: results
        });
      }

      // ----------------------------------
      // 4. Cached Digital Hotelier items
      // ----------------------------------
      const match =
        /^\/api\/feed-data\/businesses\/(\d+)\/items\/?$/
          .exec(url.pathname);

      if (
        req.method === 'GET' &&
        match
      ) {

        // Validate Zendesk OAuth access token
        if (!validToken(req)) {
          return json(res, 401, {
            error: 'invalid_token'
          });
        }

        const id = match[1];

        if (!HOTEL_IDS.includes(id)) {
          return json(res, 404, {
            error: 'hotel_not_configured'
          });
        }

        try {

          const snapshot = JSON.parse(
            await fs.readFile(
              cacheFile(id),
              'utf8'
            )
          );

          // Return the actual Digital Hotelier
          // JSON data directly to Zendesk.
          return json(
            res,
            200,
            snapshot.data
          );

        } catch (err) {

          if (err.code !== 'ENOENT') {
            console.error(
              `Cache read failed: ${err.message}`
            );
          }

          return json(res, 503, {
            error: 'cache_not_ready',
            message:
              'Initial sync has not succeeded.'
          });
        }
      }

      return json(res, 404, {
        error: 'not_found'
      });

    } catch (err) {

      console.error(
        'Request failed:',
        err.message
      );

      return json(res, 500, {
        error: 'internal_server_error'
      });
    }
  }
);

// Start the API server
server.listen(PORT, () => {

  console.log(
    'Digital Hotelier cached OAuth proxy ' +
    `listening on port ${PORT}`
  );

  // Fetch data immediately after startup.
  // Existing cache remains accessible.
  void refreshAll();

  // Refresh data every 24 hours.
  // Requires the Node.js process to stay running.
  setInterval(() => {
    void refreshAll();
  }, DAY_MS).unref();

});
