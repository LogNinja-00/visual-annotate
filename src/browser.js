import { createConsoleCapture } from './console-capture.js';
import { locate } from './locator.js';

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

function waitForMintGenSettled() {
  return new Promise((resolve) => {
    // Only wait for mints that are actually animating (started but not done).
    // Idle mints below the fold never start — waiting for them burns the full timeout.
    const isAnimating = (el) => {
      const phase = el.getAttribute('data-phase');
      return phase !== null && phase !== 'done' && phase !== 'idle';
    };
    const mintEls = Array.from(document.querySelectorAll('.mint-gen')).filter(isAnimating);
    if (mintEls.length === 0) return resolve();

    const allDone = () => mintEls.every((el) => el.getAttribute('data-phase') === 'done');
    if (allDone()) return resolve();

    const observers = [];
    let resolved = false;

    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      observers.forEach((o) => o.disconnect());
    };

    mintEls.forEach((el) => {
      if (el.getAttribute('data-phase') === 'done') return;
      const obs = new MutationObserver(() => {
        if (allDone()) { cleanup(); resolve(); }
      });
      obs.observe(el, { attributes: true, attributeFilter: ['data-phase'] });
      observers.push(obs);
    });

    if (allDone()) { cleanup(); resolve(); return; }

    setTimeout(() => { cleanup(); resolve(); }, 6000);
  });
}

const TEXT_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, a, button, span, li, label, strong, em, blockquote, figcaption, .mint-gen-body, [class*="scramble"]';

function isTextLeaf(n) {
  if (!n || n.children.length > 0) return false;
  if (n.closest && n.closest('[class*="__va_"]')) return false;
  // Exclude mint generate overlays — their intent/code text is not real content
  // and restoring it shifted layout + drew the ring around fake labels.
  if (n.closest && n.closest('.mint-gen-code, .mint-gen-pixel, .mint-gen-intent, .mint-gen-stream')) return false;
  const t = n.textContent;
  return !!(t && t.trim());
}

function textLeafNodes(root = document) {
  return Array.from(root.querySelectorAll(TEXT_SELECTOR)).filter(isTextLeaf);
}

