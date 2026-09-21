// Commits the screenshot into the repository itself, under a dated folder, and
// returns a blob URL the issue can embed. No third-party host: the image never
// leaves the repo it belongs to, which keeps NDA-covered UI private.
//
// The Contents API cannot attach a file to an issue body — that endpoint is
// web-UI only and needs session cookies — so hosting the image in the repo is
// the supported way to get it in front of a reader.

import { dataUrlToBuffer } from './data-url.js';

export const DEFAULT_DIR = '.visual-annotator';
export const DEFAULT_MAX_BYTES = 1_000_000;

function datedPath(dir, annotation) {
  const date = new Date(annotation.createdAt || Date.now());
  const day = Number.isNaN(date.getTime())
    ? new Date().toISOString().slice(0, 10)
    : date.toISOString().slice(0, 10);
  return `${dir}/${day}/${annotation.id}.png`;
}

export function createGithubScreenshotProvider({
  github,
  owner,
  repo,
  branch,
  dir = DEFAULT_DIR,
  maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  return {
    name: 'github',

    async store(dataUrl, annotation) {
      const buffer = dataUrlToBuffer(dataUrl);
      if (!buffer) return null;
      if (buffer.length > maxBytes) {
        console.error(
          `[VA] Screenshot is ${buffer.length} bytes, over the ${maxBytes}-byte budget; skipping.`
        );
        return null;
      }

      const repoPath = datedPath(dir, annotation);
      await github.ensureBranch(owner, repo, branch);
      await github.putFile({
        owner,
        repo,
        repoPath,
        branch,
        base64Content: buffer.toString('base64'),
        message: `chore(visual-annotate): add screenshot for ${annotation.id}`,
      });

      return {
        path: repoPath,
        url: `https://github.com/${owner}/${repo}/blob/${branch}/${repoPath}?raw=true`,
        branch,
      };
    },
  };
}
