import test from 'node:test';
import assert from 'node:assert/strict';

import { isAllowedOrigin, formatListenError, createServer } from '../server/index.js';

const CONFIG = { owner: 'o', repo: 'r', token: 't' };

test('loopback origins are allowed', () => {
  assert.equal(isAllowedOrigin('http://localhost:3000'), true);
  assert.equal(isAllowedOrigin('http://127.0.0.1:5173'), true);
  assert.equal(isAllowedOrigin('http://[::1]:3000'), true);
});

test('requests with no origin are allowed (non-browser clients)', () => {
  assert.equal(isAllowedOrigin(undefined), true);
});

test('external origins are rejected', () => {
  assert.equal(isAllowedOrigin('https://evil.example'), false);
  assert.equal(isAllowedOrigin('https://localhost.evil.example'), false);
  assert.equal(isAllowedOrigin('not a url'), false);
});

test('extra origins can be allowlisted explicitly', () => {
  assert.equal(isAllowedOrigin('https://dev.internal', ['https://dev.internal']), true);
  assert.equal(isAllowedOrigin('https://dev.internal', ['other.internal']), false);
});

test('a port clash produces a readable message', () => {
  const err = Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' });
  const message = formatListenError(err, 4545);
  assert.match(message, /Port 4545 is already in use/);
  assert.match(message, /VA_PORT/);
});

test('other listen errors fall through to a generic message', () => {
  assert.match(formatListenError(new Error('EACCES'), 4545), /Server error: EACCES/);
});

test('the server rejects a disallowed origin over HTTP', async () => {
  const server = createServer({ ...CONFIG, port: 4996, screenshotProvider: 'off' });
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const res = await fetch('http://127.0.0.1:4996/submit', {
      method: 'POST',
      headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ comments: [] }),
    });
    assert.equal(res.status, 403);
  } finally {
    server.close();
  }
});

test('the server requires the session token when one is configured', async () => {
  const server = createServer({ ...CONFIG, port: 4995, sessionToken: 'secret', screenshotProvider: 'off' });
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const unauth = await fetch('http://127.0.0.1:4995/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comments: [] }),
    });
    assert.equal(unauth.status, 401);

    const authed = await fetch('http://127.0.0.1:4995/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-VA-Token': 'secret' },
      body: JSON.stringify({ comments: [] }),
    });
    assert.equal(authed.status, 400, 'authenticated but empty body is a 400');
  } finally {
    server.close();
  }
});

test('a loopback origin is allowed and reaches validation', async () => {
  const server = createServer({ ...CONFIG, port: 4994, screenshotProvider: 'off' });
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const res = await fetch('http://127.0.0.1:4994/submit', {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
      body: JSON.stringify({ comments: [] }),
    });
    assert.equal(res.status, 400);
    assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:3000');
  } finally {
    server.close();
  }
});
