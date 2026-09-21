// Thin GitHub REST client shared by the standalone server and the dev-server
// plugins. Node-only: uses Buffer to move file contents in and out of base64.
//
// `fetchImpl` is injectable so the whole surface is testable without network.

const DEFAULT_API = 'https://api.github.com';

export function createGithub({ token, apiBase = DEFAULT_API, fetchImpl = globalThis.fetch } = {}) {
  async function request(path, options = {}) {
    const res = await fetchImpl(`${apiBase}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(
        `GitHub API ${path} failed: ${res.status} ${JSON.stringify(body)}`
      );
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  }

  const contentsPath = (repoPath) =>
    repoPath.split('/').map(encodeURIComponent).join('/');

  return {
    request,

    async createIssue(owner, repo, { title, body, labels }) {
      return request(`/repos/${owner}/${repo}/issues`, {
        method: 'POST',
        body: JSON.stringify({ title, body, labels }),
      });
    },

    async collaboratorLogins(owner, repo) {
      const collaborators = await request(`/repos/${owner}/${repo}/collaborators`);
      return collaborators.map((c) => c.login);
    },

    // GitHub silently drops unknown labels, so make sure it exists first.
    async ensureLabel(owner, repo, name, { color = '0e8a16' } = {}) {
      try {
        await request(`/repos/${owner}/${repo}/labels/${encodeURIComponent(name)}`);
        return;
      } catch (err) {
        if (err.status !== 404) throw err;
      }
      await request(`/repos/${owner}/${repo}/labels`, {
        method: 'POST',
        body: JSON.stringify({ name, color, description: 'Filed by visual-annotate' }),
      }).catch(() => {});
    },

    async getRepo(owner, repo) {
      return request(`/repos/${owner}/${repo}`);
    },

    async getFileText(owner, repo, repoPath, ref) {
      const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
      const data = await request(
        `/repos/${owner}/${repo}/contents/${contentsPath(repoPath)}${query}`
      );
      if (!data || data.type !== 'file' || !data.content) return null;
      return Buffer.from(data.content, 'base64').toString('utf8');
    },

    async ensureBranch(owner, repo, branch) {
      try {
        await request(`/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`);
        return branch;
      } catch (err) {
        if (err.status !== 404) throw err;
      }
      const { default_branch: base } = await request(`/repos/${owner}/${repo}`);
      const ref = await request(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(base)}`);
      await request(`/repos/${owner}/${repo}/git/refs`, {
        method: 'POST',
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: ref.object.sha }),
      });
      return branch;
    },

    async putFile({ owner, repo, repoPath, branch, base64Content, message, sha }) {
      const send = (fileSha) =>
        request(`/repos/${owner}/${repo}/contents/${contentsPath(repoPath)}`, {
          method: 'PUT',
          body: JSON.stringify({
            message,
            content: base64Content,
            branch,
            ...(fileSha ? { sha: fileSha } : {}),
          }),
        });

      try {
        return await send(sha);
      } catch (err) {
        if (err.status !== 422) throw err;
        const existing = await request(
          `/repos/${owner}/${repo}/contents/${contentsPath(repoPath)}?ref=${encodeURIComponent(branch)}`
        ).catch(() => null);
        if (!existing || !existing.sha) throw err;
        return send(existing.sha);
      }
    },
  };
}
