// Screenshot capture for a single element.
//
// One narrow entry point — captureElement(el) -> dataURL | null — hides a lot:
// lazy-loading html2canvas, waiting for app-specific render phases to settle,
// working around html2canvas' lack of oklab() support, locking the viewport so
// the shot is frame-sized rather than full-page, and drawing the red highlight
// ellipse. Callers only ever need the resulting image.

let html2canvasReady = null;

function ensureHtml2canvas() {
  if (window.html2canvas) return Promise.resolve();
  if (html2canvasReady) return html2canvasReady;
  html2canvasReady = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/html2canvas.min.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load html2canvas'));
    document.head.appendChild(script);
  });
  return html2canvasReady;
}

// Host apps can render content over several animation phases; wait for any
// element that advertises a `data-phase` to report its phase as done before we
// shoot. Generalizes what used to be a hardcoded `.mint-gen` selector so the
// tool isn't tied to one host app's class name.
function waitForRenderPhasesSettled() {
  return new Promise((resolve) => {
    const phasedEls = document.querySelectorAll('[data-phase]');
    if (phasedEls.length === 0) return resolve();

    const allDone = () =>
      Array.from(phasedEls).every((el) => el.getAttribute('data-phase') === 'done');
    if (allDone()) return resolve();

    const observers = [];
    let resolved = false;

    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      observers.forEach((o) => o.disconnect());
    };

    phasedEls.forEach((el) => {
      if (el.getAttribute('data-phase') === 'done') return;
      const obs = new MutationObserver(() => {
        if (allDone()) {
          cleanup();
          resolve();
        }
      });
      obs.observe(el, { attributes: true, attributeFilter: ['data-phase'] });
      observers.push(obs);
    });

    if (allDone()) {
      cleanup();
      resolve();
      return;
    }

    setTimeout(() => {
      cleanup();
      resolve();
    }, 4000);
  });
}

const OKLAB_RE = /oklab\([^)]+\)/g;
const COLOR_PROPS = [
  'color', 'background-color', 'border-color',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'outline-color', 'text-decoration-color', 'column-rule-color',
  'fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color',
];

function convertOklabValue(str) {
  if (!str || !OKLAB_RE.test(str)) return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d');
  return str.replace(OKLAB_RE, (match) => {
    try {
      ctx.fillStyle = '#000';
      ctx.fillStyle = match;
      return ctx.fillStyle;
    } catch {
      return match;
    }
  });
}

// html2canvas can't parse oklab() colors, so temporarily rewrite them to an
// equivalent sRGB value and put the originals back afterwards.
function sanitizeOklabColors() {
  const all = document.querySelectorAll('*');
  const saved = [];
  all.forEach((el) => {
    const cs = getComputedStyle(el);
    const entry = { el, props: {} };
    let changed = false;
    COLOR_PROPS.forEach((prop) => {
      const val = cs.getPropertyValue(prop);
      if (val && OKLAB_RE.test(val)) {
        const converted = convertOklabValue(val);
        if (converted && converted !== val) {
          entry.props[prop] = el.style.getPropertyValue(prop);
          el.style.setProperty(prop, converted);
          changed = true;
        }
      }
    });
    if (changed) saved.push(entry);
  });
  return saved;
}

function restoreOklabColors(saved) {
  saved.forEach((entry) => {
    Object.keys(entry.props).forEach((prop) => {
      const orig = entry.props[prop];
      if (orig) entry.el.style.setProperty(prop, orig);
      else entry.el.style.removeProperty(prop);
    });
  });
}

// Pin the document to the current viewport for the duration of the shot, and
// hand back everything needed to put it back exactly as it was.
function lockViewport(vpW, vpH) {
  const saved = {
    bh: document.body.style.height,
    bo: document.body.style.overflow,
    bw: document.body.style.width,
    oh: document.documentElement.style.height,
    oo: document.documentElement.style.overflow,
  };
  document.body.style.height = vpH + 'px';
  document.body.style.width = vpW + 'px';
  document.body.style.overflow = 'hidden';
  document.documentElement.style.height = vpH + 'px';
  document.documentElement.style.overflow = 'hidden';
  return saved;
}

function releaseViewport(saved) {
  document.body.style.height = saved.bh;
  document.body.style.overflow = saved.bo;
  document.body.style.width = saved.bw;
  document.documentElement.style.height = saved.oh;
  document.documentElement.style.overflow = saved.oo;
}

function drawHighlight(canvas, rect) {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const rx = rect.width / 2 + 14;
  const ry = rect.height / 2 + 14;

  const ctx = canvas.getContext('2d');
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.strokeStyle = '#ff0000';
  ctx.lineWidth = 4;
  ctx.stroke();
}

export async function captureElement(el) {
  try {
    await ensureHtml2canvas();

    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    const viewport = lockViewport(vpW, vpH);

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      releaseViewport(viewport);
      return null;
    }

    let canvas;
    let oklabSaved = null;
    try {
      await waitForRenderPhasesSettled();
      oklabSaved = sanitizeOklabColors();

      canvas = await window.html2canvas(document.body, {
        x: 0,
        y: 0,
        width: vpW,
        height: vpH,
        windowWidth: vpW,
        windowHeight: vpH,
        useCORS: true,
        allowTaint: true,
        // Downscaled so captures stay well inside the screenshot budget: a
        // full-resolution PNG of a large viewport can run to several MB, and
        // anything over the budget is skipped entirely.
        scale: 0.5,
        logging: false,
        ignoreElements: (node) => {
          if (!node.classList) return false;
          for (const cls of node.classList) {
            if (cls.startsWith('__va_')) return true;
          }
          return false;
        },
      });
    } finally {
      if (oklabSaved) restoreOklabColors(oklabSaved);
      releaseViewport(viewport);
    }

    drawHighlight(canvas, rect);
    return canvas.toDataURL('image/png');
  } catch (err) {
    console.error('[VA] Screenshot failed:', err.message || err);
    return null;
  }
}
