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
    const mintEls = document.querySelectorAll('.mint-gen');
    if (mintEls.length === 0) return resolve();

    const allDone = () => Array.from(mintEls).every((el) => el.getAttribute('data-phase') === 'done');
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

    setTimeout(() => { cleanup(); resolve(); }, 4000);
  });
}

async function captureScreenshot(el) {
  try {
    await ensureHtml2canvas();

    const vpW = window.innerWidth;
    const vpH = window.innerHeight;

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

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      document.body.style.height = saved.bh;
      document.body.style.overflow = saved.bo;
      document.body.style.width = saved.bw;
      document.documentElement.style.height = saved.oh;
      document.documentElement.style.overflow = saved.oo;
      return null;
    }

    let canvas;
    try {
      await waitForMintGenSettled();

      canvas = await window.html2canvas(document.body, {
        x: 0,
        y: 0,
        width: vpW,
        height: vpH,
        windowWidth: vpW,
        windowHeight: vpH,
        useCORS: true,
        allowTaint: true,
        scale: 1,
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
      document.body.style.height = saved.bh;
      document.body.style.overflow = saved.bo;
      document.body.style.width = saved.bw;
      document.documentElement.style.height = saved.oh;
      document.documentElement.style.overflow = saved.oo;
    }

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

    return canvas.toDataURL('image/png');
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
    if (hoverEl) hoverEl.classList.remove('__va_highlight');
    hoverEl = e.target;
    hoverEl.classList.add('__va_highlight');
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
    panel.style.left = Math.min(x, window.innerWidth - 300) + 'px';
    panel.style.top = Math.min(y, window.innerHeight - 200) + 'px';
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
