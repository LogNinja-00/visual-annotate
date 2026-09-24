import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../../server/index.js';

function listenEphemeral(options) {
  const srv = createServer({ owner: 'o', repo: 'r', token: 't', ...options, port: 0 });
  return new Promise((resolve, reject) => {
    if (srv.listening) return resolve(srv);
    srv.once('listening', () => resolve(srv));
    srv.once('error', reject);
  });
}

function close(srv) {
  return new Promise((resolve) => srv.close(resolve));
}

test('rejects empty comments', async () => {
  const srv = await listenEphemeral();
  try {
    const port = srv.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comments: [] }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error);
  } finally {
    await close(srv);
  }
});

test('404 on non-submit routes', async () => {
  const srv = await listenEphemeral();
  try {
    const port = srv.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/nope`, { method: 'POST' });
    assert.equal(res.status, 404);
  } finally {
    await close(srv);
  }
});

test('CORS preflight returns 204', async () => {
  const srv = await listenEphemeral();
  try {
    const port = srv.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/submit`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:3000' },
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:3000');
  } finally {
    await close(srv);
  }
});
