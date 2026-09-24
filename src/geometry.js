// Pure geometry / color helpers — unit-testable without a full DOM.

export function clamp01(n) {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export function linearToSrgb(c) {
  c = clamp01(c);
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function oklabToSrgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [linearToSrgb(r), linearToSrgb(g), linearToSrgb(bl)];
}

export function parseColorChannels(str) {
  return str
    .replace(/\//g, ' ')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((p) => parseFloat(p));
}

/** Convert modern CSS color functions (oklab/oklch/color()) to rgb()/rgba(). */
export function cssColorToRgba(value) {
  if (!value || typeof value !== 'string') return null;
  const v = value.trim();

  let m = v.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    return `rgba(${m[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .join(', ')})`;
  }

  m = v.match(
    /^color\(\s*srgb\s+([\d.eE+-]+)[\s,]+([\d.eE+-]+)[\s,]+([\d.eE+-]+)(?:\s*\/\s*([\d.eE+-]+%?))?\s*\)$/i
  );
  if (m) {
    let a = m[4] != null ? parseFloat(m[4]) : 1;
    if (m[4] && m[4].endsWith('%')) a = a / 100;
    const R = Math.round(clamp01(m[1] > 1 ? m[1] / 255 : parseFloat(m[1])) * 255);
    const G = Math.round(clamp01(m[2] > 1 ? m[2] / 255 : parseFloat(m[2])) * 255);
    const B = Math.round(clamp01(m[3] > 1 ? m[3] / 255 : parseFloat(m[3])) * 255);
    return a >= 1
      ? `rgb(${R}, ${G}, ${B})`
      : `rgba(${R}, ${G}, ${B}, ${Math.round(a * 1000) / 1000})`;
  }

  m = v.match(/^oklab\(([^)]+)\)$/i);
  if (m) {
    const ch = parseColorChannels(m[1]);
    if (ch.length >= 3) {
      const alpha = ch.length >= 4 ? ch[3] : 1;
      const [r, g, b] = oklabToSrgb(ch[0], ch[1], ch[2]);
      const R = Math.round(r * 255);
      const G = Math.round(g * 255);
      const B = Math.round(b * 255);
      return alpha >= 1
        ? `rgb(${R}, ${G}, ${B})`
        : `rgba(${R}, ${G}, ${B}, ${Math.round(alpha * 1000) / 1000})`;
    }
  }

  m = v.match(/^oklch\(([^)]+)\)$/i);
  if (m) {
    const ch = parseColorChannels(m[1]);
    if (ch.length >= 3) {
      const alpha = ch.length >= 4 ? ch[3] : 1;
      const h = (ch[2] * Math.PI) / 180;
      const a = ch[1] * Math.cos(h);
      const b = ch[1] * Math.sin(h);
      const [r, g, bl] = oklabToSrgb(ch[0], a, b);
      const R = Math.round(r * 255);
      const G = Math.round(g * 255);
      const B = Math.round(bl * 255);
      return alpha >= 1
        ? `rgb(${R}, ${G}, ${B})`
        : `rgba(${R}, ${G}, ${B}, ${Math.round(alpha * 1000) / 1000})`;
    }
  }

  return null;
}

/**
 * Clip a viewport rect to overflow ancestors + the viewport itself.
 * `overflowSides(el)` → {x,y} booleans; `getRect(el)` → {left,top,width,height}.
 * `stopAt` is an optional ancestor to stop before (e.g. document.body).
 */
export function clipRectToParents(rect, el, viewport, getOverflow, getRect, stopAt = null) {
  let left = rect.left;
  let top = rect.top;
  let right = rect.left + rect.width;
  let bottom = rect.top + rect.height;
  let node = el && el.parentElement;
  while (node && node !== stopAt) {
    const sides = getOverflow(node);
    if (sides.x || sides.y) {
      const pr = getRect(node);
      if (sides.x) {
        left = Math.max(left, pr.left);
        right = Math.min(right, pr.left + pr.width);
      }
      if (sides.y) {
        top = Math.max(top, pr.top);
        bottom = Math.min(bottom, pr.top + pr.height);
      }
    }
    node = node.parentElement;
  }
  left = Math.max(left, viewport.left);
  top = Math.max(top, viewport.top);
  right = Math.min(right, viewport.right);
  bottom = Math.min(bottom, viewport.bottom);
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

/** Sample a canvas grid; returns blankness stats for retry decisions. */
export function analyzeCanvasImageData(data, width, height, step = 8) {
  let n = 0;
  let white = 0;
  let black = 0;
  let sum = 0;
  let sumSq = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a < 8) continue;
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      n += 1;
      sum += luma;
      sumSq += luma * luma;
      if (r > 250 && g > 250 && b > 250) white += 1;
      if (r < 5 && g < 5 && b < 5) black += 1;
    }
  }
  if (n === 0) return { samples: 0, whitePct: 100, blackPct: 0, variance: 0, blank: true };
  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  const whitePct = (100 * white) / n;
  const blackPct = (100 * black) / n;
  const blank = variance < 12 && (whitePct > 97 || blackPct > 97);
  return { samples: n, whitePct, blackPct, variance, mean, blank };
}

export function isLikelyBlankCanvas(canvas, step = 8) {
  try {
    const w = canvas.width;
    const h = canvas.height;
    if (!w || !h) return true;
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, w, h);
    return analyzeCanvasImageData(img.data, w, h, step).blank;
  } catch {
    return false;
  }
}
