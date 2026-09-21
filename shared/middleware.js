// Connect-style middleware shared by the Vite and webpack plugins.
//
// Running inside the app's own dev server means submissions are same-origin, so
// there are no CORS headers to get wrong. It also means the token-holding
// process is the dev server the developer already trusts, rather than a second
// port with a wildcard origin.

import { handleSubmission } from '../server/submit.js';

export const SUBMIT_ROUTE = '/__visual-annotator/submit';
export const DEFAULT_MAX_BODY_BYTES = 8 * 1024 * 1024;

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

export function readJsonBody(req, maxBytes = DEFAULT_MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;

    req.on('data', (chunk) => {
      if (tooLarge) return; // keep draining so the connection can still respond
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
        const err = new Error(`Payload too large (limit ${maxBytes} bytes)`);
        err.status = 413;
        // Deliberately do NOT destroy the request: tearing down the socket here
        // means the 413 never reaches the client, which just sees a network
        // error instead of a clear rejection.
        reject(err);
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (!tooLarge) resolve(Buffer.concat(chunks).toString('utf8'));
    });

    req.on('error', (err) => {
      if (!tooLarge) reject(err);
    });
  });
}

// A browser request carries an Origin; it must match the Host it reached. A
// non-browser client (curl, a test) sends none and is allowed through — the
// threat we are closing is a malicious *page* posting to your dev server.
export function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function createSubmitMiddleware({
  deps,
  route = SUBMIT_ROUTE,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  checkOrigin = true,
} = {}) {
  return async function visualAnnotateMiddleware(req, res, next) {
    const pathname = (req.url || '').split('?')[0];
    if (pathname !== route) return next();

    if (checkOrigin && !isSameOrigin(req)) {
      return send(res, 403, { error: 'Cross-origin submission rejected', created: [], failed: [] });
    }
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }
    if (req.method !== 'POST') {
      return send(res, 405, { error: 'Method not allowed', created: [], failed: [] });
    }

    let payload;
    try {
      payload = JSON.parse(await readJsonBody(req, maxBodyBytes));
    } catch (err) {
      return send(res, err.status || 400, { error: err.message, created: [], failed: [] });
    }

    try {
      const result = await handleSubmission(payload, deps);
      return send(res, result.created.length > 0 ? 200 : 502, result);
    } catch (err) {
      return send(res, err.status || 500, { error: err.message, created: [], failed: [] });
    }
  };
}
