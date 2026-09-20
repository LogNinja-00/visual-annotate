// Client for the local visual-annotate server. One seam:
// submitComments(serverUrl, comments) -> issue[] and throws SubmitError otherwise.
// Both the annotation panel and the dock's "Submit all" go through here, so the
// request shape, response handling, and offline detection live in one place.
//
// error.offline distinguishes "server not running" (fetch never got a response)
// from "server answered but refused" — callers choose how to surface each.

export class SubmitError extends Error {
  constructor(message, { offline = false, cause } = {}) {
    super(message);
    this.name = 'SubmitError';
    this.offline = offline;
    if (cause) this.cause = cause;
  }
}

export async function submitComments(serverUrl, comments) {
  let res;
  try {
    res = await fetch(`${serverUrl}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comments }),
    });
  } catch (cause) {
    throw new SubmitError('Could not reach the local server', { offline: true, cause });
  }

  const data = await res.json().catch(() => null);
  if (!data || !Array.isArray(data.issues) || data.issues.length === 0) {
    throw new SubmitError(data && data.error ? data.error : 'Server returned no issues');
  }
  return data.issues;
}
