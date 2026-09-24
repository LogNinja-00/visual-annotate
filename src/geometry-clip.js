// DOM-dependent clip helper kept separate so geometry.js stays pure for unit tests.

export function clipRingRect(rect, el) {
  let left = rect.left;
  let top = rect.top;
  let right = rect.left + rect.width;
  let bottom = rect.top + rect.height;
  let node = el && el.parentElement;
  while (node && node !== document.body && node !== document.documentElement) {
    let cs;
    try {
      cs = getComputedStyle(node);
    } catch {
      break;
    }
    const ox = cs.overflowX || cs.overflow;
    const oy = cs.overflowY || cs.overflow;
    const clipsX = ox === 'hidden' || ox === 'clip' || ox === 'auto' || ox === 'scroll';
    const clipsY = oy === 'hidden' || oy === 'clip' || oy === 'auto' || oy === 'scroll';
    if (clipsX || clipsY) {
      const pr = node.getBoundingClientRect();
      if (clipsX) {
        left = Math.max(left, pr.left);
        right = Math.min(right, pr.right);
      }
      if (clipsY) {
        top = Math.max(top, pr.top);
        bottom = Math.min(bottom, pr.bottom);
      }
    }
    node = node.parentElement;
  }
  left = Math.max(left, 0);
  top = Math.max(top, 0);
  right = Math.min(right, window.innerWidth);
  bottom = Math.min(bottom, window.innerHeight);
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}
