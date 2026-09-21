import { createConsoleCapture } from './console-capture.js';
import { locate } from './locator.js';
import { captureElement } from './screenshot.js';
import { injectStyles } from './styles.js';
import { submitComments } from './client.js';

// `shortcut.key` is written as a letter ('a'), but KeyboardEvent.code is 'KeyA'.
function shortcutCode(key) {
  if (!key) return 'KeyA';
  if (/^Key[A-Z]$/.test(key)) return key;
  return 'Key' + String(key).toUpperCase();
}

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
  let panelSeq = 0;

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
    panelSeq += 1; // invalidate any capture still in flight
    const existing = document.querySelector('.__va_panel');
    if (existing) existing.remove();
  }

  // Escape must not throw away work the reporter has started typing.
  function panelHasDraft() {
    const panel = document.querySelector('.__va_panel');
    if (!panel) return false;
    const text = panel.querySelector('textarea');
    const expected = panel.querySelector('.__va_expected');
    return Boolean((text && text.value.trim()) || (expected && expected.value.trim()));
  }

  function openPanel(el, x, y) {
    const seq = panelSeq + 1;
    panelSeq = seq;
    const existing = document.querySelector('.__va_panel');
    if (existing) existing.remove();

    const loc = locate(el);
    const label = loc.file
      ? `${loc.component ? loc.component + ' — ' : ''}${loc.file}${loc.line ? ':' + loc.line : ''}`
      : loc.selector;

    const panel = document.createElement('div');
    panel.className = '__va_panel';
    panel.style.left = Math.min(x, window.innerWidth - 300) + 'px';
    panel.style.top = Math.min(y, window.innerHeight - 200) + 'px';
    panel.innerHTML = `
      <div class="__va_label"></div>
      <div class="__va_shot"></div>
      <textarea placeholder="What's wrong with this?"></textarea>
      <div>
        <button class="__va_submit_now">Submit to GitHub</button>
        <button class="__va_cancel __va_secondary">Cancel</button>
      </div>
      <div class="__va_hint">Ctrl/⌘ + Enter to submit</div>
    `;
    // textContent, never interpolation — selector and file names are page-controlled.
    panel.querySelector('.__va_label').textContent = label;
    document.body.appendChild(panel);

    const textarea = panel.querySelector('textarea');
    const shotBox = panel.querySelector('.__va_shot');
    const submitBtn = panel.querySelector('.__va_submit_now');
    textarea.focus();

    // Capture in the background: html2canvas has to load and re-render the whole
    // document, so awaiting it before showing the panel would freeze the UI.
    let screenshot;
    const capture = captureElement(el)
      .then((dataUrl) => {
        screenshot = dataUrl;
        if (seq === panelSeq && dataUrl) {
          const img = document.createElement('img');
          img.src = dataUrl;
          img.alt = 'annotation';
          shotBox.appendChild(img);
        }
        return dataUrl;
      })
      .catch(() => {
        screenshot = null;
        return null;
      });

    async function submit() {
      const text = textarea.value.trim();
      if (!text) {
        textarea.focus();
        return;
      }
      const shot = screenshot === undefined ? await capture : screenshot;
      const comment = {
        text,
        locator: loc,
        consoleLog: consoleCapture.snapshot(),
        url: location.href,
        time: new Date().toISOString(),
        screenshot: shot || null,
      };

      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending...';
      try {
        const { created } = await submitComments({
          url: config.submitUrl,
          comments: [comment],
          token: config.token,
        });
        submitBtn.textContent = 'Done!';
        submitBtn.style.background = '#4caf50';
        console.log('[visual-annotate] Issue created:', created[0].html_url);
        setTimeout(closePanel, 800);
      } catch (err) {
        submitBtn.textContent = err.offline ? 'Server not running!' : 'Failed - try again';
        submitBtn.style.background = '#ff6b6b';
        console.error('[visual-annotate] Submit failed:', err.message || err);
        setTimeout(() => {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit to GitHub';
          submitBtn.style.background = '#29ADC4';
        }, 2000);
      }
    }

    submitBtn.onclick = submit;
    panel.querySelector('.__va_cancel').onclick = closePanel;
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submit();
      }
    });
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
    if (e.key === 'Escape') {
      // A draft in progress outranks "stop annotating" — otherwise a stray Esc
      // silently discards the comment the reporter just typed.
      if (panelHasDraft()) {
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        return;
      }
      if (document.querySelector('.__va_panel')) {
        e.preventDefault();
        closePanel();
        return;
      }
      if (active) {
        e.preventDefault();
        toggle();
      }
      return;
    }

    const shortcut = config.shortcut || {};
    const modsOk =
      e.ctrlKey === !!shortcut.ctrl &&
      e.shiftKey === !!shortcut.shift &&
      e.altKey === !!shortcut.alt;
    if (modsOk && e.code === shortcutCode(shortcut.key)) {
      e.preventDefault();
      toggle();
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
