import test from 'node:test';
import assert from 'node:assert/strict';

import { formatIssueBody, issueTitle, machinePayload } from '../server/issue-format.js';
import { buildAnnotation, SCHEMA_ID } from '../shared/annotation.js';

function annotation(overrides = {}) {
  return buildAnnotation({
    text: 'Button is misaligned on mobile',
    url: 'http://localhost:3000/checkout',
    locator: {
      framework: 'react',
      file: 'src/Button.jsx',
      line: 42,
      component: 'Button',
      selector: 'button.btn',
      text: 'Buy now',
    },
    consoleLog: [],
    ...overrides,
  });
}

function extractJson(body) {
  const match = body.match(/```json\n([\s\S]*?)\n```/);
  assert.ok(match, 'expected a fenced json block');
  return JSON.parse(match[1]);
}

test('issueTitle prefers the component name', () => {
  assert.equal(issueTitle(annotation()), '[VA] Button: Button is misaligned on mobile');
});

test('issueTitle falls back to the file, then the selector tail', () => {
  assert.match(issueTitle(annotation({ locator: { file: 'src/a.js' } })), /^\[VA\] src\/a\.js: /);
  assert.match(issueTitle(annotation({ locator: { selector: 'div > a.link' } })), /^\[VA\] a\.link: /);
});

test('issueTitle truncates long text', () => {
  assert.match(issueTitle(annotation({ text: 'x'.repeat(80) })), /…$/);
});

test('body leads with the report and the expected behaviour', () => {
  const body = formatIssueBody(annotation({ expected: 'Button should sit below the header' }));
  assert.ok(body.startsWith('Button is misaligned on mobile'));
  assert.match(body, /\*\*Expected:\*\* Button should sit below the header/);
});

test('body omits the expected line when there is none', () => {
  assert.doesNotMatch(formatIssueBody(annotation()), /\*\*Expected:\*\*/);
});

test('body renders the exact source location and framework', () => {
  const body = formatIssueBody(annotation());
  assert.match(body, /\*\*Where:\*\* `src\/Button\.jsx:42` \(component: `Button`\)/);
  assert.match(body, /\*\*Framework:\*\* react/);
  assert.match(body, /\*\*Page:\*\* http:\/\/localhost:3000\/checkout/);
});

test('body labels a best guess when there is no source location', () => {
  const body = formatIssueBody(annotation({ locator: { selector: 'button.btn' } }));
  assert.match(body, /\*\*Where \(best guess\):\*\* `button\.btn`/);
  assert.doesNotMatch(body, /\*\*Framework:\*\*/);
});

test('body renders the git revision and environment', () => {
  const body = formatIssueBody(
    annotation({
      git: { commit: 'abcdef1234567890', branch: 'feat/x' },
      environment: { viewportWidth: 1440, viewportHeight: 900, devicePixelRatio: 2, userAgent: 'Chrome' },
    })
  );
  assert.match(body, /\*\*Revision:\*\* `abcdef1` on `feat\/x`/);
  assert.match(body, /\*\*Environment:\*\* 1440×900 · @2x · Chrome/);
});

test('body renders a code frame with a language hint', () => {
  const body = formatIssueBody(annotation({ codeFrame: '> 42 | return <button />;' }));
  assert.match(body, /\*\*Code frame:\*\*/);
  assert.match(body, /```jsx\n> 42 \| return <button \/>;\n```/);
});

test('body renders the element markup when captured', () => {
  const body = formatIssueBody(annotation({ locator: { file: 'src/a.jsx', selector: 'button', outerHTML: '<button>Buy</button>' } }));
  assert.match(body, /\*\*Element markup:\*\*/);
  assert.match(body, /<button>Buy<\/button>/);
});

test('body explains an empty console log and formats captured lines', () => {
  assert.match(formatIssueBody(annotation()), /_No console output was captured/);
  const withLogs = formatIssueBody(
    annotation({ consoleLog: [{ level: 'warn', message: 'deprecated prop' }] })
  );
  assert.match(withLogs, /```\n\[warn\] deprecated prop\n```/);
});

test('body embeds a stored screenshot url', () => {
  const body = formatIssueBody(
    annotation({ screenshot: { path: '.visual-annotator/a.png', url: 'https://gh/a.png', branch: 'assets' } })
  );
  assert.match(body, /!\[annotation\]\(https:\/\/gh\/a\.png\)/);
});

test('body names a local-only screenshot instead of embedding it', () => {
  const body = formatIssueBody(annotation({ screenshot: { path: '/tmp/va/a.png' } }));
  assert.match(body, /saved locally at `\/tmp\/va\/a\.png` \(not uploaded\)/);
  assert.doesNotMatch(body, /!\[annotation\]/);
});

test('body omits the screenshot section when there is none', () => {
  assert.doesNotMatch(formatIssueBody(annotation()), /\*\*Screenshot:\*\*/);
});

test('body carries a machine-readable payload that round-trips', () => {
  const a = annotation({ expected: 'no overlap', git: { commit: 'abc1234', branch: 'main' } });
  const body = formatIssueBody(a);
  assert.match(body, /<summary>Machine-readable annotation<\/summary>/);
  const payload = extractJson(body);
  assert.equal(payload.schema, SCHEMA_ID);
  assert.equal(payload.id, a.id);
  assert.equal(payload.expected, 'no overlap');
  assert.equal(payload.locator.file, 'src/Button.jsx');
  assert.equal(payload.git.commit, 'abc1234');
});

test('machine payload strips the transient data url', () => {
  const a = annotation({ screenshot: 'data:image/png;base64,AAAA' });
  const payload = machinePayload(a);
  assert.deepEqual(payload.screenshot, { path: null, url: null, branch: null });
  assert.doesNotMatch(JSON.stringify(payload), /data:image/);
});

test('mentions are appended only when provided', () => {
  assert.doesNotMatch(formatIssueBody(annotation()), /@/);
  assert.match(formatIssueBody(annotation(), { mentions: ['alice', 'bob'] }), /@alice @bob/);
});
