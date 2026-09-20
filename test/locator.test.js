import test from 'node:test';
import assert from 'node:assert/strict';

import { cssPath } from '../src/locator.js';

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
