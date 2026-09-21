// One place that resolves options, environment variables, and defaults into the
// config the server, the plugins, and the client all agree on.

const DEFAULTS = {
  label: 'visual-annotation',
  screenshotProvider: 'github',
  screenshotBranch: 'visual-annotator-assets',
  port: 4545,
};

const REQUIRED = ['token', 'owner', 'repo'];

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

export function resolveConfig({ options = {}, env = process.env } = {}) {
  return {
    token: firstDefined(options.token, env.GITHUB_TOKEN) ?? null,
    owner: firstDefined(options.owner, env.GITHUB_OWNER) ?? null,
    repo: firstDefined(options.repo, env.GITHUB_REPO) ?? null,
    label: firstDefined(options.label, env.VA_LABEL, DEFAULTS.label),
    screenshotProvider: firstDefined(
      options.screenshotProvider,
      env.VA_SCREENSHOT_PROVIDER,
      DEFAULTS.screenshotProvider
    ),
    screenshotBranch: firstDefined(
      options.screenshotBranch,
      env.VA_SCREENSHOT_BRANCH,
      DEFAULTS.screenshotBranch
    ),
    screenshotDir: firstDefined(options.screenshotDir, env.VA_SCREENSHOT_DIR),
    screenshotMaxBytes: options.screenshotMaxBytes,
    port: Number(firstDefined(options.port, env.VA_PORT, DEFAULTS.port)),
    root: options.root,
    client: options.client || {},
  };
}

export function missingConfig(config) {
  return REQUIRED.filter((key) => !config[key]);
}
