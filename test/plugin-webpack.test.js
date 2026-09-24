import test from 'node:test';
import assert from 'node:assert/strict';

import VisualAnnotatePlugin from '../plugins/webpack.js';

const OPTIONS = { token: 't', owner: 'o', repo: 'r' };

function fakeCompiler({ devServer = {} } = {}) {
  const taps = {};
  const compiler = {
    context: '/app',
    options: { devServer },
    hooks: {
      thisCompilation: { tap: (name, fn) => { taps.thisCompilation = fn; } },
      afterEnvironment: { tap: (name, fn) => { taps.afterEnvironment = fn; } },
    },
  };
  return { compiler, taps };
}

test('webpack plugin registers same-origin middleware on the dev server', () => {
  const plugin = new VisualAnnotatePlugin(OPTIONS);
  const { compiler, taps } = fakeCompiler();

  plugin.apply(compiler);
  taps.thisCompilation({ warnings: [] });
  taps.afterEnvironment();

  const middlewares = [];
  compiler.options.devServer.setupMiddlewares(middlewares, {});
  assert.equal(middlewares.length, 1);
  assert.equal(typeof middlewares[0], 'function');
});

test('webpack plugin preserves a pre-existing setupMiddlewares hook', () => {
  const plugin = new VisualAnnotatePlugin(OPTIONS);
  let priorCalled = false;
  const { compiler, taps } = fakeCompiler({
    devServer: { setupMiddlewares: (m) => { priorCalled = true; return m; } },
  });

  plugin.apply(compiler);
  taps.afterEnvironment();
  const middlewares = [];
  compiler.options.devServer.setupMiddlewares(middlewares, {});
  assert.equal(priorCalled, true);
  assert.equal(middlewares.length, 1);
});

test('webpack plugin surfaces missing credentials as a warning', () => {
  const plugin = new VisualAnnotatePlugin({});
  const { compiler, taps } = fakeCompiler();
  const compilation = { warnings: [] };

  plugin.apply(compiler);
  taps.thisCompilation(compilation);

  assert.equal(compilation.warnings.length, 1);
  assert.match(compilation.warnings[0].message, /GITHUB_TOKEN/);
});

test('webpack plugin is a no-op without a dev server', () => {
  const plugin = new VisualAnnotatePlugin(OPTIONS);
  const { compiler, taps } = fakeCompiler({ devServer: undefined });
  compiler.options.devServer = undefined;
  plugin.apply(compiler);
  assert.doesNotThrow(() => taps.afterEnvironment());
});
