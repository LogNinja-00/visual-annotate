import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import {
  createSubmitMiddleware,
  readJsonBody,
  isSameOrigin,
  SUBMIT_ROUTE,
} from '../shared/middleware.js';

function makeReq({ method = 'POST', url = SUBMIT_ROUTE, headers = {}, body = '' } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = { host: 'localhost:3000', ...headers };
  req.destroy = () => {};
  queueMicrotask(() => {
    if (body) req.emit('data', Buffer.from(body));
    req.emit('end');
  });
  return req;
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(payload) {
      this.body = payload;
      this.ended = true;
    },
  };
}

function deps(overrides = {}) {
  return {
    github: {
      ensureLabel: async () => {},
      createIssue: async () => ({ number: 1, html_url: 'https://gh/1' }),
    },
    screenshots: { store: async () => null },
    owner: 'me',
    repo: 'proj',
    ...overrides,
  };
}

const validComment = () => ({ text: 'broken', url: 'http://localhost:3000/', locator: { selector: 'div' } });

async function run(middleware, req) {
  const res = makeRes();
  let nexted = false;
  await middleware(req, res, () => {
    nexted = true;
  });
  return { res, nexted };
}

test('a non-matching route falls through to the next middleware', async () => {
  const mw = createSubmitMiddleware({ deps: deps() });
  const { nexted, res } = await run(mw, makeReq({ url: '/other' }));
  assert.equal(nexted, true);
  assert.equal(res.ended, false);
});

test('a cross-origin submission is rejected', async () => {
  const mw = createSubmitMiddleware({ deps: deps() });
  const { res } = await run(
    mw,
    makeReq({ headers: { origin: 'http://evil.example', host: 'localhost:3000' }, body: '{}' })
  );
  assert.equal(res.statusCode, 403);
  assert.match(res.body, /Cross-origin/);
});

test('a same-origin submission is accepted', async () => {
  const mw = createSubmitMiddleware({ deps: deps() });
  const { res } = await run(
    mw,
    makeReq({
      headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
      body: JSON.stringify({ comments: [validComment()] }),
    })
  );
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).created.length, 1);
});

test('a request with no origin is allowed (non-browser client)', async () => {
  const mw = createSubmitMiddleware({ deps: deps() });
  const { res } = await run(mw, makeReq({ body: JSON.stringify({ comments: [validComment()] }) }));
  assert.equal(res.statusCode, 200);
});

test('preflight and non-POST methods are handled', async () => {
  const mw = createSubmitMiddleware({ deps: deps() });
  const preflight = await run(mw, makeReq({ method: 'OPTIONS' }));
  assert.equal(preflight.res.statusCode, 204);
  const get = await run(mw, makeReq({ method: 'GET' }));
  assert.equal(get.res.statusCode, 405);
});

test('invalid JSON is a 400', async () => {
  const mw = createSubmitMiddleware({ deps: deps() });
  const { res } = await run(mw, makeReq({ body: '{bad' }));
  assert.equal(res.statusCode, 400);
});

test('an oversized body is rejected with 413', async () => {
  const mw = createSubmitMiddleware({ deps: deps(), maxBodyBytes: 16 });
  const { res } = await run(mw, makeReq({ body: JSON.stringify({ comments: [validComment()] }) }));
  assert.equal(res.statusCode, 413);
});

test('an empty submission is a 400', async () => {
  const mw = createSubmitMiddleware({ deps: deps() });
  const { res } = await run(mw, makeReq({ body: JSON.stringify({ comments: [] }) }));
  assert.equal(res.statusCode, 400);
});

test('an all-failed submission reports 502 with the failures', async () => {
  const mw = createSubmitMiddleware({
    deps: deps({
      github: {
        ensureLabel: async () => {},
        createIssue: async () => {
          throw new Error('api down');
        },
      },
    }),
  });
  const { res } = await run(mw, makeReq({ body: JSON.stringify({ comments: [validComment()] }) }));
  assert.equal(res.statusCode, 502);
  assert.match(JSON.parse(res.body).failed[0].error, /api down/);
});

test('readJsonBody returns the decoded body', async () => {
  const text = await readJsonBody(makeReq({ body: 'hello' }));
  assert.equal(text, 'hello');
});

test('isSameOrigin compares origin host against host header', () => {
  assert.equal(isSameOrigin({ headers: {} }), true);
  assert.equal(isSameOrigin({ headers: { origin: 'http://a.test', host: 'a.test' } }), true);
  assert.equal(isSameOrigin({ headers: { origin: 'http://a.test', host: 'b.test' } }), false);
  assert.equal(isSameOrigin({ headers: { origin: 'not a url', host: 'a.test' } }), false);
});
