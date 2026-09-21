import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { initAnnotator } from '../src/browser.js';

// The browser module reads these off the global scope at call time, so point
// them at a fresh jsdom window per test.
function setGlobal(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

function setupDom({ url = 'http://localhost:3000/', html = '<button id="target" class="btn">Buy</button>' } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    url,
    pretendToBeVisual: true,
  });
  const { window } = dom;

  setGlobal('window', window);
  setGlobal('document', window.document);
  setGlobal('location', window.location);
  setGlobal('navigator', window.navigator);
  setGlobal('MutationObserver', window.MutationObserver);
  setGlobal('getComputedStyle', window.getComputedStyle.bind(window));
  setGlobal('fetch', async () => {
    throw new Error('fetch should be stubbed per test');
  });

  // getBoundingClientRect is all-zero in jsdom, so captureElement returns null
  // before it needs a real canvas — but it must get past the loader.
  window.html2canvas = async () => ({
    getContext: () => ({ beginPath() {}, ellipse() {}, stroke() {} }),
    toDataURL: () => 'data:image/png;base64,AAAA',
  });

  return dom;
}

function press(dom, init) {
  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { bubbles: true, ...init }));
}

function enable(dom) {
  press(dom, { code: 'KeyA', altKey: true, shiftKey: true });
}

