import test from 'node:test';
import assert from 'node:assert/strict';

import { handleSubmission, SubmissionError } from '../server/submit.js';

function makeDeps(overrides = {}) {
  const calls = { createIssue: [], ensureLabel: 0, store: [] };
  const github = {
    ensureLabel: async () => {
      calls.ensureLabel += 1;
    },
    createIssue: async (owner, repo, input) => {
      calls.createIssue.push({ owner, repo, input });
      const number = calls.createIssue.length + 10;
      return { number, html_url: `https://gh/${number}` };
    },
  };
  const screenshots = {
    store: async (dataUrl, annotation) => {
      calls.store.push({ dataUrl, id: annotation.id });
      return { path: 'p.png', url: 'https://gh/p.png', branch: 'b' };
    },
  };
  return { github, screenshots, owner: 'me', repo: 'proj', calls, ...overrides };
}

function comment(overrides = {}) {
  return {
    text: 'Button overlaps header',
    url: 'http://localhost:3000/',
    locator: { file: 'src/Button.jsx', line: 12, component: 'Button', selector: 'button' },
    ...overrides,
  };
}

test('happy path creates an issue and reports it', async () => {
  const deps = makeDeps();
  const result = await handleSubmission({ comments: [comment()] }, deps);

  assert.equal(result.created.length, 1);
  assert.deepEqual(result.failed, []);
  assert.equal(result.created[0].number, 11);
  assert.equal(result.created[0].html_url, 'https://gh/11');
  assert.equal(deps.calls.createIssue[0].owner, 'me');
  assert.equal(deps.calls.createIssue[0].input.labels[0], 'visual-annotation');
  assert.match(deps.calls.createIssue[0].input.title, /^\[VA\] Button: /);
  assert.match(deps.calls.createIssue[0].input.body, /Machine-readable annotation/);
});

test('an empty submission is refused with a 400 status', async () => {
  const deps = makeDeps();
  await assert.rejects(handleSubmission({ comments: [] }, deps), (err) => {
    assert.ok(err instanceof SubmissionError);
    assert.equal(err.status, 400);
    return true;
  });
});

test('a malformed annotation fails alone without filing', async () => {
  const deps = makeDeps();
  const result = await handleSubmission({ comments: [{ url: 'http://x/' }] }, deps);

  assert.deepEqual(result.created, []);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].error, /Invalid annotation/);
  assert.equal(deps.calls.createIssue.length, 0);
});

test('one bad annotation does not discard the good ones', async () => {
  const deps = makeDeps();
  const result = await handleSubmission(
    { comments: [comment(), { url: 'http://x/' }, comment({ text: 'Second issue' })] },
    deps
  );

  assert.equal(result.created.length, 2);
  assert.equal(result.failed.length, 1);
  assert.equal(deps.calls.createIssue.length, 2);
});

test('a screenshot is stored and embedded in the body', async () => {
  const deps = makeDeps();
  const result = await handleSubmission(
    { comments: [comment({ screenshot: 'data:image/png;base64,AAAA' })] },
    deps
  );

  assert.equal(deps.calls.store.length, 1);
  assert.match(deps.calls.createIssue[0].input.body, /!\[annotation\]\(https:\/\/gh\/p\.png\)/);
  assert.equal(result.created.length, 1);
});

test('the data url never reaches the issue body', async () => {
  const deps = makeDeps();
  await handleSubmission({ comments: [comment({ screenshot: 'data:image/png;base64,AAAA' })] }, deps);
  assert.doesNotMatch(deps.calls.createIssue[0].input.body, /data:image/);
});

test('an injected enricher contributes the code frame', async () => {
  const deps = makeDeps({
    enrich: async (annotation) => ({ ...annotation, codeFrame: '> 12 | <button />', git: { commit: 'abcdef1', branch: 'main' } }),
  });
  await handleSubmission({ comments: [comment()] }, deps);
  const body = deps.calls.createIssue[0].input.body;
  assert.match(body, /\*\*Code frame:\*\*/);
  assert.match(body, /> 12 \| <button \/>/);
  assert.match(body, /\*\*Revision:\*\* `abcdef1` on `main`/);
});

test('a failing label lookup does not block filing', async () => {
  const deps = makeDeps({
    github: {
      ensureLabel: async () => {
        throw new Error('no permission');
      },
      createIssue: async () => ({ number: 1, html_url: 'u' }),
    },
  });
  const result = await handleSubmission({ comments: [comment()] }, deps);
  assert.equal(result.created.length, 1);
});

test('mentions are resolved and appended when provided', async () => {
  const deps = makeDeps({ mentions: async () => ['alice'] });
  await handleSubmission({ comments: [comment()] }, deps);
  assert.match(deps.calls.createIssue[0].input.body, /@alice/);
});

test('a failing mentions lookup is not fatal', async () => {
  const deps = makeDeps({
    mentions: async () => {
      throw new Error('nope');
    },
  });
  const result = await handleSubmission({ comments: [comment()] }, deps);
  assert.equal(result.created.length, 1);
});
