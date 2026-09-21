// Best-effort "where does this element actually live in the source code" resolver.
//
// - React (dev build): reads the fiber's _debugSource (or the component's
//   _source), which the dev JSX transform attaches — exact file + line +
//   component name. Note that React 18 with the modern JSX transform only emits
//   this when @babel/plugin-transform-react-jsx-source (or the SWC equivalent) is
//   enabled; without it React silently degrades to the CSS-selector fallback.
// - Vue 3 (dev build): reads the component definition's __file, which the SFC
//   compiler attaches in development — gives file + component name. Climbs the
//   parent chain to the nearest component that actually has one.
// - Anything else (plain HTML, Svelte, Angular, or React/Vue in a build that
//   stripped dev info): falls back to a CSS selector path + visible text +
//   element markup, which is still enough for a human (or an agent) to find the
//   right place by searching.
//
// This is intentionally "best effort, not magic" — see the README for details
// on why a single universal exact-location mechanism isn't realistic across
// arbitrary stacks.

const MAX_OUTER_HTML = 2000;
const MAX_CLIMB = 12;

export function cssPath(el) {
  const parts = [];
  let node = el;
  while (node && node.nodeType === 1 && parts.length < 6) {
    let part = node.tagName.toLowerCase();
    if (node.id) {
      part += `#${node.id}`;
      parts.unshift(part);
      break; // an id is unique enough, stop climbing
    }
    if (node.className && typeof node.className === 'string') {
      const cls = node.className.trim().split(/\s+/).slice(0, 2).join('.');
      if (cls) part += `.${cls}`;
    }
    const siblings = node.parentElement
      ? Array.from(node.parentElement.children).filter((c) => c.tagName === node.tagName)
      : [];
    if (siblings.length > 1) {
      part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    node = node.parentElement;
  }
  return parts.join(' > ');
}

function findReactFiberKey(el) {
  return Object.keys(el).find(
    (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
  );
}

function componentName(type) {
  if (!type) return null;
  return type.displayName || type.name || null;
}

export function reactSource(el) {
  const key = findReactFiberKey(el);
  if (!key) return null;

  let fiber = el[key];
  for (let i = 0; fiber && i < MAX_CLIMB; i++) {
    const src = fiber._debugSource || (fiber.type && fiber.type._source);
    if (src && src.fileName) {
      return {
        framework: 'react',
        file: src.fileName,
        line: typeof src.lineNumber === 'number' ? src.lineNumber : null,
        column: typeof src.columnNumber === 'number' ? src.columnNumber : null,
        component: componentName(fiber.type),
      };
    }
    fiber = fiber.return;
  }
  return null;
}

function vueInstance(el) {
  const key = Object.keys(el).find(
    (k) => k.startsWith('__vueParentComponent') || k === '__vnode'
  );
  if (!key) return null;
  const value = el[key];
  // The property can hold a vnode (which points at its component) or the
  // component instance itself.
  return value && value.component ? value.component : value;
}

export function vueSource(el) {
  let instance = vueInstance(el);
  for (let i = 0; instance && i < MAX_CLIMB; i++) {
    try {
      const type = instance.type || (instance.ctx && instance.ctx.type);
      if (type && type.__file) {
        return {
          framework: 'vue',
          file: type.__file,
          line: null,
          column: null,
          component: type.__name || type.name || null,
        };
      }
    } catch {
      // fall through and keep climbing
    }
    instance = instance.parent;
  }
  return null;
}

function elementMarkup(el) {
  try {
    const html = el.outerHTML;
    return typeof html === 'string' ? html.slice(0, MAX_OUTER_HTML) : null;
  } catch {
    return null;
  }
}

export function locate(el) {
  const react = reactSource(el);
  const vue = react ? null : vueSource(el);
  const base = react || vue || { framework: 'unknown', file: null, line: null, column: null, component: null };
  return {
    ...base,
    selector: cssPath(el),
    text: (el.textContent || '').trim().slice(0, 60),
    outerHTML: elementMarkup(el),
  };
}
