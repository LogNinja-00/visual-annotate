// webpack plugin: host the annotator inside webpack-dev-server.
//
// Registers the same-origin submit middleware. Client injection is left to the
// application (import `visual-annotate/client` in a dev-only entry), because
// webpack has no first-party HTML injection hook — HtmlWebpackPlugin is the
// usual home for that.

import { resolveConfig, missingConfig } from '../shared/config.js';
import { createSubmitMiddleware } from '../shared/middleware.js';
import { createSubmissionDeps } from '../server/deps.js';

export default class VisualAnnotatePlugin {
  constructor(options = {}) {
    this.config = resolveConfig({ options });
  }

  apply(compiler) {
    const root = this.config.root || compiler.context || process.cwd();

    compiler.hooks.thisCompilation.tap('VisualAnnotatePlugin', (compilation) => {
      const missing = missingConfig(this.config);
      if (missing.length) {
        compilation.warnings.push(
          new Error(
            `[visual-annotator] Missing config (${missing.join(', ')}). Submissions will fail until GITHUB_TOKEN/GITHUB_OWNER/GITHUB_REPO are set.`
          )
        );
      }
    });

    compiler.hooks.afterEnvironment.tap('VisualAnnotatePlugin', () => {
      const devServer = compiler.options.devServer;
      if (!devServer) return;
      devServer.setupMiddlewares = devServer.setupMiddlewares || ((middlewares) => middlewares);
      const previous = devServer.setupMiddlewares;
      const deps = createSubmissionDeps({ ...this.config, root }, { cwd: root });
      devServer.setupMiddlewares = (middlewares, devServerInstance) => {
        middlewares.unshift(createSubmitMiddleware({ deps }));
        return previous(middlewares, devServerInstance);
      };
    });
  }
}
