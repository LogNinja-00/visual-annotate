import test from 'node:test';
import assert from 'node:assert/strict';

import { createGithub } from '../shared/github.js';

// Queue-driven fetch stub: each call shifts the next scripted response.
function stub(responses) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected fetch: ${options.method || 'GET'} ${url}`);
    return { ok: next.status < 400, status: next.status, json: async () => next.body };
  };
  return { fetchImpl, calls };
}

function client(responses) {
  const { fetchImpl, calls } = stub(responses);
  return { github: createGithub({ token: 'tok', apiBase: 'https://api.test', fetchImpl }), calls };
}

test('request sends auth and API version headers', async () => {
  const { github, calls } = client([{ status: 200, body: { ok: true } }]);
  const body = await github.request('/x');
  assert.deepEqual(body, { ok: true });
  assert.equal(calls[0].options.headers.Authorization, 'Bearer tok');
  assert.equal(calls[0].options.headers['X-GitHub-Api-Version'], '2022-11-28');
  assert.equal(calls[0].url, 'https://api.test/x');
});

test('request throws an error carrying the status', async () => {
  const { github } = client([{ status: 404, body: { message: 'Not Found' } }]);
  await assert.rejects(github.request('/missing'), (err) => {
    assert.equal(err.status, 404);
    assert.match(err.message, /404/);
    return true;
  });
});

test('createIssue posts title, body, and labels', async () => {
  const { github, calls } = client([{ status: 201, body: { number: 3, html_url: 'u' } }]);
  const issue = await github.createIssue('me', 'repo', { title: 't', body: 'b', labels: ['l'] });
  assert.equal(issue.number, 3);
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body), { title: 't', body: 'b', labels: ['l'] });
});

test('ensureLabel is a no-op when the label already exists', async () => {
  const { github, calls } = client([{ status: 200, body: { name: 'visual-annotation' } }]);
  await github.ensureLabel('me', 'repo', 'visual-annotation');
  assert.equal(calls.length, 1);
});

test('ensureLabel creates the label when it is missing', async () => {
  const { github, calls } = client([
    { status: 404, body: {} },
    { status: 201, body: {} },
  ]);
  await github.ensureLabel('me', 'repo', 'visual-annotation');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].url, 'https://api.test/repos/me/repo/labels');
});

test('getFileText decodes base64 file contents', async () => {
  const content = Buffer.from('export const x = 1;').toString('base64');
  const { github } = client([{ status: 200, body: { type: 'file', content } }]);
  assert.equal(await github.getFileText('me', 'repo', 'src/x.js'), 'export const x = 1;');
});

test('getFileText returns null for a directory or empty payload', async () => {
  const { github } = client([{ status: 200, body: { type: 'dir' } }]);
  assert.equal(await github.getFileText('me', 'repo', 'src'), null);
});

test('putFile retries with the existing sha on a 422', async () => {
  const { github, calls } = client([
    { status: 422, body: { message: 'sha required' } },
    { status: 200, body: { sha: 'existing' } },
    { status: 200, body: { content: {} } },
  ]);
  await github.putFile({
    owner: 'me',
    repo: 'r',
    repoPath: '.visual-annotator/a.png',
    branch: 'assets',
    base64Content: 'AAAA',
    message: 'add',
  });
  assert.equal(calls.length, 3);
  assert.equal(JSON.parse(calls[2].options.body).sha, 'existing');
});

test('putFile does not retry on unrelated errors', async () => {
  const { github, calls } = client([{ status: 500, body: {} }]);
  await assert.rejects(
    github.putFile({ owner: 'me', repo: 'r', repoPath: 'p', branch: 'b', base64Content: 'A', message: 'm' }),
    (err) => err.status === 500
  );
  assert.equal(calls.length, 1);
});
