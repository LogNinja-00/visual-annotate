// Screenshot pipeline: settle page → tag text by content (not index) →
// html2canvas with FO first, blank-detect, retry with canvas renderer.

import { analyzeCanvasImageData, cssColorToRgba, isLikelyBlankCanvas } from './geometry.js';
import { clipRingRect } from './geometry-clip.js';

let html2canvasReady = null;

export function ensureHtml2canvas() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.html2canvas) return Promise.resolve();
  if (html2canvasReady) return html2canvasReady;
  html2canvasReady = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/html2canvas.min.js';
    script.onload = () => resolve();
    script.onerror = () => {
      html2canvasReady = null;
      reject(new Error('Failed to load html2canvas'));
    };
    document.head.appendChild(script);
  });
  return html2canvasReady;
}

export function resetHtml2canvasLoaderForTests() {
  html2canvasReady = null;
}

const TEXT_SELECTOR =
  'h1, h2, h3, h4, h5, h6, p, a, button, span, li, label, strong, em, blockquote, figcaption, .mint-gen-body, [class*="scramble"]';

export function isTextLeaf(n) {
  if (!n || n.children.length > 0) return false;
  if (n.closest && n.closest('[class*="__va_"]')) return false;
  if (
    n.closest &&
    n.closest('.mint-gen-code, .mint-gen-pixel, .mint-gen-intent, .mint-gen-stream')
  ) {
    return false;
  }
  const t = n.textContent;
  return !!(t && t.trim());
}

export function textLeafNodes(root = document) {
  return Array.from(root.querySelectorAll(TEXT_SELECTOR)).filter(isTextLeaf);
}

export function samplePageText() {
  const nodes = textLeafNodes();
  let text = '';
  for (let i = 0; i < nodes.length; i++) text += nodes[i].textContent + '|';
  return text;
}

export function waitForStableText(timeoutMs = 3500, stableMs = 500) {
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
      } else if (now - lastChange >= stableMs && now - start >= 200) {
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

export function waitForMintGenSettled(timeoutMs = 6000) {
  return new Promise((resolve) => {
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
    }, timeoutMs);
  });
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

