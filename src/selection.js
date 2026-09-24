// DevTools / Cursor-Design-Mode style element picker.
//
// Problems with naive mouseover+e.target:
//   - nested spans get picked instead of the button/heading the user means
//   - outline-on-element is invisible on overflow/transform/z-index traps
//   - some elements never "look" selected
//
// Approach: elementFromPoint → walk to the nearest meaningful target →
// draw a pointer-events:none fixed overlay box (never mutates page layout).

export const INTERACTIVE_SELECTOR =
  'a,button,input,select,textarea,summary,label,' +
  '[role="button"],[role="link"],[role="menuitem"],[role="tab"],[role="option"],' +
  '[onclick],[contenteditable="true"]';

export const SEMANTIC_SELECTOR =
  'h1,h2,h3,h4,h5,h6,p,li,dt,dd,blockquote,figcaption,figure,' +
  'img,video,picture,svg,canvas,code,pre,th,td,table,' +
  'nav,header,footer,main,section,article,aside,form,fieldset,legend,' +
  'ul,ol,dl,hr,address,small,strong,em,b,i,u,mark,abbr,time,var,kbd,samp';

export function isToolNode(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.id && String(el.id).startsWith('__va')) return true;
  if (el.closest && el.closest('[data-va-ui]')) return true;
  // Never use [class*="__va_"] — body.__va_pick_mode would match every node.
  let n = el;
  while (n && n.nodeType === 1 && n.tagName !== 'BODY' && n.tagName !== 'HTML') {
    const cls = typeof n.className === 'string' ? n.className : '';
    if (cls.split(/\s+/).some((c) => c.startsWith('__va_') && c !== '__va_pick_mode')) return true;
    n = n.parentElement;
  }
  return false;
}

function hasOwnText(el) {
  if (!el) return false;
  for (const n of el.childNodes) {
    if (n.nodeType === 3 && n.textContent && n.textContent.trim()) return true;
  }
  return false;
}

function visibleRect(el) {
  try {
    return el.getBoundingClientRect();
  } catch {
    return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
  }
}

function isVisuallyMeaningful(r) {
  return r.width >= 2 && r.height >= 2;
}

/**
 * From a raw hit node, climb to the element the user actually means.
 */
export function pickBestElement(raw, doc) {
  let el = raw;
  while (el && el.nodeType !== 1) el = el.parentElement;
  if (!el) return null;
  if (!doc) doc = el.ownerDocument;
  if (el === doc.documentElement) return doc.body;
  if (isToolNode(el)) return null;

  // Prefer the nearest interactive ancestor (button wrapping a span, etc.)
  let interactive = null;
  try {
    interactive = el.closest(INTERACTIVE_SELECTOR);
  } catch {
    interactive = null;
  }
  if (interactive && !isToolNode(interactive)) {
    const ir = visibleRect(interactive);
    if (isVisuallyMeaningful(ir)) return interactive;
  }

  let node = el;
  let lastGood = el;
  let climbed = 0;

  // Unwrap empty single-child layout shells first (div>h2, span>span, …)
  // so we pick the meaningful content instead of climbing past it to body.
  while (
    node &&
    (node.tagName === 'DIV' || node.tagName === 'SPAN' || node.tagName === 'SECTION') &&
    !hasOwnText(node) &&
    node.children.length === 1 &&
    isVisuallyMeaningful(visibleRect(node))
  ) {
    const only = node.children[0];
    if (!only || only.nodeType !== 1 || !isVisuallyMeaningful(visibleRect(only))) break;
    climbed += 1;
    if (climbed > 16) break;
    node = only;
    lastGood = only;
  }

  while (node && node !== doc.body && node !== doc.documentElement) {
    if (isToolNode(node)) break;

    const r = visibleRect(node);
    if (isVisuallyMeaningful(r)) lastGood = node;
    const parent = node.parentElement;

    // span/code inside a heading/paragraph → prefer the outer semantic
    if (
      (node.tagName === 'SPAN' || node.tagName === 'CODE') &&
      parent &&
      parent.matches &&
      parent.matches(SEMANTIC_SELECTOR) &&
      !node.getAttribute('role') &&
      !node.getAttribute('onclick')
    ) {
      node = parent;
      climbed += 1;
      if (climbed > 16) return lastGood;
      continue;
    }

    // Single-child layout wrapper with no own text → climb
    if (
      (node.tagName === 'DIV' || node.tagName === 'SPAN' || node.tagName === 'SECTION' ||
        node.tagName === 'MAIN' || node.tagName === 'ARTICLE') &&
      !hasOwnText(node) &&
      node.children.length === 1 &&
      isVisuallyMeaningful(r)
    ) {
      climbed += 1;
      if (climbed > 16) return lastGood || node;
      node = parent;
      continue;
    }

    if (node.matches && node.matches(INTERACTIVE_SELECTOR)) return node;
    if (node.matches && node.matches(SEMANTIC_SELECTOR)) return node;
    if (hasOwnText(node) && isVisuallyMeaningful(r)) return node;

    if (!isVisuallyMeaningful(r)) {
      node = parent;
      continue;
    }

    if (climbed > 16) return lastGood || node;
    climbed += 1;
    node = parent;
  }

  return lastGood || el;
}

