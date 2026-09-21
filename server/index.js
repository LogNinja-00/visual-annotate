import http from 'node:http';
import { buildAnnotation } from '../shared/annotation.js';
import { createGithub } from '../shared/github.js';
import { createScreenshotStore } from './screenshots/index.js';
import { formatIssueBody, issueTitle } from './issue-format.js';

export function createServer({
  owner,
  repo,
  token,
  port = 4545,
  label = 'visual-annotation',
  screenshotProvider = 'github',
  screenshotBranch = 'visual-annotator-assets',
}) {
  const github = createGithub({ token });
  const screenshots = createScreenshotStore({
    provider: screenshotProvider,
    github,
    owner,
    repo,
    branch: screenshotBranch,
  });

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

        await github.ensureLabel(owner, repo, label);

        const issues = [];
        for (const incoming of comments) {
          let annotation = buildAnnotation(incoming);
          if (annotation.screenshot && annotation.screenshot.dataUrl) {
            const stored = await screenshots.store(annotation.screenshot.dataUrl, annotation);
            annotation = { ...annotation, screenshot: stored };
          }
          const issue = await github.createIssue(owner, repo, {
            title: issueTitle(annotation),
            body: formatIssueBody(annotation),
            labels: [label],
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
    console.log(`[visual-annotate] Forwarding issues to ${owner}/${repo} (screenshots: ${screenshots.provider})`);
  });

  return server;
}