function click(dom, el) {
  el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

function target(dom) {
  return dom.window.document.getElementById('target');
}

function panels(dom) {
  return dom.window.document.querySelectorAll('.__va_panel');
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('injects no page chrome', () => {
  const dom = setupDom();
  const annotator = initAnnotator();
  assert.equal(dom.window.document.querySelector('.__va_dock'), null, 'no dock element');
  assert.ok(dom.window.document.getElementById('__va_style__'), 'stylesheet is still injected');
  annotator.destroy();
});

test('does nothing when the host is not allowed', () => {
  const dom = setupDom({ url: 'http://example.com/' });
  const annotator = initAnnotator({ allowedHosts: ['localhost'] });
  enable(dom);
  click(dom, target(dom));
  assert.equal(panels(dom).length, 0, 'no panel on a disallowed host');
  assert.equal(typeof annotator.destroy, 'function');
  annotator.destroy();
});

test('an allowedHosts of null allows any dev host', () => {
  const dom = setupDom({ url: 'http://192.168.1.5:5173/' });
  const annotator = initAnnotator({ allowedHosts: null });
  enable(dom);
  click(dom, target(dom));
  assert.equal(panels(dom).length, 1);
  annotator.destroy();
});

test('only the configured shortcut toggles annotating', () => {
  const dom = setupDom();
  const annotator = initAnnotator({ shortcut: { key: 'b', alt: true, shift: true } });

  click(dom, target(dom));
  assert.equal(panels(dom).length, 0, 'inactive by default');

  press(dom, { code: 'KeyA', altKey: true, shiftKey: true });
  click(dom, target(dom));
  assert.equal(panels(dom).length, 0, 'KeyA must be ignored when the shortcut is b');

  press(dom, { code: 'KeyB', altKey: true, shiftKey: true });
  click(dom, target(dom));
  assert.equal(panels(dom).length, 1, 'KeyB turns annotating on');

  press(dom, { key: 'Escape' }); // close the empty panel, staying active
  assert.equal(panels(dom).length, 0);

  press(dom, { code: 'KeyB', altKey: true, shiftKey: true });
  click(dom, target(dom));
  assert.equal(panels(dom).length, 0, 'KeyB turns annotating back off');

  annotator.destroy();
});

test('the default shortcut is alt+shift+a', () => {
  const dom = setupDom();
  const annotator = initAnnotator();
  enable(dom);
  click(dom, target(dom));
  assert.equal(panels(dom).length, 1);
  annotator.destroy();
});

test('clicking an element opens a panel with the element label', () => {
  const dom = setupDom();
  const annotator = initAnnotator();
  enable(dom);

  click(dom, dom.window.document.getElementById('target'));

  assert.equal(panels(dom).length, 1);
  assert.equal(panels(dom)[0].querySelector('.__va_label').textContent, 'button#target');
  annotator.destroy();
});

test('two rapid clicks leave exactly one panel', () => {
  const dom = setupDom();
  const annotator = initAnnotator();
  enable(dom);

  const target = dom.window.document.getElementById('target');
  click(dom, target);
  click(dom, target);

  assert.equal(panels(dom).length, 1);
  annotator.destroy();
});

test('clicking does nothing while annotating is off', () => {
  const dom = setupDom();
  const annotator = initAnnotator();
  click(dom, dom.window.document.getElementById('target'));
  assert.equal(panels(dom).length, 0);
  annotator.destroy();
});

test('Escape does not discard a draft', () => {
  const dom = setupDom();
  const annotator = initAnnotator();
  enable(dom);
  click(dom, dom.window.document.getElementById('target'));

  const textarea = panels(dom)[0].querySelector('textarea');
  textarea.value = 'half-written thought';
  press(dom, { key: 'Escape' });

  assert.equal(panels(dom).length, 1, 'panel must survive a draft');
  assert.equal(panels(dom)[0].querySelector('textarea').value, 'half-written thought');
  annotator.destroy();
});

test('Escape closes an empty panel but keeps annotating on', () => {
  const dom = setupDom();
  const annotator = initAnnotator();
  enable(dom);
  click(dom, target(dom));

  press(dom, { key: 'Escape' });
  assert.equal(panels(dom).length, 0);

  click(dom, target(dom));
  assert.equal(panels(dom).length, 1, 'annotating stays on');
  annotator.destroy();
});

test('Escape with no panel stops annotating', () => {
  const dom = setupDom();
  const annotator = initAnnotator();
  enable(dom);
  press(dom, { key: 'Escape' });

  click(dom, target(dom));
  assert.equal(panels(dom).length, 0, 'Esc stopped annotating');
  annotator.destroy();
});

test('submitting posts the annotation with expected, environment, and locale', async () => {
  const dom = setupDom();
  const calls = [];
  const restoreFetch = globalThis.fetch;
  setGlobal('fetch', async (url, options) => {
    calls.push({ url, options });
    return {
      status: 200,
      json: async () => ({ created: [{ number: 1, html_url: 'https://gh/1' }], failed: [] }),
    };
  });

  const annotator = initAnnotator({ submitUrl: '/__visual-annotator/submit' });
  try {
    enable(dom);
    click(dom, dom.window.document.getElementById('target'));

    const panel = panels(dom)[0];
    panel.querySelector('textarea').value = 'overlaps the header';
    panel.querySelector('.__va_expected').value = 'it should sit below';
    click(dom, panel.querySelector('.__va_submit_now'));
    await tick();
    await tick();

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/__visual-annotator/submit');
    const body = JSON.parse(calls[0].options.body);
    const annotation = body.comments[0];
    assert.equal(annotation.text, 'overlaps the header');
    assert.equal(annotation.expected, 'it should sit below');
    assert.equal(annotation.locator.selector, 'button#target');
    assert.equal(annotation.locator.outerHTML, '<button id="target" class="btn">Buy</button>');
    assert.ok(annotation.environment.viewportWidth > 0);
    assert.equal(typeof annotation.environment.userAgent, 'string');
    assert.equal(annotation.locale, 'en-US');
  } finally {
    annotator.destroy();
    setGlobal('fetch', restoreFetch);
  }
});

test('submitting an empty comment does not call the server', async () => {
  const dom = setupDom();
  let called = false;
  const restoreFetch = globalThis.fetch;
  setGlobal('fetch', async () => {
    called = true;
    return { status: 200, json: async () => ({ created: [{}], failed: [] }) };
  });

  const annotator = initAnnotator();
  try {
    enable(dom);
    click(dom, dom.window.document.getElementById('target'));
    click(dom, panels(dom)[0].querySelector('.__va_submit_now'));
    await tick();

    assert.equal(called, false);
  } finally {
    annotator.destroy();
    setGlobal('fetch', restoreFetch);
  }
});

test('destroy tears down listeners so clicks no longer open panels', () => {
  const dom = setupDom();
  const annotator = initAnnotator();
  enable(dom);
  annotator.destroy();

  click(dom, target(dom));
  assert.equal(panels(dom).length, 0);
});
