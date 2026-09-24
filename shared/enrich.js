// Enrichment: the extra context that turns a raw annotation into something an
// agent can act on without asking questions — a code frame around the reported
// source location, and the exact git revision the report came from.
//
// Node-only (reads files and shells out to git); `frameAround` is pure and
// separately testable.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_CONTEXT = 6;

/**
 * Render a numbered snippet of `sourceText` around a 1-indexed `line`, with the
 * target line marked. Pure — no I/O.
 *
 * @param {string} sourceText
 * @param {number} line
 * @param {{ context?: number }} [options]
 * @returns {string|null}
 */
export function frameAround(sourceText, line, { context = DEFAULT_CONTEXT } = {}) {
  if (typeof sourceText !== 'string' || !sourceText) return null;
  if (!Number.isInteger(line) || line < 1) return null;

  const lines = sourceText.split('\n');
  if (line > lines.length) return null;

  const start = Math.max(1, line - context);
  const end = Math.min(lines.length, line + context);
  const width = String(end).length;

  const out = [];
  for (let n = start; n <= end; n++) {
    const marker = n === line ? '>' : ' ';
    out.push(`${marker} ${String(n).padStart(width, ' ')} | ${lines[n - 1]}`);
  }
  return out.join('\n');
}

async function readCodeFrame(locator, readSourceFile, context) {
  if (!locator || !locator.file || !Number.isInteger(locator.line) || !readSourceFile) return null;
  try {
    const text = await readSourceFile(locator.file);
    return frameAround(text, locator.line, { context });
  } catch {
    return null;
  }
}

/**
 * @param {{
 *   readSourceFile?: (file: string) => Promise<string|null>,
 *   gitInfo?: () => Promise<{commit: string|null, branch: string|null}|null>,
 *   context?: number,
 * }} deps
 */
export function createEnricher({ readSourceFile, gitInfo, context = DEFAULT_CONTEXT } = {}) {
  return async function enrich(annotation) {
    const codeFrame = await readCodeFrame(annotation.locator, readSourceFile, context);

    let git = annotation.git || null;
    if (!git && gitInfo) {
      try {
        git = await gitInfo();
      } catch {
        git = null;
      }
    }

    return { ...annotation, codeFrame, git };
  };
}

/**
 * Best-effort git revision for a working directory. Returns null on any failure
 * so enrichment never blocks filing an issue.
 */
export function createGitInfo({ cwd = process.cwd() } = {}) {
  return async function gitInfo() {
    try {
      const [commit, branch] = await Promise.all([
        execFileAsync('git', ['rev-parse', 'HEAD'], { cwd }),
        execFileAsync('git', ['branch', '--show-current'], { cwd }),
      ]);
      const head = commit.stdout.trim();
      const name = branch.stdout.trim();
      if (!head && !name) return null;
      return { commit: head || null, branch: name || null };
    } catch {
      return null;
    }
  };
}
