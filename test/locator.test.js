import test from 'node:test';
import assert from 'node:assert/strict';

import { cssPath, locate, reactSource, vueSource } from '../src/locator.js';

// Minimal element stand-in: cssPath only reads nodeType, tagName, id,
// className, parentElement and parentElement.children, so no DOM is needed.
function el(tagName, { id = '', className = '', parent = null, nodeType = 1 } = {}) {
  const node = { nodeType, tagName: tagName.toUpperCase(), id, className, parentElement: parent, children: [] };
  if (parent) parent.children.push(node);
  return node;
}

test('an id is treated as unique and stops the climb', () => {
  const root = el('div', { id: 'root' });
  const child = el('button', { className: 'btn', parent: root });
  assert.equal(cssPath(root), 'div#root');
  assert.equal(cssPath(child), 'div#root > button.btn');
});

test('keeps at most two classes', () => {
  const node = el('div', { className: 'a b c d' });
  assert.equal(cssPath(node), 'div.a.b');
});

test('adds nth-of-type only when siblings share the tag', () => {
  const ul = el('ul');
  const first = el('li', { parent: ul });
  const second = el('li', { parent: ul });
  assert.equal(cssPath(first), 'ul > li:nth-of-type(1)');
  assert.equal(cssPath(second), 'ul > li:nth-of-type(2)');
});

test('omits nth-of-type for a lone child', () => {
  const li = el('li', { parent: el('ul') });
  assert.equal(cssPath(li), 'ul > li');
});

test('returns an empty string for a non-element node', () => {
  assert.equal(cssPath({ nodeType: 3 }), '');
});

test('stops climbing after six segments', () => {
  let node = el('html');
  for (let i = 0; i < 10; i++) {
    node = el('div', { className: `l${i}`, parent: node });
  }
  assert.equal(cssPath(node).split(' > ').length, 6);
});

test('reactSource reads _debugSource off the fiber', () => {
  const node = el('button');
  node['__reactFiber$abc'] = {
    _debugSource: { fileName: 'src/Button.jsx', lineNumber: 5, columnNumber: 2 },
    type: { name: 'Button' },
    return: null,
  };
  assert.deepEqual(reactSource(node), {
    framework: 'react',
    file: 'src/Button.jsx',
    line: 5,
    column: 2,
    component: 'Button',
  });
});

test('reactSource falls back to the component _source', () => {
  const node = el('div');
  node['__reactFiber$x'] = {
    type: { displayName: 'Card', _source: { fileName: 'src/Card.jsx', lineNumber: 9 } },
    return: null,
  };
  const source = reactSource(node);
  assert.equal(source.file, 'src/Card.jsx');
  assert.equal(source.line, 9);
  assert.equal(source.component, 'Card');
});

test('reactSource climbs the fiber return chain', () => {
  const node = el('span');
  node['__reactFiber$y'] = {
    type: { name: 'Inner' },
    return: {
      _debugSource: { fileName: 'src/Outer.jsx', lineNumber: 3 },
      type: { name: 'Outer' },
      return: null,
    },
  };
  const source = reactSource(node);
  assert.equal(source.file, 'src/Outer.jsx');
  assert.equal(source.component, 'Outer');
});

test('reactSource returns null without fiber debug info', () => {
  assert.equal(reactSource(el('div')), null);
  const node = el('div');
  node['__reactFiber$z'] = { type: {}, return: null };
  assert.equal(reactSource(node), null);
});

test('vueSource climbs to the nearest component with __file', () => {
  const node = el('div');
  node.__vueParentComponent = {
    type: {},
    parent: { type: { __file: 'src/Child.vue', __name: 'Child' } },
  };
  assert.deepEqual(vueSource(node), {
    framework: 'vue',
    file: 'src/Child.vue',
    line: null,
    column: null,
    component: 'Child',
  });
});

test('vueSource accepts a vnode pointer', () => {
  const node = el('div');
  node.__vnode = { component: { type: { __file: 'src/V.vue', name: 'V' } } };
  assert.equal(vueSource(node).file, 'src/V.vue');
});

test('locate prefers react over vue and includes element markup', () => {
  const node = el('button', { className: 'btn' });
  node.outerHTML = '<button class="btn">Buy</button>';
  node.textContent = '  Buy  ';
  node['__reactFiber$q'] = {
    _debugSource: { fileName: 'src/B.jsx', lineNumber: 1 },
    type: { name: 'B' },
    return: null,
  };
  node.__vueParentComponent = { type: { __file: 'src/Ignored.vue' } };

  const loc = locate(node);
  assert.equal(loc.framework, 'react');
  assert.equal(loc.file, 'src/B.jsx');
  assert.equal(loc.selector, 'button.btn');
  assert.equal(loc.text, 'Buy');
  assert.equal(loc.outerHTML, '<button class="btn">Buy</button>');
});

test('locate degrades to a selector path when no framework info exists', () => {
  const node = el('div', { className: 'card' });
  node.outerHTML = '<div class="card"></div>';
  const loc = locate(node);
  assert.equal(loc.framework, 'unknown');
  assert.equal(loc.file, null);
  assert.equal(loc.selector, 'div.card');
});

test('locate survives an element that cannot be serialized', () => {
  const node = el('div');
  Object.defineProperty(node, 'outerHTML', {
    get() {
      throw new Error('nope');
    },
  });
  assert.equal(locate(node).outerHTML, null);
});

