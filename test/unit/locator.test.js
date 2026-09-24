import test from 'node:test';
import assert from 'node:assert/strict';
import { locate } from '../../src/locator.js';

function el(tag, opts = {}) {
  return {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    id: opts.id || '',
    className: opts.className || '',
    textContent: opts.text || '',
    children: [],
    childNodes: [],
    parentElement: opts.parent || null,
    get parent() {
      return this.parentElement;
    },
    // no react/vue keys → generic path
  };
}

test('locate falls back to selector + text', () => {
  const parent = el('div', { className: 'wrapper' });
  const child = el('h1', { className: 'title', text: 'Hello world', parent });
  parent.parentElement = null;
  const loc = locate(child);
  assert.equal(loc.framework, 'unknown');
  assert.equal(loc.text, 'Hello world');
  assert.ok(loc.selector.includes('h1'));
});

test('locate walks ancestors for selector path', () => {
  const body = el('body');
  const div = el('div', { className: 'a b', parent: body });
  const h2 = el('h2', { text: 'Hi', parent: div });
  const loc = locate(h2);
  assert.ok(loc.selector.length > 0);
  assert.equal(loc.text, 'Hi');
});
