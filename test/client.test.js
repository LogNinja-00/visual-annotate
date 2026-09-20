import test from 'node:test';
import assert from 'node:assert/strict';

import { submitComments, SubmitError } from '../src/client.js';

const SERVER = 'http://localhost:4545';

function stubFetch(impl) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => {
    globalThis.fetch = original;
  };
}

test('submitComments POSTs the comments and returns the issues', async () => {
  let seen;
  const restore = stubFetch(async (url, options) => {
    seen = { url, options };
    return { json: async () => ({ issues: [{ number: 7, html_url: 'https://gh/7' }] }) };
  });
  try {
    const issues = await submitComments(SERVER, [{ text: 'hi' }]);
    assert.deepEqual(issues, [{ number: 7, html_url: 'https://gh/7' }]);
    assert.equal(seen.url, `${SERVER}/submit`);
    assert.equal(seen.options.method, 'POST');
    assert.deepEqual(JSON.parse(seen.options.body), { comments: [{ text: 'hi' }] });
  } finally {
    restore();
  }
});

test('a network failure surfaces as an offline SubmitError', async () => {
  const restore = stubFetch(async () => {
    throw new TypeError('fetch failed');
  });
  try {
    await assert.rejects(
      submitComments(SERVER, [{ text: 'hi' }]),
      (err) => {
        assert.ok(err instanceof SubmitError);
        assert.equal(err.offline, true);
        return true;
      }
    );
  } finally {
    restore();
  }
});

test('a response with no issues is not treated as success', async () => {
  const restore = stubFetch(async () => ({ json: async () => ({ issues: [] }) }));
  try {
    await assert.rejects(
      submitComments(SERVER, [{ text: 'hi' }]),
      (err) => {
        assert.ok(err instanceof SubmitError);
        assert.equal(err.offline, false);
        return true;
      }
    );
  } finally {
    restore();
  }
});

test('a server-provided error message is preserved', async () => {
  const restore = stubFetch(async () => ({ json: async () => ({ error: 'No comments provided' }) }));
  try {
    await assert.rejects(submitComments(SERVER, []), (err) => {
      assert.equal(err.message, 'No comments provided');
      return true;
    });
  } finally {
    restore();
  }
});

test('non-JSON responses are reported rather than crashing on parse', async () => {
  const restore = stubFetch(async () => ({
    json: async () => {
      throw new SyntaxError('Unexpected token');
    },
  }));
  try {
    await assert.rejects(submitComments(SERVER, [{ text: 'hi' }]), (err) => {
      assert.ok(err instanceof SubmitError);
      assert.equal(err.offline, false);
      return true;
    });
  } finally {
    restore();
  }
});
