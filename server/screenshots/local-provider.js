// Writes the screenshot to a local temp directory and references the path.
// Nothing leaves the machine — the maximum-privacy fallback for NDA work where
// even committing to the repo is not acceptable. Remote collaborators cannot
// see the image, which the issue body states plainly.

import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { dataUrlToBuffer } from './data-url.js';

export function createLocalScreenshotProvider({
  dir = path.join(os.tmpdir(), 'visual-annotator'),
} = {}) {
  return {
    name: 'local',

    async store(dataUrl, annotation) {
      const buffer = dataUrlToBuffer(dataUrl);
      if (!buffer) return null;

      await mkdir(dir, { recursive: true });
      const file = path.join(dir, `${annotation.id}.png`);
      await writeFile(file, buffer);

      return { path: file, url: null, branch: null };
    },
  };
}
