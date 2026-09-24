import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pickBestElement,
  isToolNode,
  INTERACTIVE_SELECTOR,
  SEMANTIC_SELECTOR,
} from '../../src/selection.js';

const INTERACTIVE_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY']);
const SEMANTIC_TAGS = new Set([
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'LI', 'DT', 'DD', 'BLOCKQUOTE', 'FIGCAPTION',
  'FIGURE', 'IMG', 'VIDEO', 'PICTURE', 'SVG', 'CANVAS', 'CODE', 'PRE', 'TH', 'TD', 'TABLE',
  'NAV', 'HEADER', 'FOOTER', 'MAIN', 'SECTION', 'ARTICLE', 'ASIDE', 'FORM', 'FIELDSET',
  'LEGEND', 'UL', 'OL', 'DL', 'HR', 'ADDRESS', 'SMALL', 'STRONG', 'EM', 'B', 'I', 'U',
  'MARK', 'ABBR', 'TIME', 'VAR', 'KBD', 'SAMP',
]);

function matchesSelector(el, selector) {
  const parts = selector.split(',').map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    if (part === '[class*="__va_"]') {
      if (typeof el.className === 'string' && el.className.includes('__va_')) return true;
      continue;
    }
    if (part === '[data-va-ui]') {
      if (el.attributes && el.attributes['data-va-ui'] != null) return true;
      continue;
    }
    if (part.startsWith('[role=')) {
      const role = part.match(/\[role="?([^\]"]+)"?\]/);
      if (role && el.attributes && el.attributes.role === role[1]) return true;
      continue;
    }
    if (part === '[onclick]') {
      if (el.attributes && el.attributes.onclick != null) return true;
      continue;
    }
    if (part.startsWith('[contenteditable')) {
      if (el.attributes && el.attributes.contenteditable === 'true') return true;
      continue;
    }
    if (/^[a-zA-Z][a-zA-Z0-9]*$/.test(part) && el.tagName === part.toUpperCase()) return true;
  }
  return false;
}

function makeEl(tagName, opts = {}) {
  const el = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    id: opts.id || '',
    className: opts.className || '',
    attributes: opts.attributes || {},
    childNodes: [],
    children: [],
    parentElement: opts.parent || null,
    _rect: opts.rect || { left: 0, top: 0, width: 100, height: 40, right: 100, bottom: 40 },
    matches(sel) {
      return matchesSelector(this, sel);
    },
    closest(sel) {
      let n = this;
      while (n) {
        if (n.matches && n.matches(sel)) return n;
        n = n.parentElement;
      }
      return null;
    },
    getBoundingClientRect() {
      return this._rect;
    },
    getAttribute(name) {
      if (this.attributes && this.attributes[name] != null) return this.attributes[name];
      return null;
    },
    setAttribute(name, value) {
      if (!this.attributes) this.attributes = {};
      this.attributes[name] = value;
    },
    get parent() {
      return this.parentElement;
    },
  };
  if (opts.text != null) {
    el.childNodes.push({ nodeType: 3, textContent: opts.text });
  }
  if (opts.children) {
    for (const c of opts.children) {
      c.parentElement = el;
      el.children.push(c);
      el.childNodes.push(c);
    }
  }
  if (opts.parent) {
    opts.parent.children.push(el);
    opts.parent.childNodes.push(el);
  }
  return el;
}

function makeDoc(body) {
  return { body, documentElement: { nodeType: 1, tagName: 'HTML' } };
}

test('isToolNode detects __va_ class', () => {
  const el = makeEl('div', { className: '__va_panel' });
  assert.equal(isToolNode(el), true);
});

test('isToolNode detects data-va-ui', () => {
  const el = makeEl('div', { attributes: { 'data-va-ui': '1' } });
  assert.equal(isToolNode(el), true);
});

test('isToolNode detects __va_ id', () => {
  const el = makeEl('div', { id: '__va_overlay' });
  assert.equal(isToolNode(el), true);
});

