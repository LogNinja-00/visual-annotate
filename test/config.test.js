import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveConfig, missingConfig } from '../shared/config.js';

test('resolveConfig falls back to documented defaults', () => {
  const config = resolveConfig({ env: {} });
  assert.equal(config.label, 'visual-annotation');
  assert.equal(config.screenshotProvider, 'github');
  assert.equal(config.screenshotBranch, 'visual-annotator-assets');
  assert.equal(config.port, 4545);
});

test('resolveConfig reads credentials from the environment', () => {
  const config = resolveConfig({
    env: { GITHUB_TOKEN: 't', GITHUB_OWNER: 'o', GITHUB_REPO: 'r' },
  });
  assert.deepEqual(missingConfig(config), []);
});

test('explicit options win over the environment', () => {
  const config = resolveConfig({
    options: { label: 'custom', screenshotProvider: 'local', port: 9000 },
    env: { VA_LABEL: 'from-env', VA_SCREENSHOT_PROVIDER: 'github', VA_PORT: '1234' },
  });
  assert.equal(config.label, 'custom');
  assert.equal(config.screenshotProvider, 'local');
  assert.equal(config.port, 9000);
});

test('environment variables win over defaults', () => {
  const config = resolveConfig({
    env: { VA_LABEL: 'triage', VA_SCREENSHOT_BRANCH: 'shots', VA_PORT: '5000' },
  });
  assert.equal(config.label, 'triage');
  assert.equal(config.screenshotBranch, 'shots');
  assert.equal(config.port, 5000);
});

test('missingConfig names exactly what is absent', () => {
  assert.deepEqual(missingConfig(resolveConfig({ env: {} })), ['token', 'owner', 'repo']);
  assert.deepEqual(
    missingConfig(resolveConfig({ env: { GITHUB_TOKEN: 't' } })),
    ['owner', 'repo']
  );
});

test('empty-string env values are treated as absent', () => {
  const config = resolveConfig({ env: { GITHUB_TOKEN: '', VA_LABEL: '' } });
  assert.equal(config.token, null);
  assert.equal(config.label, 'visual-annotation');
});
