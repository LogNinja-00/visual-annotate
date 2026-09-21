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

test('vite plugin injects a served bootstrap module, not an inline script', () => {
  const plugin = visualAnnotate(OPTIONS);
  const tags = plugin.transformIndexHtml();
  assert.equal(tags.length, 1);
  assert.equal(tags[0].tag, 'script');
  assert.equal(tags[0].attrs.type, 'module');
  assert.equal(tags[0].injectTo, 'body');
  // An inline script would bypass Vite's import analysis and ship a bare
  // specifier the browser cannot resolve, so this must be a served URL.
  assert.equal(tags[0].children, undefined);
  assert.match(tags[0].attrs.src, /^\/@id\//);
});

test('the bootstrap module resolves and initialises the client same-origin', () => {
  const plugin = visualAnnotate(OPTIONS);
  const resolved = plugin.resolveId('virtual:visual-annotator-bootstrap');
  assert.ok(resolved);
  const code = plugin.load(resolved);
  assert.match(code, /import \{ initAnnotator \} from 'visual-annotate\/client'/);
  assert.ok(code.includes(SUBMIT_ROUTE));
  assert.ok(code.includes('"allowedHosts":null'));
  assert.equal(plugin.load('/something/else.js'), null);
});

test('vite plugin warns when credentials are missing', () => {
  const plugin = visualAnnotate({});
  const { server, warnings } = fakeViteServer();
  plugin.configResolved({ root: '/app' });
  plugin.configureServer(server);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /GITHUB_TOKEN/);
});
