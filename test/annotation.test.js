import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAnnotation,
  validateAnnotation,
  isPendingScreenshot,
  SCHEMA_ID,
} from '../shared/annotation.js';

function valid(overrides = {}) {
  return buildAnnotation({
    text: 'Button overlaps the header',
    url: 'http://localhost:3000/',
    locator: { file: 'src/Button.jsx', line: 12, component: 'Button', selector: 'button.btn' },
    ...overrides,
  });
}

test('buildAnnotation stamps the schema and normalizes a raw comment', () => {
  const a = valid();
  assert.equal(a.schema, SCHEMA_ID);
  assert.equal(a.text, 'Button overlaps the header');
  assert.equal(a.expected, null);
  assert.equal(a.locator.framework, 'unknown');
  assert.equal(a.locator.file, 'src/Button.jsx');
  assert.equal(a.locator.line, 12);
  assert.deepEqual(a.console, []);
  assert.equal(a.screenshot, null);
});

test('buildAnnotation accepts the legacy time field as createdAt', () => {
  const a = buildAnnotation({ text: 'x', url: 'u', time: '2026-01-01T00:00:00.000Z' });
  assert.equal(a.createdAt, '2026-01-01T00:00:00.000Z');
});

test('buildAnnotation trims text and turns empty expected into null', () => {
  const a = buildAnnotation({ text: '  spaced  ', expected: '   ', url: 'u' });
  assert.equal(a.text, 'spaced');
  assert.equal(a.expected, null);
});

test('buildAnnotation caps the captured outerHTML and visible text', () => {
  const a = buildAnnotation({
    text: 'x',
    url: 'u',
    locator: { selector: 'div', text: 'y'.repeat(500), outerHTML: 'z'.repeat(5000) },
  });
  assert.equal(a.locator.text.length, 200);
  assert.equal(a.locator.outerHTML.length, 2000);
});

test('buildAnnotation keeps a pending data URL screenshot', () => {
  const a = buildAnnotation({ text: 'x', url: 'u', screenshot: 'data:image/png;base64,AAAA' });
  assert.deepEqual(a.screenshot, { dataUrl: 'data:image/png;base64,AAAA' });
  assert.equal(isPendingScreenshot(a), true);
});

test('buildAnnotation keeps a stored screenshot reference', () => {
  const a = buildAnnotation({
    text: 'x',
    url: 'u',
    screenshot: { path: '.visual-annotator/a.png', url: 'https://gh/a', branch: 'assets' },
  });
  assert.deepEqual(a.screenshot, {
    path: '.visual-annotator/a.png',
    url: 'https://gh/a',
    branch: 'assets',
  });
  assert.equal(isPendingScreenshot(a), false);
});

test('buildAnnotation drops unusable screenshot values', () => {
  assert.equal(buildAnnotation({ text: 'x', url: 'u', screenshot: 'not-a-data-url' }).screenshot, null);
  assert.equal(buildAnnotation({ text: 'x', url: 'u', screenshot: {} }).screenshot, null);
});

test('buildAnnotation normalizes console entries and filters junk', () => {
  const a = buildAnnotation({
    text: 'x',
    url: 'u',
    consoleLog: [{ level: 'error', message: 'boom' }, null, { level: 'nonsense', message: 'x' }],
  });
  assert.deepEqual(a.console, [
    { level: 'error', message: 'boom' },
    { level: 'log', message: 'x' },
  ]);
});

test('buildAnnotation keeps git only when it carries something', () => {
  assert.equal(buildAnnotation({ text: 'x', url: 'u', git: {} }).git, null);
  assert.deepEqual(buildAnnotation({ text: 'x', url: 'u', git: { commit: 'abc' } }).git, {
    commit: 'abc',
    branch: null,
  });
});

test('validateAnnotation accepts a well-formed annotation', () => {
  assert.deepEqual(validateAnnotation(valid()), { ok: true, errors: [] });
});

test('validateAnnotation rejects missing required fields', () => {
  const { ok, errors } = validateAnnotation(buildAnnotation({ url: 'u' }));
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('text')));
});

test('validateAnnotation rejects a foreign schema', () => {
  const a = { ...valid(), schema: 'something-else/1' };
  const { ok, errors } = validateAnnotation(a);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('schema')));
});

test('validateAnnotation rejects a malformed screenshot', () => {
  const a = { ...valid(), screenshot: { weird: true } };
  const { ok, errors } = validateAnnotation(a);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('screenshot')));
});

test('ids are unique per annotation', () => {
  assert.notEqual(buildAnnotation({ text: 'a', url: 'u' }).id, buildAnnotation({ text: 'b', url: 'u' }).id);
});
