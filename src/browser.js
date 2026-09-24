import { createConsoleCapture } from './console-capture.js';
import { locate } from './locator.js';
import {
  ensureOverlayStyles,
  hideOverlay,
  pickElementAt,
  showOverlay,
} from './selection.js';
import { captureScreenshot } from './screenshot.js';
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

  ensureOverlayStyles();
  injectStyles();
  const consoleCapture = createConsoleCapture(config.consoleBufferSize);
  const startTimer = setTimeout(() => consoleCapture.start(), 1000);

  let active = false;
  let pickedEl = null;
  let panelOpen = false;
  let panelSeq = 0;
  let rafPending = false;
  let lastClient = { x: 0, y: 0 };
  let currentScreenshot = null;

  function setPicked(el) {
    pickedEl = el;
    if (active && !panelOpen) showOverlay(el);
    else hideOverlay();
  }

  function onPointerMove(e) {
    if (!active || panelOpen) return;
    lastClient = { x: e.clientX, y: e.clientY };
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      if (!active || panelOpen) return;
      const el = pickElementAt(lastClient.x, lastClient.y);
      if (el !== pickedEl) setPicked(el);
      else if (el) showOverlay(el);
    });
  }

  function onPointerLeave() {
    if (panelOpen) return;
    setPicked(null);
  }

  function setStatus(panel, text, tone) {
    const node = panel.querySelector('.__va_status');
    if (!node) return;
    node.textContent = text || '';
    if (tone) node.setAttribute('data-tone', tone);
    else node.removeAttribute('data-tone');
  }

  function closePanel() {
    panelSeq += 1;
    panelOpen = false;
    currentScreenshot = null;
    const existing = document.querySelector('.__va_panel');
    if (existing) existing.remove();
    if (active) {
      const el = pickElementAt(lastClient.x, lastClient.y) || pickedEl;
      setPicked(el);
    } else {
      hideOverlay();
    }
  }

  // Escape must not throw away work the reporter has started typing.
  function panelHasDraft() {
    const panel = document.querySelector('.__va_panel');
    if (!panel) return false;
    const text = panel.querySelector('textarea');
    const expected = panel.querySelector('.__va_expected');
    return Boolean((text && text.value.trim()) || (expected && expected.value.trim()));
  }

  async function openPanel(el, x, y) {
    if (!el) return;
    closePanel();
    const seq = panelSeq + 1;
    panelSeq = seq;
    panelOpen = true;
    hideOverlay();

    const loc = locate(el);
    const label = loc.file
      ? `${loc.component ? loc.component + ' — ' : ''}${loc.file}${loc.line ? ':' + loc.line : ''}`
      : loc.selector;

    const panel = document.createElement('div');
    panel.className = '__va_panel';
    panel.setAttribute('data-va-ui', '1');
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
      <div class="__va_label"></div>
      <div class="__va_status" data-tone="">Capturing screenshot…</div>
      <div class="__va_shot"></div>
      <textarea placeholder="What's wrong with this?"></textarea>
      <input class="__va_expected" type="text" placeholder="What did you expect? (optional)" />
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
    const expectedInput = panel.querySelector('.__va_expected');
    const submitBtn = panel.querySelector('.__va_submit_now');
    textarea.focus();
    panel.querySelector('.__va_cancel').onclick = closePanel;

    // Capture in the background so the panel paints first.
    let screenshot;
    const capture = captureScreenshot(el)
      .then((dataUrl) => {
        screenshot = dataUrl;
        currentScreenshot = dataUrl;
        if (seq === panelSeq && panel.isConnected) {
          if (dataUrl) {
            const shot = panel.querySelector('.__va_shot');
            shot.innerHTML =
              '<img alt="Screenshot" style="width:100%;border-radius:4px;border:1px solid #33393b;margin-top:6px;" />';
            shot.querySelector('img').src = dataUrl;
            setStatus(panel, 'Screenshot ready', 'ok');
          } else {
            setStatus(panel, 'Screenshot failed — comment will still submit', 'error');
          }
        }
        return dataUrl;
      })
      .catch(() => {
        screenshot = null;
        if (seq === panelSeq && panel.isConnected) {
          setStatus(panel, 'Screenshot failed — comment will still submit', 'error');
        }
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
        expected: expectedInput.value.trim() || undefined,
        locator: loc,
        consoleLog: consoleCapture.snapshot(),
        url: location.href,
        time: new Date().toISOString(),
        environment: {
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio,
          userAgent: navigator.userAgent,
        },
        locale: navigator.language,
        screenshot: shot || null,
      };

      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending...';
      setStatus(panel, 'Sending to GitHub…');
      try {
        const { created } = await submitComments({
          url: config.submitUrl,
          comments: [comment],
          token: config.token,
        });
        submitBtn.textContent = 'Done!';
        submitBtn.style.background = '#4caf50';
        setStatus(
          panel,
          created[0] && created[0].number
            ? `Issue #${created[0].number} created`
            : 'Issue created',
          'ok'
        );
        console.log('[visual-annotate] Issue created:', created[0] && created[0].html_url);
        setTimeout(closePanel, 800);
      } catch (err) {
        submitBtn.textContent = err.offline ? 'Server not running!' : 'Failed - try again';
        submitBtn.style.background = '#ff6b6b';
        setStatus(
          panel,
          err.offline ? 'Start the VA server (npm run va)' : err.message || 'Submit failed',
          'error'
        );
        console.error('[visual-annotate] Submit failed:', err.message || err);
        setTimeout(() => {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit to GitHub';
          submitBtn.style.background = '#29ADC4';
        }, 2000);
      }
    }

    submitBtn.onclick = submit;
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submit();
      }
    });
  }

  function onClick(e) {
    if (!active) return;
    if (e.target.closest && e.target.closest('.__va_panel')) return;
    e.preventDefault();
    e.stopPropagation();
    // Hit-test first (real browsers); fall back to the hovered element, then
    // the event target itself (jsdom in tests has no elementFromPoint).
    const fallback = e.target && e.target.nodeType === 1 ? e.target : null;
    const el = pickElementAt(e.clientX, e.clientY) || pickedEl || fallback;
    if (!el) return;
    openPanel(el, e.clientX, e.clientY);
  }

  function toggle() {
    active = !active;
    document.body.classList.toggle('__va_pick_mode', active);
    if (active) {
      const el = pickElementAt(
        lastClient.x || window.innerWidth / 2,
        lastClient.y || window.innerHeight / 2
      );
      setPicked(el);
      console.log('[VA] annotate mode ON — hover to pick, click to comment');
    } else {
      setPicked(null);
      hideOverlay();
      closePanel();
      console.log('[VA] annotate mode OFF');
    }
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
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

  document.addEventListener('mousemove', onPointerMove, true);
  document.addEventListener('pointermove', onPointerMove, true);
  document.addEventListener(
    'mouseout',
    (e) => {
      if (!e.relatedTarget && !e.toElement) onPointerLeave();
    },
    true
  );
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeydown, true);

  return {
    destroy() {
      clearTimeout(startTimer);
      consoleCapture.stop();
      document.removeEventListener('mousemove', onPointerMove, true);
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKeydown, true);
      document.body.classList.remove('__va_pick_mode');
      hideOverlay();
      closePanel();
      active = false;
    },
    _state: () => ({ active, panelOpen, picked: pickedEl }),
  };
}
