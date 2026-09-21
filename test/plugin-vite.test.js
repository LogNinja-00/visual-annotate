import test from 'node:test';
import assert from 'node:assert/strict';

import visualAnnotate from '../plugins/vite.js';
import { SUBMIT_ROUTE } from '../shared/middleware.js';

const OPTIONS = { token: 't', owner: 'o', repo: 'r' };

function fakeViteServer(root = '/app') {
  const middlewares = [];
  const warnings = [];
  return {
    middlewares,
    warnings,
    server: {
      config: { root, logger: { warn: (msg) => warnings.push(msg) } },
      middlewares: { use: (fn) => middlewares.push(fn) },
    },
  };
}

test('vite plugin is dev-only and named', () => {
  const plugin = visualAnnotate(OPTIONS);
  assert.equal(plugin.name, 'visual-annotator');
  assert.equal(plugin.apply, 'serve');
});

test('vite plugin registers the submit middleware and the html2canvas asset', () => {
  const plugin = visualAnnotate(OPTIONS);
  const { server, middlewares } = fakeViteServer();
  plugin.configResolved({ root: '/app' });
  plugin.configureServer(server);
  assert.equal(middlewares.length, 2);
});

test('vite plugin injects a dev-only client script pointed at the same origin', () => {
  const plugin = visualAnnotate(OPTIONS);
  const tags = plugin.transformIndexHtml();
  assert.equal(tags.length, 1);
  assert.equal(tags[0].tag, 'script');
  assert.equal(tags[0].attrs.type, 'module');
  assert.equal(tags[0].injectTo, 'body');
  assert.match(tags[0].children, /import \{ initAnnotator \} from 'visual-annotate\/client'/);
  assert.ok(tags[0].children.includes(SUBMIT_ROUTE));
  assert.ok(tags[0].children.includes('"allowedHosts":null'));
});

test('vite plugin warns when credentials are missing', () => {
  const plugin = visualAnnotate({});
  const { server, warnings } = fakeViteServer();
  plugin.configResolved({ root: '/app' });
  plugin.configureServer(server);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /GITHUB_TOKEN/);
});
