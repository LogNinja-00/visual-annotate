#!/usr/bin/env node
import 'dotenv/config';
import { createServer } from '../server/index.js';

const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, VA_PORT } = process.env;

if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
  console.error(
    '[visual-annotate] Missing config. Create a .env file in your project root with:\n\n' +
      'GITHUB_TOKEN=ghp_xxx\n' +
      'GITHUB_OWNER=your-username-or-org\n' +
      'GITHUB_REPO=your-repo-name\n\n' +
      'GITHUB_TOKEN needs the "repo" scope (or "public_repo" for a public repo only).\n' +
      'Never commit this .env file — add it to .gitignore.'
  );
  process.exit(1);
}

createServer({
  owner: GITHUB_OWNER,
  repo: GITHUB_REPO,
  token: GITHUB_TOKEN,
  port: VA_PORT ? Number(VA_PORT) : 4545,
});
