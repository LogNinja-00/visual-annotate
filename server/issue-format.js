// Pure formatting of an annotation into a GitHub issue title + body.
// Deliberately free of I/O and globals so it can be reasoned about and tested
// on its own — the server module owns the network, this module owns the shape.

export function issueTitle(comment) {
  const loc = comment.locator || {};
  let where = loc.component || loc.file || 'page';
  if (!loc.component && !loc.file && loc.selector) {
    const parts = loc.selector.split(' > ');
    where = parts[parts.length - 1] || 'element';
  }
  const short = comment.text.length > 60 ? comment.text.slice(0, 57) + '…' : comment.text;
  return `[VA] ${where}: ${short}`;
}

export function formatIssueBody(comment, mentions = []) {
  const loc = comment.locator || {};
  const locLine = loc.file
    ? `**Location:** \`${loc.file}${loc.line ? ':' + loc.line : ''}\`${
        loc.component ? ` (component: \`${loc.component}\`)` : ''
      }`
    : `**Location (best guess):** \`${loc.selector || 'unknown'}\``;

  const consoleBlock =
    comment.consoleLog && comment.consoleLog.length > 0
      ? '```\n' + comment.consoleLog.map((l) => `[${l.level}] ${l.message}`).join('\n') + '\n```'
      : '_No console output was captured for this element — likely a purely visual issue._';

  const screenshotBlock = comment.screenshotUrl
    ? `\n**Screenshot:**\n![annotation](${comment.screenshotUrl})\n`
    : '';

  return [
    comment.text,
    '',
    '---',
    locLine,
    `**Element:** \`${loc.selector || ''}\`${loc.text ? ` — "${loc.text}"` : ''}`,
    `**Page:** ${comment.url}`,
    `**Reported:** ${comment.time}`,
    '',
    '**Recent console log:**',
    consoleBlock,
    screenshotBlock,
    mentions.length ? mentions.map((m) => `@${m}`).join(' ') : '',
  ].join('\n');
}
