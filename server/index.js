import http from 'node:http';

const GITHUB_API = 'https://api.github.com';

async function githubRequest(path, token, options = {}) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`GitHub API ${path} failed: ${res.status} ${JSON.stringify(body)}`);
  }
  return body;
}

async function getCollaboratorLogins(owner, repo, token) {
  const collaborators = await githubRequest(`/repos/${owner}/${repo}/collaborators`, token);
  return collaborators.map((c) => c.login);
}

async function uploadScreenshot(owner, repo, token, dataUri) {
  const match = /^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/=]+)$/.exec(dataUri || '');
  if (!match) return null;
  const isPng = match[1] === 'png';
  const name = `va-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${isPng ? 'png' : 'jpg'}`;
  const contentType = isPng ? 'image/png' : 'image/jpeg';

  const repoInfo = await githubRequest(`/repos/${owner}/${repo}`, token);
  const res = await fetch(
    `https://uploads.github.com/user-attachments/assets?name=${encodeURIComponent(name)}&content_type=${contentType}&repository_id=${repoInfo.id}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': contentType,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: Buffer.from(match[2], 'base64'),
    },
  );
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.url) {
    throw new Error(`Screenshot upload failed: ${res.status} ${JSON.stringify(body)}`);
  }
  return body.url;
}

function formatIssueBody(comment, mentions, screenshotUrl) {
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

  const screenshotBlock = screenshotUrl
    ? `\n**Screenshot:**\n![annotation](${screenshotUrl})\n`
    : comment.screenshot
      ? '\n**Screenshot:** _failed to upload_\n'
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

function issueTitle(comment) {
  const loc = comment.locator || {};
  let where = loc.component || loc.file || 'page';
  if (!loc.component && !loc.file && loc.selector) {
    const parts = loc.selector.split(' > ');
    where = parts[parts.length - 1] || 'element';
  }
  const short = comment.text.length > 60 ? comment.text.slice(0, 57) + '…' : comment.text;
  return `[VA] ${where}: ${short}`;
}

export function createServer({ owner, repo, token, port = 4545 }) {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    if (req.method !== 'POST' || req.url !== '/submit') {
      res.writeHead(404);
      return res.end();
    }

    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', async () => {
      try {
        const { comments } = JSON.parse(raw);
        if (!Array.isArray(comments) || comments.length === 0) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'No comments provided' }));
        }

        const mentions = await getCollaboratorLogins(owner, repo, token).catch(() => []);
        const issues = [];
        for (const comment of comments) {
          let screenshotUrl = null;
          if (comment.screenshot) {
            screenshotUrl = await uploadScreenshot(owner, repo, token, comment.screenshot).catch((err) => {
              console.error('[visual-annotate] Screenshot upload failed:', err.message);
              return null;
            });
          }
          const issue = await githubRequest(`/repos/${owner}/${repo}/issues`, token, {
            method: 'POST',
            body: JSON.stringify({
              title: issueTitle(comment),
              body: formatIssueBody(comment, mentions, screenshotUrl),
              labels: ['visual-annotation'],
            }),
          });
          issues.push({ number: issue.number, html_url: issue.html_url });
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ issues }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  });

  server.listen(port, () => {
    console.log(`[visual-annotate] Local server listening on http://localhost:${port}`);
    console.log(`[visual-annotate] Forwarding issues to ${owner}/${repo}`);
  });

  return server;
}