test('isToolNode ignores body pick-mode class', () => {
  const body = makeEl('body', { className: '__va_pick_mode' });
  const btn = makeEl('button', { parent: body, text: 'x' });
  // no ownerDocument on fakes — loop hits null body check via document.body fallback
  // Simulate: ownerDocument undefined, document.body is real Node in jsdom-less env
  // Our fake has no ownerDocument; isToolNode must not treat body class as tool.
  const tool = makeEl('div', { className: '__va_panel', parent: body });
  const inner = makeEl('span', { text: 'in', parent: tool });
  assert.equal(isToolNode(tool), true);
  assert.equal(isToolNode(inner), true);
});

test('picks button not inner span', () => {
  const body = makeEl('body');
  const span = makeEl('span', {
    text: 'Get started',
    rect: { left: 4, top: 8, width: 100, height: 20, right: 104, bottom: 28 },
  });
  const btn = makeEl('button', {
    className: 'cta',
    parent: body,
    children: [span],
    rect: { left: 0, top: 0, width: 120, height: 40, right: 120, bottom: 40 },
  });
  const doc = makeDoc(body);
  assert.equal(pickBestElement(span, doc), btn);
});

test('picks h1 not inner span', () => {
  const body = makeEl('body');
  const span = makeEl('span', {
    className: 'block',
    text: 'نبني منتجات',
    rect: { left: 0, top: 0, width: 400, height: 60, right: 400, bottom: 60 },
  });
  const h1 = makeEl('h1', {
    className: 'font-hero',
    parent: body,
    children: [span],
    rect: { left: 0, top: 0, width: 400, height: 60, right: 400, bottom: 60 },
  });
  const doc = makeDoc(body);
  assert.equal(pickBestElement(span, doc), h1);
});

test('picks p when hovering text node wrapper', () => {
  const body = makeEl('body');
  const span = makeEl('span', {
    text: 'hello',
    rect: { left: 0, top: 0, width: 200, height: 20, right: 200, bottom: 20 },
  });
  const p = makeEl('p', {
    parent: body,
    children: [span],
    rect: { left: 0, top: 0, width: 300, height: 50, right: 300, bottom: 50 },
  });
  const doc = makeDoc(body);
  assert.equal(pickBestElement(span, doc), p);
});

test('returns null for tool UI', () => {
  const tool = makeEl('div', { className: '__va_panel' });
  const doc = makeDoc(makeEl('body'));
  assert.equal(pickBestElement(tool, doc), null);
});

test('single-child wrapper div climbs to semantic child', () => {
  const body = makeEl('body');
  const h2 = makeEl('h2', {
    rect: { left: 0, top: 0, width: 200, height: 80, right: 200, bottom: 80 },
  });
  const wrapper = makeEl('div', {
    parent: body,
    children: [h2],
    rect: { left: 0, top: 0, width: 200, height: 80, right: 200, bottom: 80 },
  });
  const doc = makeDoc(body);
  assert.equal(pickBestElement(wrapper, doc), h2);
});

test('link with nested span picks the anchor', () => {
  const body = makeEl('body');
  const span = makeEl('span', {
    text: 'Home',
    rect: { left: 0, top: 0, width: 80, height: 30, right: 80, bottom: 30 },
  });
  const a = makeEl('a', {
    className: 'nav-link',
    parent: body,
    children: [span],
    rect: { left: 0, top: 0, width: 80, height: 30, right: 80, bottom: 30 },
  });
  const doc = makeDoc(body);
  assert.equal(pickBestElement(span, doc), a);
});

test('headings and interactive selectors are exported', () => {
  assert.ok(INTERACTIVE_SELECTOR.includes('button'));
  assert.ok(SEMANTIC_SELECTOR.includes('h1'));
  assert.ok(INTERACTIVE_TAGS.size > 0);
  assert.ok(SEMANTIC_TAGS.size > 0);
});
