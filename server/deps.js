// Assembles the dependencies handleSubmission needs, from a resolved config.
// Shared by the standalone server and the plugins so both enrich and store
// screenshots the same way.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { createEnricher, createGitInfo } from '../shared/enrich.js';
import { createGithub } from '../shared/github.js';
import { createScreenshotStore } from './screenshots/index.js';

// The plugin runs inside the app, so it can read source straight from disk.
// Framework debug paths are inconsistent — React reports a real absolute path,
// while bundlers often report a root-relative one like '/src/Button.jsx' — so
// try both interpretations before giving up.
function diskSourceReader(root) {
  return async (file) => {
    const candidates = path.isAbsolute(file)
      ? [file, path.join(root, file.replace(/^[/\\]+/, ''))]
      : [path.join(root, file)];

    for (const candidate of candidates) {
      try {
        return await readFile(candidate, 'utf8');
      } catch {
        // try the next interpretation
      }
    }
    return null;
  };
}

// The standalone server has no checkout, so it reads through the API instead.
// The Contents API only understands repo-relative paths.
function githubSourceReader(github, owner, repo) {
  return async (file) => {
    const repoPath = String(file).replace(/^[/\\]+/, '');
    return github.getFileText(owner, repo, repoPath).catch(() => null);
  };
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
