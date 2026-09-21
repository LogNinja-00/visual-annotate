import http from 'node:http';
import { createGithub } from '../shared/github.js';
import { createScreenshotStore } from './screenshots/index.js';
import { handleSubmission } from './submit.js';

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
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: `Invalid JSON: ${err.message}` }));
      }

      try {
        const result = await handleSubmission(payload, {
          github,
          screenshots,
          owner,
          repo,
          label,
        });
        const status = result.created.length > 0 ? 200 : 502;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(err.status || 500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message, created: [], failed: [] }));
      }
    });
  });

  server.listen(port, () => {
    console.log(`[visual-annotate] Local server listening on http://localhost:${port}`);
    console.log(`[visual-annotate] Forwarding issues to ${owner}/${repo} (screenshots: ${screenshots.provider})`);
  });

  return server;
}