export function stabilizeCloneContent(clonedDoc) {
  // CSS-hide transient overlays only — never clear textContent (index/attr
  // restore handles copy; emptying nodes used to wipe real content).
  clonedDoc
    .querySelectorAll('.mint-gen-code, .mint-gen-pixel, .mint-gen-intent, .mint-gen-stream')
    .forEach((node) => {
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

export function freezeCloneAnimations(clonedDoc) {
  const win = clonedDoc.defaultView;
  const style = clonedDoc.createElement('style');
  style.setAttribute('data-va-freeze', '1');
  style.textContent =
    '*, *::before, *::after { animation-play-state: paused !important; transition: none !important; }';
  clonedDoc.head.appendChild(style);
  if (win) {
    try {
      win.getAnimations().forEach((anim) => {
        try {
          anim.pause();
        } catch {}
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
    const poster = video.getAttribute('poster');
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
      (li) =>
        li.currentSrc === src ||
        li.src === src ||
        li.getAttribute('src') === src ||
        li.currentSrc === abs ||
        li.src === abs
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

export function stabilizeCloneMedia(clonedDoc) {
  try {
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

export function waitForCloneImages(clonedDoc, timeoutMs = 3000) {
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

function drawRingOnCanvas(canvas, ringRect, viewportWidth) {
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const scale = canvas.width / viewportWidth;
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
}

async function runCapture({ ringRect, vpW, vpH, scrollX, scrollY, useForeignObject }) {
  const canvas = await window.html2canvas(document.body, {
    x: 0,
    y: 0,
    width: vpW,
    height: vpH,
    windowWidth: vpW,
    windowHeight: vpH,
    scrollX,
    scrollY,
    useCORS: true,
    allowTaint: true,
    foreignObjectRendering: useForeignObject,
    scale: 2,
    logging: false,
    backgroundColor: '#ffffff',
    imageTimeout: 8000,
    ignoreElements: (node) => {
      // Never drop the document root — body.__va_pick_mode must not self-ignore.
      if (!node || node === document.body || node === document.documentElement) return false;
      if (node.tagName === 'BODY' || node.tagName === 'HTML') return false;
      if (!node.classList) return false;
      if (node.hasAttribute && node.hasAttribute('data-va-target')) return false;
      for (const cls of node.classList) {
        if (cls.startsWith('__va_') && cls !== '__va_pick_mode') return true;
      }
      if (node.id && String(node.id).startsWith('__va')) return true;
      return false;
    },
    onclone: async (clonedDoc) => {
      try {
        stabilizeCloneContent(clonedDoc);
      } catch (e) {
        console.error('[VA] stabilize failed', e);
      }
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
        clonedDoc.querySelectorAll('[data-va-text]').forEach((n) => {
          const t = n.getAttribute('data-va-text');
          if (t != null) {
            n.textContent = t;
            restored += 1;
          }
          n.removeAttribute('data-va-text');
        });
        if (restored) console.log('[VA] text restored', restored);
      } catch {}
      try {
        await stabilizeCloneMedia(clonedDoc);
      } catch {}
      try {
        await waitForCloneImages(clonedDoc, 4000);
      } catch {}
      try {
        if (clonedDoc.fonts && clonedDoc.fonts.ready) await clonedDoc.fonts.ready;
      } catch {}
      try {
        freezeCloneAnimations(clonedDoc);
      } catch {}
    },
  });
  if (canvas) drawRingOnCanvas(canvas, ringRect, vpW);
  return canvas;
}

/**
 * Capture viewport screenshot with red ring on target.
 * Retries with foreignObjectRendering flipped when blank/failed.
 */
export async function captureScreenshot(el) {
  try {
    await ensureHtml2canvas();
    await waitForMintGenSettled();
    await waitForStableText();

    if (document.fonts && document.fonts.ready) {
      try {
        await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
      } catch {}
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;

    // Tag live leaves with their OWN text (content-addressed, not index).
    const liveTextNodes = textLeafNodes();
    liveTextNodes.forEach((n) => n.setAttribute('data-va-text', n.textContent));

    el.setAttribute('data-va-target', '1');
    let ringRect = clipRingRect(
      { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      el
    );

    let canvas;
    try {
      try {
        canvas = await runCapture({
          ringRect,
          vpW,
          vpH,
          scrollX,
          scrollY,
          useForeignObject: true,
        });
      } catch (err) {
        console.warn('[VA] FO capture failed', err && (err.message || String(err)));
        canvas = null;
      }

      if (!canvas || isLikelyBlankCanvas(canvas)) {
        console.warn('[VA] blank/failed FO capture — retrying canvas renderer');
        try {
          canvas = await runCapture({
            ringRect,
            vpW,
            vpH,
            scrollX,
            scrollY,
            useForeignObject: false,
          });
        } catch (err) {
          console.warn('[VA] canvas renderer failed', err && (err.message || String(err)));
          canvas = canvas || null;
        }
      }

      if (!canvas) return null;

      const stats = (() => {
        try {
          const step = 8;
          const sampleW = Math.min(canvas.width, 128);
          const sampleH = Math.min(canvas.height, 128);
          const data = canvas.getContext('2d').getImageData(0, 0, sampleW, sampleH).data;
          return analyzeCanvasImageData(data, sampleW, sampleH, step);
        } catch {
          return null;
        }
      })();
      console.log('[VA] ringRect', JSON.stringify(ringRect));
      console.log('[VA] capture stats', stats);

      if (stats && stats.blank) {
        console.warn('[VA] screenshot still blank after retries');
      }

      return canvas.toDataURL('image/jpeg', 0.92);
    } finally {
      el.removeAttribute('data-va-target');
      liveTextNodes.forEach((n) => n.removeAttribute('data-va-text'));
    }
  } catch (err) {
    console.error('[VA] Screenshot failed:', err.message || err);
    return null;
  }
}
