import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createScreenshotStore, dataUrlToBuffer } from '../server/screenshots/index.js';
import { createGithubScreenshotProvider } from '../server/screenshots/github-provider.js';
import { createLocalScreenshotProvider } from '../server/screenshots/local-provider.js';
import { buildAnnotation } from '../shared/annotation.js';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const DATA_URL = `data:image/png;base64,${PNG_BASE64}`;

function annotation(overrides = {}) {
  return buildAnnotation({
    text: 'x',
    url: 'http://localhost:3000/',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });
}

function stubGithub() {
  const calls = [];
  return {
    calls,
    getRepo: async (owner, repo) => {
      calls.push({ fn: 'getRepo', owner, repo });
      return { default_branch: 'main' };
    },
    putFile: async (input) => {
      calls.push({ fn: 'putFile', input });
      return {};
    },
  };
}

test('dataUrlToBuffer decodes a png data url', () => {
  const buffer = dataUrlToBuffer(DATA_URL);
  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.length, Buffer.from(PNG_BASE64, 'base64').length);
});

test('dataUrlToBuffer rejects non-image and empty payloads', () => {
  assert.equal(dataUrlToBuffer('https://example.com/a.png'), null);
  assert.equal(dataUrlToBuffer('data:text/plain;base64,aGk='), null);
  assert.equal(dataUrlToBuffer('data:image/png;base64,'), null);
  assert.equal(dataUrlToBuffer(null), null);
});

test('github provider commits into a folder on the repo default branch', async () => {
  const github = stubGithub();
  const provider = createGithubScreenshotProvider({ github, owner: 'me', repo: 'proj' });
  const a = annotation();
  const result = await provider.store(DATA_URL, a);

  assert.equal(result.path, `.visual-annotator/2026-01-01/${a.id}.png`);
  assert.equal(result.branch, 'main');
  assert.equal(
    result.url,
    `https://github.com/me/proj/blob/main/.visual-annotator/2026-01-01/${a.id}.png?raw=true`
  );
  assert.deepEqual(github.calls.map((c) => c.fn), ['getRepo', 'putFile']);
  assert.equal(github.calls[1].input.branch, 'main');
  assert.equal(github.calls[1].input.base64Content, PNG_BASE64);
});

test('the default branch is looked up once, not per screenshot', async () => {
  const github = stubGithub();
  const provider = createGithubScreenshotProvider({ github, owner: 'me', repo: 'proj' });
  await provider.store(DATA_URL, annotation());
  await provider.store(DATA_URL, annotation());
  assert.equal(github.calls.filter((c) => c.fn === 'getRepo').length, 1);
});

test('github provider honours a custom directory', async () => {
  const github = stubGithub();
  const provider = createGithubScreenshotProvider({ github, owner: 'me', repo: 'p', dir: 'shots' });
  const result = await provider.store(DATA_URL, annotation());
  assert.match(result.path, /^shots\//);
});

test('github provider skips oversized screenshots without calling the api', async () => {
  const github = stubGithub();
  const provider = createGithubScreenshotProvider({ github, owner: 'me', repo: 'p', maxBytes: 8 });
  assert.equal(await provider.store(DATA_URL, annotation()), null);
  assert.equal(github.calls.length, 0);
});

test('local provider writes the png to disk and returns the path', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'va-shots-'));
  const provider = createLocalScreenshotProvider({ dir });
  const a = annotation();
  const result = await provider.store(DATA_URL, a);

  assert.equal(result.path, path.join(dir, `${a.id}.png`));
  assert.equal(result.url, null);
  const written = await readFile(result.path);
  assert.deepEqual([...written], [...Buffer.from(PNG_BASE64, 'base64')]);
});

test('store degrades to null when the provider throws', async () => {
  const store = createScreenshotStore({
    provider: 'github',
    owner: 'me',
    repo: 'p',
    github: {
      getRepo: async () => ({ default_branch: 'main' }),
      putFile: async () => {
        throw new Error('boom');
      },
    },
  });
  assert.equal(await store.store(DATA_URL, annotation()), null);
});

test('store degrades to null when the repo lookup fails', async () => {
  const store = createScreenshotStore({
    provider: 'github',
    owner: 'me',
    repo: 'p',
    github: {
      getRepo: async () => {
        throw new Error('no access');
      },
      putFile: async () => ({}),
    },
  });
  assert.equal(await store.store(DATA_URL, annotation()), null);
});

test('store with the off provider never uploads', async () => {
  const store = createScreenshotStore({ provider: 'off' });
  assert.equal(store.provider, 'off');
  assert.equal(await store.store(DATA_URL, annotation()), null);
});

test('store returns null when there is no screenshot data', async () => {
  const store = createScreenshotStore({ provider: 'local', dir: os.tmpdir() });
  assert.equal(await store.store(undefined, annotation()), null);
});

test('an unknown provider is rejected loudly at construction', () => {
  assert.throws(() => createScreenshotStore({ provider: 'catbox' }), /Unknown screenshot provider/);
});
