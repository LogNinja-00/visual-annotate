import test from 'node:test';
import assert from 'node:assert/strict';

import { formatIssueBody, issueTitle } from '../server/issue-format.js';

function comment(overrides = {}) {
  return {
    text: 'Button is misaligned on mobile',
    locator: { framework: 'react', file: 'src/Button.jsx', line: 42, component: 'Button', selector: 'button.btn' },
    consoleLog: [],
    url: 'http://localhost:3000/checkout',
    time: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('issueTitle prefers the component name', () => {
  assert.equal(issueTitle(comment()), '[VA] Button: Button is misaligned on mobile');
});

test('issueTitle falls back to the file when there is no component', () => {
  const c = comment({ locator: { file: 'src/Button.jsx', selector: 'button' } });
  assert.match(issueTitle(c), /^\[VA\] src\/Button\.jsx: /);
});

test('issueTitle falls back to the last selector segment', () => {
  const c = comment({ locator: { selector: 'div > span > a.link' } });
  assert.match(issueTitle(c), /^\[VA\] a\.link: /);
});

test('issueTitle truncates long text with an ellipsis', () => {
  const c = comment({ text: 'x'.repeat(80) });
  const title = issueTitle(c);
  assert.match(title, /…$/);
  assert.ok(title.length < 80 + '[VA] Button: '.length);
});

test('formatIssueBody renders the exact source location when known', () => {
  const body = formatIssueBody(comment(), []);
  assert.match(body, /\*\*Location:\*\* `src\/Button\.jsx:42` \(component: `Button`\)/);
});

test('formatIssueBody labels a best guess when there is no source location', () => {
  const c = comment({ locator: { selector: 'button.btn' } });
  const body = formatIssueBody(c, []);
  assert.match(body, /\*\*Location \(best guess\):\*\* `button\.btn`/);
});

test('formatIssueBody explains an empty console log', () => {
  const body = formatIssueBody(comment(), []);
  assert.match(body, /_No console output was captured for this element/);
});

test('formatIssueBody formats captured console lines', () => {
  const c = comment({
    consoleLog: [
      { level: 'warn', message: 'deprecated prop' },
      { level: 'error', message: 'boom' },
    ],
  });
  const body = formatIssueBody(c, []);
  assert.match(body, /```\n\[warn\] deprecated prop\n\[error\] boom\n```/);
});

test('formatIssueBody embeds a screenshot only when uploaded', () => {
  assert.doesNotMatch(formatIssueBody(comment(), []), /Screenshot/);
  const withShot = formatIssueBody(comment({ screenshotUrl: 'https://img/x.png' }), []);
  assert.match(withShot, /!\[annotation\]\(https:\/\/img\/x\.png\)/);
});

test('formatIssueBody mentions collaborators only when there are any', () => {
  assert.doesNotMatch(formatIssueBody(comment(), []), /@/);
  const body = formatIssueBody(comment(), ['alice', 'bob']);
  assert.match(body, /@alice @bob/);
});
