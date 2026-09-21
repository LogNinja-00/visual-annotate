import test from 'node:test';
import assert from 'node:assert/strict';

import { submitComments, SubmitError } from '../src/client.js';

const URL = 'http://localhost:4545/submit';

function stubFetch(impl) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => {
    globalThis.fetch = original;
  };
}

test('submitComments POSTs the comments and returns created/failed', async () => {
  let seen;
  const restore = stubFetch(async (url, options) => {
    seen = { url, options };
    return {
      status: 200,
      json: async () => ({ created: [{ number: 7, html_url: 'https://gh/7' }], failed: [] }),
    };
  });
  try {
    const result = await submitComments({ url: URL, comments: [{ text: 'hi' }] });
    assert.equal(result.created.length, 1);
    assert.deepEqual(result.failed, []);
    assert.equal(seen.url, URL);
    assert.equal(seen.options.method, 'POST');
    assert.deepEqual(JSON.parse(seen.options.body), { comments: [{ text: 'hi' }] });
  } finally {
    restore();
  }
});

test('a session token is sent as a header only when configured', async () => {
  const calls = [];
  const restore = stubFetch(async (url, options) => {
    calls.push(options);
    return { status: 200, json: async () => ({ created: [{}], failed: [] }) };
  });
  try {
    await submitComments({ url: URL, comments: [{}], token: 'secret' });
    await submitComments({ url: URL, comments: [{}] });
    assert.equal(calls[0].headers['X-VA-Token'], 'secret');
    assert.equal(calls[1].headers['X-VA-Token'], undefined);
  } finally {
    restore();
  }
});

test('a partial success resolves rather than throwing', async () => {
  const restore = stubFetch(async () => ({
    status: 200,
    json: async () => ({ created: [{ number: 1 }], failed: [{ id: 'x', error: 'nope' }] }),
  }));
  try {
    const result = await submitComments({ url: URL, comments: [{}] });
    assert.equal(result.created.length, 1);
    assert.equal(result.failed.length, 1);
  } finally {
    restore();
  }
});

test('a network failure surfaces as an offline SubmitError', async () => {
  const restore = stubFetch(async () => {
    throw new TypeError('fetch failed');
  });
  try {
    await assert.rejects(submitComments({ url: URL, comments: [{}] }), (err) => {
      assert.ok(err instanceof SubmitError);
      assert.equal(err.offline, true);
      return true;
    });
  } finally {
    restore();
  }
});

test('a response with nothing created is not treated as success', async () => {
  const restore = stubFetch(async () => ({
    status: 502,
    json: async () => ({ created: [], failed: [{ id: 'x', error: 'api down' }] }),
  }));
  try {
    await assert.rejects(submitComments({ url: URL, comments: [{}] }), (err) => {
      assert.ok(err instanceof SubmitError);
      assert.equal(err.offline, false);
      assert.equal(err.message, 'api down');
      return true;
    });
  } finally {
    restore();
  }
});

test('a server-provided error message is preserved', async () => {
  const restore = stubFetch(async () => ({
    status: 400,
    json: async () => ({ error: 'No comments provided', created: [], failed: [] }),
  }));
  try {
    await assert.rejects(submitComments({ url: URL, comments: [] }), (err) => {
      assert.equal(err.message, 'No comments provided');
      return true;
    });
  } finally {
    restore();
  }
});

test('non-JSON responses are reported rather than crashing on parse', async () => {
  const restore = stubFetch(async () => ({
    status: 500,
    json: async () => {
      throw new SyntaxError('Unexpected token');
    },
  }));
  try {
    await assert.rejects(submitComments({ url: URL, comments: [{}] }), (err) => {
      assert.ok(err instanceof SubmitError);
      assert.match(err.message, /Server responded 500/);
      return true;
    });
  } finally {
    restore();
  }
});
