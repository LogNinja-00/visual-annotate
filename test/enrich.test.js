import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { frameAround, createEnricher, createGitInfo } from '../shared/enrich.js';
import { buildAnnotation, SCHEMA_ID } from '../shared/annotation.js';

const SOURCE = ['line one', 'line two', 'line three', 'line four', 'line five'].join('\n');

test('frameAround marks the target line and numbers the window', () => {
  const frame = frameAround(SOURCE, 3, { context: 1 });
  assert.equal(
    frame,
    ['  2 | line two', '> 3 | line three', '  4 | line four'].join('\n')
  );
});

test('frameAround clamps at the file boundaries', () => {
  const frame = frameAround(SOURCE, 1, { context: 2 });
  assert.equal(frame.split('\n')[0], '> 1 | line one');
  assert.equal(frameAround(SOURCE, 5, { context: 2 }).split('\n').at(-1), '> 5 | line five');
});

test('frameAround returns null for unusable input', () => {
  assert.equal(frameAround('', 1), null);
  assert.equal(frameAround(SOURCE, 0), null);
  assert.equal(frameAround(SOURCE, null), null);
  assert.equal(frameAround(SOURCE, 99), null);
  assert.equal(frameAround(undefined, 1), null);
});

test('enricher attaches a code frame from the source reader', async () => {
  const enrich = createEnricher({
    readSourceFile: async () => SOURCE,
    gitInfo: async () => ({ commit: 'abc123', branch: 'main' }),
  });
  const result = await enrich(
    buildAnnotation({ text: 'x', url: 'u', locator: { file: 'src/x.js', line: 2 } })
  );
  assert.equal(result.schema, SCHEMA_ID);
  assert.match(result.codeFrame, /> 2 \| line two/);
  assert.deepEqual(result.git, { commit: 'abc123', branch: 'main' });
});

test('enricher degrades quietly when the source cannot be read', async () => {
  const enrich = createEnricher({
    readSourceFile: async () => {
      throw new Error('ENOENT');
    },
    gitInfo: async () => null,
  });
  const result = await enrich(
    buildAnnotation({ text: 'x', url: 'u', locator: { file: 'gone.js', line: 3 } })
  );
  assert.equal(result.codeFrame, null);
  assert.equal(result.git, null);
});

test('enricher does not overwrite an existing git revision', async () => {
  const enrich = createEnricher({ gitInfo: async () => ({ commit: 'new', branch: 'b' }) });
  const result = await enrich(
    buildAnnotation({ text: 'x', url: 'u', git: { commit: 'reported', branch: 'feat' } })
  );
  assert.equal(result.git.commit, 'reported');
});

test('enricher skips the code frame without a source location', async () => {
  const enrich = createEnricher({ readSourceFile: async () => SOURCE });
  const result = await enrich(buildAnnotation({ text: 'x', url: 'u', locator: { selector: 'div' } }));
  assert.equal(result.codeFrame, null);
});

test('createGitInfo reads the real revision of a git working tree', async () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const info = await createGitInfo({ cwd: repoRoot })();
  assert.ok(info, 'expected git info for this repository');
  assert.match(info.commit, /^[0-9a-f]{40}$/);
});

test('createGitInfo returns null outside a git repository', async () => {
  const info = await createGitInfo({ cwd: path.parse(process.cwd()).root })();
  assert.equal(info, null);
});