/** Hit-test a viewport point → best element, or null if over tool UI. */
export function pickElementAt(clientX, clientY, doc = document) {
  let raw;
  try {
    raw = doc.elementFromPoint(clientX, clientY);
  } catch {
    return null;
  }
  if (!raw) return null;
  if (isToolNode(raw)) return null;
  return pickBestElement(raw, doc);
}

const OVERLAY_ID = '__va_overlay';

export function ensureOverlayStyles(doc = document) {
  if (doc.getElementById('__va_overlay_style')) return;
  const style = doc.createElement('style');
  style.id = '__va_overlay_style';
  style.textContent = `
    #__va_overlay {
      position: fixed;
      z-index: 2147483000;
      pointer-events: none !important;
      box-sizing: border-box;
      border: 2px solid #29ADC4;
      border-radius: 4px;
      background: rgba(41, 173, 196, 0.12);
      box-shadow: 0 0 0 1px rgba(0,0,0,.25), 0 4px 16px rgba(0,0,0,.18);
      display: none;
    }
    #__va_overlay_tag {
      position: fixed;
      z-index: 2147483001;
      pointer-events: none !important;
      display: none;
      font: 11px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace;
      background: #0b3d47;
      color: #b8f4ff;
      padding: 3px 6px;
      border-radius: 4px;
      max-width: 40vw;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      box-shadow: 0 2px 8px rgba(0,0,0,.35);
    }
    .__va_panel, .__va_panel * { cursor: auto !important; }
    body.__va_pick_mode, body.__va_pick_mode * { cursor: crosshair !important; }
    .__va_panel { position: fixed; z-index: 2147483647; background: #14181a; color: #fcfafa; font: 13px/1.4 -apple-system, sans-serif; border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,.4); padding: 12px; width: 300px; box-sizing: border-box; }
    .__va_panel textarea { width: 100%; min-height: 60px; margin-top: 8px; background: #1e2426; color: #fcfafa; border: 1px solid #33393b; border-radius: 6px; padding: 6px; font: inherit; resize: vertical; box-sizing: border-box; }
    .__va_panel .__va_label { font-size: 11px; color: #9fb3b8; word-break: break-all; }
    .__va_panel .__va_status { font-size: 11px; color: #29ADC4; margin-top: 6px; min-height: 14px; }
    .__va_panel .__va_status[data-tone="error"] { color: #ff6b6b; }
    .__va_panel .__va_status[data-tone="ok"] { color: #4caf50; }
    .__va_panel button { margin-top: 8px; background: #29ADC4; color: #06222b; border: none; border-radius: 6px; padding: 6px 10px; font-weight: 600; cursor: pointer; font-size: 12px; }
    .__va_panel button.__va_secondary { background: transparent; color: #9fb3b8; margin-left: 6px; }
  `;
  doc.head.appendChild(style);
}

export function getOverlay(doc = document) {
  ensureOverlayStyles(doc);
  let el = doc.getElementById(OVERLAY_ID);
  if (!el) {
    el = doc.createElement('div');
    el.id = OVERLAY_ID;
    el.setAttribute('data-va-ui', '1');
    doc.body.appendChild(el);
  }
  return el;
}

export function getOverlayTag(doc = document) {
  ensureOverlayStyles(doc);
  let el = doc.getElementById('__va_overlay_tag');
  if (!el) {
    el = doc.createElement('div');
    el.id = '__va_overlay_tag';
    el.setAttribute('data-va-ui', '1');
    doc.body.appendChild(el);
  }
  return el;
}

function tagLabel(el) {
  if (!el || !el.tagName) return '';
  let t = el.tagName.toLowerCase();
  if (el.id) t += '#' + el.id;
  const cls =
    typeof el.className === 'string'
      ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2)
      : [];
  if (cls.length) t += '.' + cls.join('.');
  return t;
}

/** Position the overlay box on `el`. Pass null to hide. */
export function showOverlay(el, doc = document) {
  const box = getOverlay(doc);
  const tag = getOverlayTag(doc);
  if (!el) {
    box.style.display = 'none';
    tag.style.display = 'none';
    return;
  }
  const r = visibleRect(el);
  if (!isVisuallyMeaningful(r)) {
    box.style.display = 'none';
    tag.style.display = 'none';
    return;
  }
  box.style.display = 'block';
  box.setAttribute('data-mode', 'pick');
  box.style.left = `${Math.round(r.left)}px`;
  box.style.top = `${Math.round(r.top)}px`;
  box.style.width = `${Math.round(r.width)}px`;
  box.style.height = `${Math.round(r.height)}px`;

  const label = tagLabel(el);
  tag.textContent = label;
  tag.style.display = 'block';
  const tagTop = Math.max(4, r.top - 22);
  tag.style.left = `${Math.max(4, Math.round(r.left))}px`;
  tag.style.top = `${Math.round(tagTop)}px`;
}

export function hideOverlay(doc = document) {
  const box = doc.getElementById(OVERLAY_ID);
  if (box) box.style.display = 'none';
  const tag = doc.getElementById('__va_overlay_tag');
  if (tag) tag.style.display = 'none';
}
