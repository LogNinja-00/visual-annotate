// Assembles the dependencies handleSubmission needs, from a resolved config.
// Shared by the standalone server and the plugins so both enrich and store
// screenshots the same way.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { createEnricher, createGitInfo } from '../shared/enrich.js';
import { createGithub } from '../shared/github.js';
import { createScreenshotStore } from './screenshots/index.js';

// The plugin runs inside the app, so it can read source straight from disk.
function diskSourceReader(root) {
  return async (file) => {
    try {
      const abs = path.isAbsolute(file) ? file : path.join(root, file);
      return await readFile(abs, 'utf8');
    } catch {
      return null;
    }
  };
}

// The standalone server has no checkout, so it reads through the API instead.
function githubSourceReader(github, owner, repo) {
  return async (file) => github.getFileText(owner, repo, file).catch(() => null);
}

export function createSubmissionDeps(config, { cwd = process.cwd(), github } = {}) {
  const client = github || createGithub({ token: config.token });

  const screenshots = createScreenshotStore({
    provider: config.screenshotProvider,
    github: client,
    owner: config.owner,
    repo: config.repo,
    branch: config.screenshotBranch,
    dir: config.screenshotDir,
    maxBytes: config.screenshotMaxBytes,
  });

  const readSourceFile = config.root
    ? diskSourceReader(config.root)
    : githubSourceReader(client, config.owner, config.repo);

  const enrich = createEnricher({
    readSourceFile,
    gitInfo: createGitInfo({ cwd }),
  });

  return {
    github: client,
    screenshots,
    owner: config.owner,
    repo: config.repo,
    label: config.label,
    enrich,
  };
}
