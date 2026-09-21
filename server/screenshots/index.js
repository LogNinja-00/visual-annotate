// Screenshot destination, chosen by config. The store never throws: a failed
// upload must degrade to "no screenshot" rather than costing the reporter their
// issue.

import { createGithubScreenshotProvider } from './github-provider.js';
import { createLocalScreenshotProvider } from './local-provider.js';

export { dataUrlToBuffer } from './data-url.js';

export const SCREENSHOT_PROVIDERS = ['github', 'local', 'off'];

function resolveProvider(config) {
  switch (config.provider) {
    case 'off':
    case 'none':
      return null;
    case 'local':
      return createLocalScreenshotProvider(config);
    case 'github':
    case undefined:
      return createGithubScreenshotProvider(config);
    default:
      throw new Error(
        `Unknown screenshot provider "${config.provider}". Use one of: ${SCREENSHOT_PROVIDERS.join(', ')}.`
      );
  }
}

export function createScreenshotStore(config = {}) {
  const provider = resolveProvider(config);

  if (!provider) {
    return {
      provider: 'off',
      async store() {
        return null;
      },
    };
  }

  return {
    provider: provider.name,
    async store(dataUrl, annotation) {
      if (!dataUrl) return null;
      try {
        return await provider.store(dataUrl, annotation);
      } catch (err) {
        console.error(`[VA] Screenshot store (${provider.name}) failed:`, err.message);
        return null;
      }
    },
  };
}
