// Client for the annotator endpoint. One seam:
// submitComments({ url, comments, token }) -> { created, failed }, throwing
// SubmitError otherwise. Both the standalone server and the dev-server plugins
// answer with the same shape, so the browser does not care which one it hit.
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

export async function submitComments({ url, comments, token }) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'X-VA-Token': token } : {}),
      },
      body: JSON.stringify({ comments }),
    });
  } catch (cause) {
    throw new SubmitError('Could not reach the server', { offline: true, cause });
  }

  const data = await res.json().catch(() => null);
  const created = data && Array.isArray(data.created) ? data.created : [];
  const failed = data && Array.isArray(data.failed) ? data.failed : [];

  if (created.length === 0) {
    const reason =
      (data && data.error) || (failed[0] && failed[0].error) || `Server responded ${res.status}`;
    throw new SubmitError(reason, { offline: false });
  }

  return { created, failed };
}
