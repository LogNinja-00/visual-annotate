// The submission pipeline, independent of how the request arrived.
//
// Both the standalone HTTP server and the dev-server plugins call this, so the
// validation, enrichment, screenshot storage, and issue creation rules live in
// exactly one place. Free of `http` — it takes a parsed payload and returns a
// result.
//
// Failures are per-annotation: one bad report must not discard the rest, and
// the caller can tell exactly which ones landed.

import { buildAnnotation, validateAnnotation } from '../shared/annotation.js';
import { formatIssueBody, issueTitle } from './issue-format.js';

class SubmissionError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'SubmissionError';
    this.status = status;
  }
}

/**
 * @param {{ comments?: unknown[] }} payload
 * @param {{
 *   github: object,
 *   screenshots: { store: (dataUrl: string, annotation: object) => Promise<object|null> },
 *   owner: string,
 *   repo: string,
 *   label?: string,
 *   enrich?: (annotation: object) => Promise<object>,
 *   mentions?: () => Promise<string[]> | string[],
 * }} deps
 * @returns {Promise<{ created: object[], failed: {id: string|null, error: string}[] }>}
 */
export async function handleSubmission(payload, deps) {
  const { github, screenshots, owner, repo, label = 'visual-annotation', enrich, mentions } = deps;

  const incoming = payload && Array.isArray(payload.comments) ? payload.comments : [];
  if (incoming.length === 0) {
    throw new SubmissionError('No comments provided', 400);
  }

  // Best effort: a missing permission to create labels must not block filing.
  await github.ensureLabel(owner, repo, label).catch(() => {});

  let mentionList = [];
  if (mentions) {
    try {
      mentionList = (await mentions()) || [];
    } catch {
      mentionList = [];
    }
  }

  const created = [];
  const failed = [];

  for (const raw of incoming) {
    let annotation = null;
    try {
      annotation = buildAnnotation(raw);

      const { ok, errors } = validateAnnotation(annotation);
      if (!ok) throw new Error(`Invalid annotation: ${errors.join('; ')}`);

      if (enrich) annotation = await enrich(annotation);

      if (annotation.screenshot && annotation.screenshot.dataUrl) {
        const stored = await screenshots.store(annotation.screenshot.dataUrl, annotation);
        annotation = { ...annotation, screenshot: stored };
      }

      const issue = await github.createIssue(owner, repo, {
        title: issueTitle(annotation),
        body: formatIssueBody(annotation, { mentions: mentionList }),
        labels: [label],
      });

      created.push({ id: annotation.id, number: issue.number, html_url: issue.html_url });
    } catch (err) {
      failed.push({ id: (annotation && annotation.id) || (raw && raw.id) || null, error: err.message });
    }
  }

  return { created, failed };
}

export { SubmissionError };
