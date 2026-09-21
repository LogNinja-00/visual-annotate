import http from 'node:http';

import { resolveConfig } from '../shared/config.js';
import { readJsonBody, DEFAULT_MAX_BODY_BYTES } from '../shared/middleware.js';
import { createSubmissionDeps } from './deps.js';
import { handleSubmission } from './submit.js';

// Only loopback origins may post to the standalone server. This is what stops a
// random website you happen to visit from filing issues with your token.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function isAllowedOrigin(origin, extra = []) {
  if (!origin) return true;
  try {
    const { hostname } = new URL(origin);
    return LOOPBACK_HOSTS.has(hostname) || extra.includes(origin) || extra.includes(hostname);
  } catch {
    return false;
  }
}

export function formatListenError(err, port) {
  if (err && err.code === 'EADDRINUSE') {
    return `[visual-annotate] Port ${port} is already in use. Stop the other process or set VA_PORT to a free port.`;
  }
  return `[visual-annotate] Server error: ${err && err.message ? err.message : err}`;
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

export function createServer(options = {}) {
  const config = resolveConfig({ options });
  const { owner, repo, label, port } = config;
  const host = options.host ?? '127.0.0.1';
  const sessionToken = options.sessionToken ?? null;
  const allowedOrigins = options.allowedOrigins ?? [];
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const deps = createSubmissionDeps(config, { cwd: options.cwd ?? process.cwd() });

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const originAllowed = isAllowedOrigin(origin, allowedOrigins);
    if (origin && originAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-VA-Token');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

    const pathname = (req.url || '').split('?')[0];
    if (pathname !== '/submit') {
      return send(res, 404, { error: 'Not found' });
    }
    if (!originAllowed) {
      return send(res, 403, { error: 'Origin not allowed', created: [], failed: [] });
    }
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }
    if (req.method !== 'POST') {
      return send(res, 405, { error: 'Method not allowed', created: [], failed: [] });
    }
    if (sessionToken && req.headers['x-va-token'] !== sessionToken) {
      return send(res, 401, { error: 'Missing or invalid X-VA-Token', created: [], failed: [] });
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
  });

  server.on('error', (err) => {
    console.error(formatListenError(err, port));
    if (err && err.code !== 'EADDRINUSE') throw err;
  });

  server.listen(port, host, () => {
    console.log(`[visual-annotate] Local server listening on http://${host}:${port}`);
    console.log(`[visual-annotate] Forwarding issues to ${owner}/${repo} (screenshots: ${deps.screenshots.provider})`);
  });

  return server;
}
