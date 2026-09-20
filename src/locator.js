// Best-effort "where does this element actually live in the source code" resolver.
//
// - React (dev build): reads the fiber's _debugSource, which Babel/SWC's dev JSX
//   transform attaches automatically — gives exact file + line + component name.
// - Vue 3 (dev build): reads the component definition's __file, which the SFC
//   compiler attaches in development — gives file + component name.
// - Anything else (plain HTML, Svelte, Angular, or React/Vue in a build that
//   stripped dev info): falls back to a CSS selector path + visible text, which
//   is still enough for a human (or an AI) to find the right place by searching.
//
// This is intentionally "best effort, not magic" — see the README for details
// on why a single universal exact-location mechanism isn't realistic across
// arbitrary stacks.

function cssPath(el) {
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

function reactSource(el) {
  const key = findReactFiberKey(el);
  if (!key) return null;
  let fiber = el[key];
  for (let i = 0; fiber && i < 12; i++) {
    const src = fiber._debugSource;
    if (src) {
      const name = (fiber.type && (fiber.type.displayName || fiber.type.name)) || null;
      return {
        framework: 'react',
        file: src.fileName,
        line: src.lineNumber,
        column: src.columnNumber,
        component: name,
      };
    }
    fiber = fiber.return;
  }
  return null;
}

function vueSource(el) {
  const key = Object.keys(el).find(
    (k) => k.startsWith('__vueParentComponent') || k === '__vnode'
  );
  if (!key) return null;
  try {
    const inst = el[key];
    const type = inst?.type || inst?.ctx?.type;
    if (type && type.__file) {
      return {
        framework: 'vue',
        file: type.__file,
        component: type.__name || type.name || null,
      };
    }
  } catch {
    // fall through to generic path
  }
  return null;
}

export function locate(el) {
  const react = reactSource(el);
  const vue = !react ? vueSource(el) : null;
  const base = react || vue || { framework: 'unknown', file: null, component: null };
  return {
    ...base,
    selector: cssPath(el),
    text: (el.textContent || '').trim().slice(0, 60),
  };
}
