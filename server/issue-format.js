// Renders an Annotation into a GitHub issue title and body.
//
// The body serves two audiences at once. A human skims the labelled sections at
// the top. An agent gets a code frame with the offending lines already in view,
// plus a machine-readable JSON payload in a <details> block so it can parse the
// annotation deterministically instead of regexing prose.
//
// Pure: no I/O, no globals. The server and the plugins both call it.

import { SCHEMA_ID } from '../shared/annotation.js';

const LANGUAGE_BY_EXT = {
  jsx: 'jsx',
  tsx: 'tsx',
  js: 'js',
  mjs: 'js',
  cjs: 'js',
  ts: 'ts',
  vue: 'vue',
  svelte: 'svelte',
  html: 'html',
  css: 'css',
};

function languageFor(file) {
  if (!file) return '';
  const ext = file.split('.').pop();
  return LANGUAGE_BY_EXT[ext] || '';
}

function shortSha(commit) {
  return commit ? commit.slice(0, 7) : null;
}

export function issueTitle(annotation) {
  const loc = annotation.locator || {};
  let where = loc.component || loc.file || 'page';
  if (!loc.component && !loc.file && loc.selector) {
    const parts = loc.selector.split(' > ');
    where = parts[parts.length - 1] || 'element';
  }
  const text = annotation.text || '';
  const short = text.length > 60 ? text.slice(0, 57) + '…' : text;
  return `[VA] ${where}: ${short}`;
}

function locationLine(loc) {
  if (loc.file) {
    const line = loc.line ? `:${loc.line}` : '';
    const component = loc.component ? ` (component: \`${loc.component}\`)` : '';
    return `**Where:** \`${loc.file}${line}\`${component}`;
  }
  return `**Where (best guess):** \`${loc.selector || 'unknown'}\``;
}

function environmentLine(env = {}) {
  const parts = [];
  if (env.viewportWidth && env.viewportHeight) {
    parts.push(`${env.viewportWidth}×${env.viewportHeight}`);
  }
  if (env.devicePixelRatio) parts.push(`@${env.devicePixelRatio}x`);
  if (env.userAgent) parts.push(env.userAgent.slice(0, 120));
  return parts.length ? `**Environment:** ${parts.join(' · ')}` : null;
}

function revisionLine(git) {
  if (!git) return null;
  const sha = shortSha(git.commit);
  if (!sha && !git.branch) return null;
  const on = git.branch ? ` on \`${git.branch}\`` : '';
  return `**Revision:** ${sha ? `\`${sha}\`` : 'unknown'}${on}`;
}

function consoleSection(consoleEntries = []) {
  if (consoleEntries.length > 0) {
    const lines = consoleEntries.map((l) => `[${l.level}] ${l.message}`).join('\n');
    return ['**Recent console log:**', '```\n' + lines + '\n```'].join('\n');
  }
  return [
    '**Recent console log:**',
    '_No console output was captured for this element — likely a purely visual issue._',
  ].join('\n');
}

function codeFrameSection(codeFrame, file) {
  if (!codeFrame) return null;
  const lang = languageFor(file);
  return ['**Code frame:**', '```' + lang + '\n' + codeFrame + '\n```'].join('\n');
}

function screenshotSection(screenshot) {
  if (!screenshot) return null;
  if (screenshot.url) return `**Screenshot:**\n![annotation](${screenshot.url})`;
  if (screenshot.path) {
    return `**Screenshot:** saved locally at \`${screenshot.path}\` (not uploaded)`;
  }
  return null;
}

/**
 * The payload an agent should read. The transient data URL is stripped so the
 * JSON stays small and never leaks a raw image blob.
 */
export function machinePayload(annotation) {
  const screenshot = annotation.screenshot
    ? { path: annotation.screenshot.path ?? null, url: annotation.screenshot.url ?? null, branch: annotation.screenshot.branch ?? null }
    : null;
  return {
    ...annotation,
    schema: SCHEMA_ID,
    screenshot,
  };
}

export function formatIssueBody(annotation, { mentions = [] } = {}) {
  const loc = annotation.locator || {};
  const blocks = [];

  blocks.push(annotation.text || '');
  if (annotation.expected) blocks.push(`**Expected:** ${annotation.expected}`);
  blocks.push('---');

  const facts = [locationLine(loc)];
  facts.push(`**Element:** \`${loc.selector || ''}\`${loc.text ? ` — "${loc.text}"` : ''}`);
  facts.push(`**Page:** ${annotation.url}`);
  if (loc.framework && loc.framework !== 'unknown') facts.push(`**Framework:** ${loc.framework}`);
  const revision = revisionLine(annotation.git);
  if (revision) facts.push(revision);
  const environment = environmentLine(annotation.environment);
  if (environment) facts.push(environment);
  blocks.push(facts.join('\n'));

  const frame = codeFrameSection(annotation.codeFrame, loc.file);
  if (frame) blocks.push(frame);

  if (loc.outerHTML) {
    const lang = languageFor(loc.file) || 'html';
    blocks.push(['**Element markup:**', '```' + lang + '\n' + loc.outerHTML + '\n```'].join('\n'));
  }

  blocks.push(consoleSection(annotation.console));

  const screenshot = screenshotSection(annotation.screenshot);
  if (screenshot) blocks.push(screenshot);

  blocks.push(
    [
      '<details>',
      '<summary>Machine-readable annotation</summary>',
      '',
      '```json',
      JSON.stringify(machinePayload(annotation), null, 2),
      '```',
      '',
      '</details>',
    ].join('\n')
  );

  if (mentions.length) blocks.push(mentions.map((m) => `@${m}`).join(' '));

  return blocks.join('\n\n');
}
