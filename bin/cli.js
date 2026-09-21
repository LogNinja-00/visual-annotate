#!/usr/bin/env node
import 'dotenv/config';
import { randomBytes } from 'node:crypto';

import { createServer } from '../server/index.js';
import { resolveConfig, missingConfig } from '../shared/config.js';

const config = resolveConfig({});
const missing = missingConfig(config);

if (missing.length) {
  console.error(
    '[visual-annotate] Missing config: ' +
      missing.join(', ') +
      '\n\nCreate a .env file in your project root with:\n\n' +
      'GITHUB_TOKEN=ghp_xxx\n' +
      'GITHUB_OWNER=your-username-or-org\n' +
      'GITHUB_REPO=your-repo-name\n\n' +
      'GITHUB_TOKEN needs the "repo" scope (or "public_repo" for a public repo only).\n' +
      'Never commit this .env file — add it to .gitignore.'
  );
  process.exit(1);
}

// A shared secret so a stray local process cannot file issues, even though the
// server already refuses non-loopback origins. Pin it with VA_TOKEN if you want
// a stable value across restarts.
const sessionToken = process.env.VA_TOKEN || randomBytes(16).toString('hex');

const server = createServer({ ...config, sessionToken });

function shutdown() {
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(`[visual-annotate] Session token: ${sessionToken}`);
console.log('[visual-annotate] Point the browser client at this server with:');
console.log(
  `  initAnnotator({ submitUrl: 'http://127.0.0.1:${config.port}/submit', token: '${sessionToken}' })`
);
