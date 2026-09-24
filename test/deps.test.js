import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createSubmissionDeps } from '../server/deps.js';
import { buildAnnotation } from '../shared/annotation.js';

const SOURCE = 'export function Button() {\n  return <button>Buy</button>;\n}\n';

async function projectRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'va-deps-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src', 'Button.jsx'), SOURCE);
  return root;
}

function depsFor(root) {
  return createSubmissionDeps(
    { root, owner: 'me', repo: 'proj', label: 'l', screenshotProvider: 'off' },
    { cwd: root, github: {} }
  );
}

function annotationWith(file) {
  return buildAnnotation({ text: 'x', url: 'u', locator: { file, line: 2 } });
}

test('a repo-relative source path produces a code frame', async () => {
  const root = await projectRoot();
  const enriched = await depsFor(root).enrich(annotationWith('src/Button.jsx'));
  assert.match(enriched.codeFrame, /> 2 \| +return <button>Buy<\/button>;/);
});

test('a root-relative path (leading slash) still produces a code frame', async () => {
  const root = await projectRoot();
  const enriched = await depsFor(root).enrich(annotationWith('/src/Button.jsx'));
  assert.ok(enriched.codeFrame, 'expected a code frame for a /src/... path');
  assert.match(enriched.codeFrame, /> 2 \|/);
});

test('an absolute path inside the project still produces a code frame', async () => {
  const root = await projectRoot();
  const enriched = await depsFor(root).enrich(annotationWith(path.join(root, 'src', 'Button.jsx')));
  assert.ok(enriched.codeFrame, 'expected a code frame for an absolute path');
});

test('a path outside the project degrades to no code frame', async () => {
  const root = await projectRoot();
  const enriched = await depsFor(root).enrich(annotationWith('/nope/does-not-exist.jsx'));
  assert.equal(enriched.codeFrame, null);
});
