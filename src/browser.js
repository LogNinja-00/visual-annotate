import { createConsoleCapture } from './console-capture.js';
import { locate } from './locator.js';
import { captureElement } from './screenshot.js';
import { injectStyles } from './styles.js';
import { submitComments } from './client.js';

export function initAnnotator(userConfig = {}) {
  const config = {
    enabled: true,
    shortcut: { key: 'a', alt: true, shift: true },
    consoleBufferSize: 50,
    submitUrl: 'http://localhost:4545/submit',
    token: null,
    allowedHosts: ['localhost', '127.0.0.1'],
    ...userConfig,
  };

  const hostOk = !config.allowedHosts || config.allowedHosts.includes(location.hostname);
  if (!config.enabled || !hostOk) {
    return { destroy() {} };
  }

  injectStyles();
  const consoleCapture = createConsoleCapture(config.consoleBufferSize);
  const startTimer = setTimeout(() => consoleCapture.start(), 1000);

  let active = false;
  let hoverEl = null;

  const dock = document.createElement('div');
  dock.className = '__va_dock';
  dock.innerHTML = `<span>Annotate: <b class="__va_state">off</b></span>`;
  document.body.appendChild(dock);
  const stateLabel = dock.querySelector('.__va_state');

  function updateDock() {
    stateLabel.textContent = active ? 'on (Esc to stop)' : 'off';
  }

  function onMouseOver(e) {
    if (!active) return;
    if (hoverEl) hoverEl.classList.remove('__va_highlight');
    hoverEl = e.target;
    hoverEl.classList.add('__va_highlight');
  }

  function closePanel() {
    const existing = document.querySelector('.__va_panel');
    if (existing) existing.remove();
  }

  async function openPanel(el, x, y) {
    closePanel();
    const loc = locate(el);
    const label = loc.file
      ? `${loc.component ? loc.component + ' — ' : ''}${loc.file}${loc.line ? ':' + loc.line : ''}`
      : loc.selector;

    const screenshot = await captureElement(el);

    const panel = document.createElement('div');
    panel.className = '__va_panel';
    panel.style.left = Math.min(x, window.innerWidth - 300) + 'px';
    panel.style.top = Math.min(y, window.innerHeight - 200) + 'px';
    panel.innerHTML = `
      <div class="__va_label">${label}</div>
      ${screenshot ? '<div style="margin-top:6px;"><img src="' + screenshot + '" style="width:100%;border-radius:4px;border:1px solid #33393b;" /></div>' : ''}
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
        text,
        locator: loc,
        consoleLog: consoleCapture.snapshot(),
        url: location.href,
        time: new Date().toISOString(),
        screenshot,
      };
      const btn = panel.querySelector('.__va_submit_now');
      btn.disabled = true;
      btn.textContent = 'Sending...';
      try {
        const { created } = await submitComments({
          url: config.submitUrl,
          comments: [comment],
          token: config.token,
        });
        btn.textContent = 'Done!';
        btn.style.background = '#4caf50';
        console.log('[visual-annotate] Issue created:', created[0].html_url);
        setTimeout(closePanel, 800);
      } catch (err) {
        btn.textContent = err.offline ? 'Server not running!' : 'Failed - try again';
        btn.style.background = '#ff6b6b';
        console.error('[visual-annotate] Submit failed:', err.message || err);
        setTimeout(() => { btn.disabled = false; btn.textContent = 'Submit to GitHub'; btn.style.background = '#29ADC4'; }, 2000);
      }
    };
  }

  function onClick(e) {
    if (!active) return;
    if (e.target.closest('.__va_panel') || e.target.closest('.__va_dock')) return;
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
    updateDock();
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

  dock.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle();
  }, true);
  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeydown, true);
  updateDock();

  return {
    destroy() {
      clearTimeout(startTimer);
      consoleCapture.stop();
      document.removeEventListener('mouseover', onMouseOver, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKeydown, true);
      dock.remove();
      closePanel();
    },
  };
}
