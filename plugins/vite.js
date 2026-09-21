// Vite plugin: host the annotator inside the app's own dev server.
//
// Same-origin submissions mean no CORS headers at all, the credentials live in
// the dev process the developer already trusts, and nothing extra has to be
// started. Dev-only (`apply: 'serve'`), so nothing reaches a production build.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveConfig, missingConfig } from '../shared/config.js';
import { createSubmitMiddleware, SUBMIT_ROUTE } from '../shared/middleware.js';
import { createSubmissionDeps } from '../server/deps.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HTML2CANVAS_FILE = path.resolve(HERE, '../src/html2canvas.min.js');
const HTML2CANVAS_ROUTE = '/html2canvas.min.js';
const CLIENT_MODULE = 'visual-annotate/client';

export default function visualAnnotate(options = {}) {
  const config = resolveConfig({ options });
  let deps = null;

  return {
    name: 'visual-annotator',
    apply: 'serve',

    configResolved(resolved) {
      const root = config.root || resolved.root;
      deps = createSubmissionDeps({ ...config, root }, { cwd: root });
    },

    configureServer(server) {
      const missing = missingConfig(config);
      if (missing.length) {
        server.config.logger.warn(
          `[visual-annotator] Missing config (${missing.join(', ')}). Submissions will fail until GITHUB_TOKEN/GITHUB_OWNER/GITHUB_REPO are set.`
        );
      }

      server.middlewares.use(
        createSubmitMiddleware({
          deps: deps || createSubmissionDeps({ ...config, root: server.config.root }),
        })
      );

      // Serve the vendored html2canvas, so the app does not have to copy it
      // into public/ by hand.
      server.middlewares.use(async (req, res, next) => {
        if ((req.url || '').split('?')[0] !== HTML2CANVAS_ROUTE) return next();
        try {
          const body = await readFile(HTML2CANVAS_FILE);
          res.setHeader('Content-Type', 'application/javascript');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(body);
        } catch {
          next();
        }
      });
    },

    transformIndexHtml() {
      const clientOptions = {
        submitUrl: SUBMIT_ROUTE,
        allowedHosts: null,
        ...config.client,
      };
      return [
        {
          tag: 'script',
          attrs: { type: 'module' },
          children: [
            `import { initAnnotator } from '${CLIENT_MODULE}';`,
            `initAnnotator(${JSON.stringify(clientOptions)});`,
          ].join('\n'),
          injectTo: 'body',
        },
      ];
    },
  };
}
