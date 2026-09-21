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

// The bootstrap has to be a module Vite actually serves and transforms. An
// inline <script> injected into the HTML is not run through import analysis, so
// the bare 'visual-annotate/client' specifier would reach the browser verbatim
// and fail to resolve.
const BOOTSTRAP_ID = 'virtual:visual-annotator-bootstrap';
const RESOLVED_BOOTSTRAP_ID = '\0' + BOOTSTRAP_ID;
const BOOTSTRAP_URL = '/@id/__x00__' + BOOTSTRAP_ID;

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

    resolveId(id) {
      return id === BOOTSTRAP_ID ? RESOLVED_BOOTSTRAP_ID : null;
    },

    load(id) {
      if (id !== RESOLVED_BOOTSTRAP_ID) return null;
      const clientOptions = {
        submitUrl: SUBMIT_ROUTE,
        allowedHosts: null,
        ...config.client,
      };
      return [
        `import { initAnnotator } from '${CLIENT_MODULE}';`,
        `initAnnotator(${JSON.stringify(clientOptions)});`,
      ].join('\n');
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
      return [
        {
          tag: 'script',
          attrs: { type: 'module', src: BOOTSTRAP_URL },
          injectTo: 'body',
        },
      ];
    },
  };
}