function clipRingRect(rect, el) {
  // Match what the user sees: ignore transforms that overflow clipping ancestors
  // and never draw outside the viewport.
  let left = rect.left;
  let top = rect.top;
  let right = rect.left + rect.width;
  let bottom = rect.top + rect.height;
  let node = el && el.parentElement;
  while (node && node !== document.body && node !== document.documentElement) {
    let cs;
    try { cs = getComputedStyle(node); } catch { break; }
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

function samplePageText() {
  const nodes = textLeafNodes();
  let text = '';
  for (let i = 0; i < nodes.length; i++) text += nodes[i].textContent + '|';
  return text;
}

function waitForStableText(timeoutMs = 6000, stableMs = 1400) {
  return new Promise((resolve) => {
    let last = samplePageText();
    let lastChange = Date.now();
    const start = Date.now();
    const iv = setInterval(() => {
      const now = Date.now();
      const cur = samplePageText();
      if (cur !== last) {
        last = cur;
        lastChange = now;
      } else if (now - lastChange >= stableMs && now - start >= 500) {
        clearInterval(iv);
        console.log('[VA] text stable after', now - start, 'ms');
        resolve();
      } else if (now - start >= timeoutMs) {
        clearInterval(iv);
        console.log('[VA] text stable timeout', timeoutMs, 'ms');
        resolve();
      }
    }, 50);
  });
}

function clamp01(n) {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function linearToSrgb(c) {
  c = clamp01(c);
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function oklabToSrgb(L, a, b) {
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

function parseColorChannels(str) {
  return str
    .replace(/\//g, ' ')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((p) => parseFloat(p));
}

function cssColorToRgba(value) {
  if (!value || typeof value !== 'string') return null;
  const v = value.trim();

  let m = v.match(/^color\(\s*srgb\s+([\d.eE+-]+)[\s,]+([\d.eE+-]+)[\s,]+([\d.eE+-]+)(?:\s*\/\s*([\d.eE+-]+%?))?\s*\)$/i);
  if (m) {
    const r = linearToSrgb(parseFloat(m[1]) / (parseFloat(m[1]) > 1 ? 255 : 1));
    const g = linearToSrgb(parseFloat(m[2]) / (parseFloat(m[2]) > 1 ? 255 : 1));
    const b = linearToSrgb(parseFloat(m[3]) / (parseFloat(m[3]) > 1 ? 255 : 1));
    let a = m[4] != null ? parseFloat(m[4]) : 1;
    if (m[4] && m[4].endsWith('%')) a = a / 100;
    const R = Math.round(clamp01(m[1] > 1 ? m[1] / 255 : parseFloat(m[1])) * 255);
    const G = Math.round(clamp01(m[2] > 1 ? m[2] / 255 : parseFloat(m[2])) * 255);
    const B = Math.round(clamp01(m[3] > 1 ? m[3] / 255 : parseFloat(m[3])) * 255);
    void r; void g; void b;
    return a >= 1 ? `rgb(${R}, ${G}, ${B})` : `rgba(${R}, ${G}, ${B}, ${Math.round(a * 1000) / 1000})`;
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
      return alpha >= 1 ? `rgb(${R}, ${G}, ${B})` : `rgba(${R}, ${G}, ${B}, ${Math.round(alpha * 1000) / 1000})`;
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
      return alpha >= 1 ? `rgb(${R}, ${G}, ${B})` : `rgba(${R}, ${G}, ${B}, ${Math.round(alpha * 1000) / 1000})`;
    }
  }

  return null;
}

function normalizeCloneColors(clonedDoc) {
  const win = clonedDoc.defaultView;
  if (!win) return;

  const colorProps = [
    'color',
    'backgroundColor',
    'borderTopColor',
    'borderRightColor',
    'borderBottomColor',
    'borderLeftColor',
    'outlineColor',
    'textDecorationColor',
    'fill',
    'stroke',
  ];

  const els = clonedDoc.querySelectorAll('*');
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    let cs;
    try {
      cs = win.getComputedStyle(el);
    } catch {
      continue;
    }
    for (const prop of colorProps) {
      let raw;
      try {
        raw = cs[prop];
      } catch {
        continue;
      }
      if (!raw || !/oklab|oklch|color\(/i.test(raw)) continue;
      const rgba = cssColorToRgba(raw);
      if (rgba) {
        try {
          el.style.setProperty(prop, rgba, 'important');
        } catch {}
      }
    }
  }
}

function drawRingInClone() {
  // Ring is drawn on the output canvas after capture — position:fixed inside the
  // html2canvas iframe landed ~32px off (constant Y error across scroll states).
}

function stabilizeCloneContent(clonedDoc) {
  // Neutralize mint generate overlays WITHOUT removing them — removing a child
  // can turn its parent into a new text leaf (count drift) and shift layout.
  clonedDoc.querySelectorAll('.mint-gen-code, .mint-gen-pixel, .mint-gen-intent, .mint-gen-stream').forEach((node) => {
    node.textContent = '';
    while (node.firstChild) node.removeChild(node.firstChild);
    node.style.setProperty('display', 'none', 'important');
    node.style.setProperty('visibility', 'hidden', 'important');
  });
  clonedDoc.querySelectorAll('.mint-gen').forEach((node) => {
    node.setAttribute('data-phase', 'done');
    node.classList.add('is-done');
    node.classList.remove('is-playing');
  });

  const style = clonedDoc.createElement('style');
  style.setAttribute('data-va-stabilize', '1');
  style.textContent =
    '*, *::before, *::after { caret-color: transparent !important; }' +
    '.mint-gen-code, .mint-gen-pixel, .mint-gen-intent, .mint-gen-stream { display: none !important; visibility: hidden !important; }' +
    '.mint-gen > .mint-gen-body { opacity: 1 !important; visibility: visible !important; }';
  clonedDoc.head.appendChild(style);

  try {
    normalizeCloneColors(clonedDoc);
  } catch {}
}

function freezeCloneAnimations(clonedDoc) {
  const win = clonedDoc.defaultView;
  const style = clonedDoc.createElement('style');
  style.setAttribute('data-va-freeze', '1');
  style.textContent =
    '*, *::before, *::after { animation-play-state: paused !important; transition: none !important; }';
  clonedDoc.head.appendChild(style);
  if (win) {
    try {
      win.getAnimations().forEach((anim) => {
        try { anim.pause(); } catch {}
      });
    } catch {}
  }
}

function captureVideoFrameDataUrl(video) {
  try {
    if (!video) return null;
    if (video.videoWidth && video.videoHeight && video.readyState >= 2) {
      const c = document.createElement('canvas');
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      const dataUrl = c.toDataURL('image/jpeg', 0.9);
      if (dataUrl && dataUrl !== 'data:,') return dataUrl;
    }
    // No decodable frame (codec/autoplay failure) — bake the poster into a canvas
    // so the clone still shows a real image instead of a black hole.
    const poster = video.getAttribute('poster');
    if (poster && !poster.startsWith('data:')) {
      // sync best-effort via cached live <img> if any; async path is handled by caller
      return null;
    }
    if (poster && poster.startsWith('data:')) return poster;
    return null;
  } catch {
    return null;
  }
}

function absoluteUrl(url) {
  if (!url) return url;
  if (url.startsWith('data:') || url.startsWith('blob:') || /^https?:/i.test(url)) return url;
  try {
    return new URL(url, document.baseURI).href;
  } catch {
    return url;
  }
}

function fetchImageAsDataUrl(src) {
  return new Promise((resolve) => {
    if (!src || src.startsWith('data:')) {
      resolve(src || null);
      return;
    }
    const abs = absoluteUrl(src);
    const live = Array.from(document.images).find(
      (li) => li.currentSrc === src || li.src === src || li.getAttribute('src') === src ||
        li.currentSrc === abs || li.src === abs
    );
    const fromImg = (img) => {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        const dataUrl = c.toDataURL('image/jpeg', 0.88);
        resolve(dataUrl && dataUrl !== 'data:,' ? dataUrl : null);
      } catch {
        resolve(null);
      }
    };
    if (live && live.complete && live.naturalWidth) {
      fromImg(live);
      return;
    }
    const tmp = new Image();
    tmp.crossOrigin = 'anonymous';
    tmp.onload = () => fromImg(tmp);
    tmp.onerror = () => resolve(null);
    tmp.src = abs;
    setTimeout(() => resolve(null), 3000);
  });
}

function stabilizeCloneMedia(clonedDoc) {
  try {
    // html2canvas replaces <video> with <canvas> during clone (createVideoClone),
    // and drawImage(video) is black without a decodable codec. Document order of
    // live canvas+video matches clone canvas order (video→canvas in place).
    const liveMedia = Array.from(document.querySelectorAll('canvas, video'));
    const cloneCanvases = Array.from(clonedDoc.querySelectorAll('canvas'));
    const jobs = [];

    liveMedia.forEach((src, i) => {
      const dest = cloneCanvases[i];
      if (!dest) return;

      if (src.tagName === 'VIDEO') {
        const poster = src.getAttribute('poster');
        const paint = async () => {
          let url = null;
          const frame = captureVideoFrameDataUrl(src);
          if (frame) url = frame;
          if (!url && poster) url = await fetchImageAsDataUrl(poster);
          if (!url && poster) url = absoluteUrl(poster);
          if (!url) {
            console.warn('[VA] no poster for video clone canvas', i);
            return;
          }
          const img = clonedDoc.createElement('img');
          img.setAttribute('data-va-video', '1');
          img.alt = '';
          img.src = url;
          img.className = src.className;
          img.style.cssText = dest.style.cssText || '';
          img.style.width = dest.width ? dest.width + 'px' : '100%';
          img.style.height = dest.height ? dest.height + 'px' : '100%';
          img.style.objectFit = 'cover';
          img.style.display = 'block';
          if (dest.parentNode) dest.parentNode.replaceChild(img, dest);
          console.log('[VA] video→img', url.startsWith('data:') ? 'data' : 'url', url.length);
        };
        jobs.push(paint());
        return;
      }

      // Live canvas (e.g. PixelScene) — copy pixels across
      if (!src.width || !src.height) return;
      let dataUrl;
      try {
        dataUrl = src.toDataURL('image/png');
      } catch {
        return;
      }
      if (!dataUrl || dataUrl === 'data:,') return;
      try {
        const ctx = dest.getContext('2d');
        if (ctx) {
          const image = new Image();
          image.src = dataUrl;
          jobs.push(
            new Promise((res) => {
              const done = () => res();
              image.onload = () => {
                try {
                  dest.width = src.width;
                  dest.height = src.height;
                  ctx.drawImage(image, 0, 0);
                } catch {}
                done();
              };
              image.onerror = done;
              setTimeout(done, 2000);
            })
          );
        }
      } catch {}
    });

    clonedDoc.querySelectorAll('img').forEach((img) => {
      if (img.getAttribute('data-va-video') === '1' && img.src.startsWith('data:')) return;
      const s = img.getAttribute('src');
      if (!s || s.startsWith('data:')) return;
      const abs = absoluteUrl(s);
      jobs.push(
        fetchImageAsDataUrl(s).then((dataUrl) => {
          if (dataUrl) img.src = dataUrl;
          else img.src = abs;
        })
      );
    });

    return Promise.all(jobs);
  } catch {
    return Promise.resolve();
  }
}

function waitForCloneImages(clonedDoc, timeoutMs = 3000) {
  const imgs = Array.from(clonedDoc.querySelectorAll('img'));
  if (!imgs.length) return Promise.resolve();
  return Promise.race([
    Promise.all(
      imgs.map((img) => {
        if (img.complete && img.naturalWidth) return Promise.resolve();
        return new Promise((res) => {
          const done = () => res();
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
          setTimeout(done, timeoutMs);
        });
      })
    ),
    new Promise((res) => setTimeout(res, timeoutMs)),
  ]);
}

async function captureScreenshot(el) {
  try {
    await ensureHtml2canvas();
    await waitForMintGenSettled();

    await waitForStableText();
    const textBeforeCapture = samplePageText();
    await new Promise((r) => setTimeout(r, 80));
    if (samplePageText() !== textBeforeCapture) {
      await waitForStableText(3000, 600);
    }
    if (document.fonts && document.fonts.ready) {
      try { await document.fonts.ready; } catch {}
    }
    if (document.fonts && document.fonts.load) {
      try {
        await Promise.all([
          document.fonts.load('700 60px Changa'),
          document.fonts.load('400 16px Cairo'),
          document.fonts.load('400 16px "IBM Plex Sans Arabic"'),
          document.fonts.load('700 60px "Changa"'),
        ]);
        await document.fonts.ready;
      } catch {}
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;

    // Tag live text leaves so the clone restores by index even if leaf counts drift.
    const liveTextNodes = textLeafNodes();
    const textKeys = liveTextNodes.map((n) => n.textContent);
    liveTextNodes.forEach((n, i) => n.setAttribute('data-va-ti', String(i)));

    const hadHighlight = el.classList.contains('__va_highlight');
    el.classList.remove('__va_highlight');
    el.setAttribute('data-va-target', '1');
    // Viewport CSS px at measure time — drawn onto the canvas after capture.
    const ringRect = clipRingRect(
      { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      el
    );
    let canvas;
    try {
      canvas = await window.html2canvas(document.body, {
        // Crop from document origin; scroll is applied by shifting body in onclone
        // (x/y = scroll offsets produced a blank foreignObject shot).
        x: 0,
        y: 0,
        width: vpW,
        height: vpH,
        windowWidth: vpW,
        windowHeight: vpH,
        scrollX: scrollX,
        scrollY: scrollY,
        useCORS: true,
        allowTaint: true,
        foreignObjectRendering: true,
        scale: 2,
        logging: false,
        backgroundColor: '#ffffff',
        ignoreElements: (node) => {
          if (!node.classList) return false;
          if (node.hasAttribute && node.hasAttribute('data-va-target')) return false;
          if (node.hasAttribute && node.hasAttribute('data-va-ring')) return false;
          for (const cls of node.classList) {
            if (cls.startsWith('__va_')) return true;
          }
          return false;
        },
        onclone: async (clonedDoc) => {
          try { stabilizeCloneContent(clonedDoc); } catch (e) { console.error('[VA] stabilize failed', e); }
          // foreignObject SVG renders body from y=0 — shift it so the current
          // viewport region is what gets captured (x/y crop options alone blanked
          // the shot when scrolled).
          try {
            if (scrollX > 0 || scrollY > 0) {
              const b = clonedDoc.body;
              if (b) {
                b.style.setProperty('transform', `translate(${-scrollX}px, ${-scrollY}px)`, 'important');
                b.style.setProperty('transform-origin', '0 0', 'important');
              }
            }
          } catch {}
          try {
            let restored = 0;
            clonedDoc.querySelectorAll('[data-va-ti]').forEach((n) => {
              const i = Number(n.getAttribute('data-va-ti'));
              if (Number.isInteger(i) && typeof textKeys[i] === 'string') {
                n.textContent = textKeys[i];
                restored += 1;
              }
              n.removeAttribute('data-va-ti');
            });
            if (restored !== textKeys.length) {
              console.warn('[VA] text restore', restored, 'vs', textKeys.length);
            } else {
              console.log('[VA] text restored', restored);
            }
          } catch {}
          try { await stabilizeCloneMedia(clonedDoc); } catch {}
          try { await waitForCloneImages(clonedDoc, 4000); } catch {}
          try {
            if (clonedDoc.fonts && clonedDoc.fonts.ready) {
              await clonedDoc.fonts.ready;
            }
            if (clonedDoc.fonts && clonedDoc.fonts.load) {
              await Promise.all([
                clonedDoc.fonts.load('700 60px Changa'),
                clonedDoc.fonts.load('400 16px Cairo'),
                clonedDoc.fonts.load('600 16px Cairo'),
                clonedDoc.fonts.load('700 16px Cairo'),
                clonedDoc.fonts.load('400 16px "IBM Plex Sans Arabic"'),
                clonedDoc.fonts.load('700 60px Changa'),
                clonedDoc.fonts.load('bold 60px Changa'),
              ]);
              await clonedDoc.fonts.ready;
            }
          } catch {}
          try { freezeCloneAnimations(clonedDoc); } catch {}
        },
      });
    } finally {
      el.removeAttribute('data-va-target');
      if (hadHighlight) el.classList.add('__va_highlight');
      liveTextNodes.forEach((n) => n.removeAttribute('data-va-ti'));
    }

    // Draw the ring on the finished canvas — exact viewport CSS × scale.
    try {
      const ctx = canvas.getContext('2d');
      // html2canvas left scale/translate on this context — reset before drawing
      // or the ring lands far outside the canvas (red pixels: 0).
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const scale = canvas.width / vpW;
      const pad = 10;
      const lw = 3;
      const radius = 12;
      const x = (ringRect.left - pad) * scale;
      const y = (ringRect.top - pad) * scale;
      const w = (ringRect.width + pad * 2) * scale;
      const h = (ringRect.height + pad * 2) * scale;
      ctx.save();
      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = Math.max(2, lw * scale);
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const r = radius * scale;
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
      console.log('[VA] ringRect', JSON.stringify(ringRect));
      console.log('[VA] ring drawn', { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), cw: canvas.width, ch: canvas.height });
    } catch (e) {
      console.error('[VA] ring draw failed', e);
    }

    return canvas.toDataURL('image/jpeg', 0.92);
  } catch (err) {
    console.error('[VA] Screenshot failed:', err.message || err);
    return null;
  }
}

const STYLE_ID = '__va_style__';

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .__va_highlight { outline: 2px solid #29ADC4 !important; outline-offset: 2px; cursor: crosshair !important; }
    .__va_panel, .__va_panel * { cursor: auto !important; }
    .__va_panel { position: fixed; z-index: 2147483647; background: #14181a; color: #fcfafa; font: 13px/1.4 -apple-system, sans-serif; border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,.4); padding: 12px; width: 280px; }
    .__va_panel textarea { width: 100%; min-height: 60px; margin-top: 8px; background: #1e2426; color: #fcfafa; border: 1px solid #33393b; border-radius: 6px; padding: 6px; font: inherit; resize: vertical; box-sizing: border-box; }
    .__va_panel .__va_label { font-size: 11px; color: #9fb3b8; word-break: break-all; }
    .__va_panel button { margin-top: 8px; background: #29ADC4; color: #06222b; border: none; border-radius: 6px; padding: 6px 10px; font-weight: 600; cursor: pointer; font-size: 12px; }
    .__va_panel button.__va_secondary { background: transparent; color: #9fb3b8; margin-left: 6px; }
  `;
  document.head.appendChild(style);
}

export function initAnnotator(userConfig = {}) {
  const config = {
    enabled: true,
    shortcut: { key: 'a', alt: true, shift: true },
    consoleBufferSize: 50,
    serverUrl: 'http://localhost:4545',
    allowedHosts: ['localhost', '127.0.0.1'],
    ...userConfig,
  };

  const hostOk = config.allowedHosts.includes(location.hostname);
  if (!config.enabled || !hostOk) {
    return { destroy() {} };
  }

  injectStyles();
  const consoleCapture = createConsoleCapture(config.consoleBufferSize);
  setTimeout(() => consoleCapture.start(), 1000);

  let active = false;
  let hoverEl = null;
  let currentScreenshot = null;

  function onMouseOver(e) {
    if (!active) return;
    const t = e.target;
    if (t && t.closest && (t.closest('.__va_panel') || t.closest('[class*="__va_"]'))) return;
    if (hoverEl) hoverEl.classList.remove('__va_highlight');
    hoverEl = t;
    if (hoverEl && hoverEl.classList) hoverEl.classList.add('__va_highlight');
  }

  function closePanel() {
    const existing = document.querySelector('.__va_panel');
    if (existing) existing.remove();
    currentScreenshot = null;
  }

  async function openPanel(el, x, y) {
    closePanel();
    const loc = locate(el);
    const label = loc.file
      ? `${loc.component ? loc.component + ' — ' : ''}${loc.file}${loc.line ? ':' + loc.line : ''}`
      : loc.selector;

    currentScreenshot = await captureScreenshot(el);

    const panel = document.createElement('div');
    panel.className = '__va_panel';
    const panelW = 300;
    const panelH = 420;
    const targetRect = el.getBoundingClientRect();
    let px = Math.min(x, window.innerWidth - panelW - 8);
    let py = Math.min(y, window.innerHeight - panelH - 8);
    const overlapsTarget = (left, top) =>
      left < targetRect.right + 8 &&
      left + panelW > targetRect.left - 8 &&
      top < targetRect.bottom + 8 &&
      top + panelH > targetRect.top - 8;
    if (overlapsTarget(px, py)) {
      const options = [
        [targetRect.left - panelW - 12, targetRect.top],
        [targetRect.right + 12, targetRect.top],
        [targetRect.left, targetRect.bottom + 12],
        [targetRect.left, targetRect.top - panelH - 12],
        [window.innerWidth - panelW - 8, 8],
        [8, window.innerHeight - panelH - 8],
      ];
      for (const [ox, oy] of options) {
        const left = Math.max(8, Math.min(ox, window.innerWidth - panelW - 8));
        const top = Math.max(8, Math.min(oy, window.innerHeight - panelH - 8));
        if (!overlapsTarget(left, top)) {
          px = left;
          py = top;
          break;
        }
      }
    }
    panel.style.left = px + 'px';
    panel.style.top = py + 'px';
    panel.innerHTML = `
      <div class="__va_label">${label}</div>
      ${currentScreenshot ? '<div style="margin-top:6px;"><img src="' + currentScreenshot + '" style="width:100%;border-radius:4px;border:1px solid #33393b;" /></div>' : ''}
      <textarea placeholder="What's wrong with this?"></textarea>
      <div>
        <button class="__va_submit_now" style="background:#29ADC4;color:#06222b;border:none;border-radius:6px;padding:8px 14px;font-weight:700;cursor:pointer;font-size:13px;">Submit to GitHub</button>
        <button class="__va_cancel __va_secondary">Cancel</button>
      </div>
    `;
    document.body.appendChild(panel);
    const textarea = panel.querySelector('textarea');
    textarea.focus();

    panel.querySelector('.__va_cancel').onclick = closePanel;
    panel.querySelector('.__va_submit_now').onclick = async () => {
      const text = textarea.value.trim();
      if (!text) return;
      const comment = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text,
        locator: loc,
        consoleLog: consoleCapture.snapshot(),
        url: location.href,
        time: new Date().toISOString(),
        screenshot: currentScreenshot,
      };
      const btn = panel.querySelector('.__va_submit_now');
      btn.disabled = true;
      btn.textContent = 'Sending...';
      try {
        const res = await fetch(`${config.serverUrl}/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ comments: [comment] }),
        });
        const data = await res.json();
        if (data.issues && data.issues.length > 0) {
          btn.textContent = 'Done!';
          btn.style.background = '#4caf50';
          console.log('[visual-annotate] Issue created:', data.issues[0].html_url);
          setTimeout(closePanel, 800);
        } else {
          btn.textContent = 'Failed - try again';
          btn.style.background = '#ff6b6b';
          console.error('[visual-annotate] Submit failed:', data.error || data);
          setTimeout(() => { btn.disabled = false; btn.textContent = 'Submit to GitHub'; btn.style.background = '#29ADC4'; }, 2000);
        }
      } catch (err) {
        btn.textContent = 'Server not running!';
        btn.style.background = '#ff6b6b';
        console.error('[visual-annotate] Could not reach server. Is `npm run va` running?', err);
        setTimeout(() => { btn.disabled = false; btn.textContent = 'Submit to GitHub'; btn.style.background = '#29ADC4'; }, 2000);
      }
    };
  }

  function onClick(e) {
    if (!active) return;
    if (e.target.closest('.__va_panel')) return;
    e.preventDefault();
    e.stopPropagation();
    openPanel(e.target, e.clientX, e.clientY);
  }

  function toggle() {
    active = !active;
    if (!active && hoverEl) {
      hoverEl.classList.remove('__va_highlight');
      hoverEl = null;
    }
  }

  function onKeydown(e) {
    const modsOk =
      e.ctrlKey === !!config.shortcut.ctrl &&
      e.shiftKey === !!config.shortcut.shift &&
      e.altKey === !!config.shortcut.alt;
    const wantsToggle = modsOk && (e.code === 'KeyA' || e.code === 'KeyK');
    if (wantsToggle) {
      e.preventDefault();
      toggle();
    } else if (e.key === 'Escape' && active) {
      toggle();
      closePanel();
    }
  }

  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeydown, true);

  return {
    destroy() {
      consoleCapture.stop();
      document.removeEventListener('mouseover', onMouseOver, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKeydown, true);
      closePanel();
    },
  };
}
