import test from 'node:test';
import assert from 'node:assert/strict';
import { isTextLeaf, stabilizeCloneContent, textLeafNodes } from '../../src/screenshot.js';
import { analyzeCanvasImageData } from '../../src/geometry.js';

function node(tag, text, opts = {}) {
  const n = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    textContent: text,
    children: opts.children || [],
    style: {
      _props: {},
      setProperty(k, v) {
        this._props[k] = v;
      },
    },
    classList: {
      _set: new Set(opts.classes || []),
      add(c) {
        this._set.add(c);
      },
      remove(c) {
        this._set.delete(c);
      },
      contains(c) {
        return this._set.has(c);
      },
    },
    setAttribute(k, v) {
      this[k] = v;
    },
    getAttribute(k) {
      return this[k];
    },
    closest(sel) {
      // emulate selector lists by substring match on className / tag
      if (sel.includes('__va_')) {
        if (typeof this.className === 'string' && this.className.includes('__va_')) return this;
        return null;
      }
      if (sel.includes('mint-gen-code')) {
        if (typeof this.className === 'string' && this.className.includes('mint-gen-code')) return this;
      }
      return null;
    },
  };
  if (opts.className) n.className = opts.className;
  return n;
}

test('isTextLeaf rejects empty and tool nodes', () => {
  assert.equal(isTextLeaf(node('span', '   ')), false);
  assert.equal(isTextLeaf(node('span', 'ok')), true);
  const tool = node('div', 'x');
  tool.className = '__va_panel';
  tool.closest = (sel) => (sel.includes('__va_') ? tool : null);
  assert.equal(isTextLeaf(tool), false);
});

test('isTextLeaf rejects nodes with element children', () => {
  const parent = node('p', 'text', { children: [node('span', 'child')] });
  assert.equal(isTextLeaf(parent), false);
});

test('stabilizeCloneContent hides overlays without clearing text', () => {
  const overlay = node('div', 'REAL CODE TEXT', { className: 'mint-gen-code' });
  const body = node('div', 'Keep me');
  const clone = {
    querySelectorAll(sel) {
      if (sel.includes('mint-gen-code')) return [overlay];
      if (sel.includes('.mint-gen')) return [];
      return [];
    },
    createElement: () => ({ setAttribute() {}, textContent: '', style: {} }),
    head: { appendChild() {} },
    defaultView: null,
  };
  stabilizeCloneContent(clone);
  // text must remain
  assert.equal(overlay.textContent, 'REAL CODE TEXT');
  assert.equal(overlay.style._props.display, 'none');
});

test('textLeafNodes filters via document-like root', () => {
  const good = node('h1', 'Title');
  const bad = node('span', '  ');
  const root = {
    querySelectorAll() {
      return [good, bad];
    },
  };
  const out = textLeafNodes(root);
  assert.equal(out.length, 1);
  assert.equal(out[0], good);
});

test('blank stats helper shared with screenshot retry', () => {
  const data = new Uint8ClampedArray(16 * 16 * 4).fill(255);
  const s = analyzeCanvasImageData(data, 16, 16, 1);
  assert.equal(s.blank, true);
});
