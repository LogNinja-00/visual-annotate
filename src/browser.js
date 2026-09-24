import { createConsoleCapture } from './console-capture.js';
import { locate } from './locator.js';
import {
  ensureOverlayStyles,
  hideOverlay,
  pickElementAt,
  showOverlay,
} from './selection.js';
import { captureScreenshot } from './screenshot.js';

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

  ensureOverlayStyles();
  const consoleCapture = createConsoleCapture(config.consoleBufferSize);
  setTimeout(() => consoleCapture.start(), 1000);

  let active = false;
  let pickedEl = null;
  let currentScreenshot = null;
  let panelOpen = false;
  let rafPending = false;
  let lastClient = { x: 0, y: 0 };

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
      // Only update if changed (or always — cheap enough)
      if (el !== pickedEl) setPicked(el);
      else if (el) showOverlay(el);
    });
  }

  function onPointerLeave() {
    if (panelOpen) return;
    setPicked(null);
  }

  function closePanel() {
    panelOpen = false;
    const existing = document.querySelector('.__va_panel');
    if (existing) existing.remove();
    currentScreenshot = null;
    if (active) {
      const el = pickElementAt(lastClient.x, lastClient.y) || pickedEl;
      setPicked(el);
    } else {
      hideOverlay();
    }
  }

  function setStatus(panel, text, tone) {
    const node = panel.querySelector('.__va_status');
    if (!node) return;
    node.textContent = text || '';
    if (tone) node.setAttribute('data-tone', tone);
    else node.removeAttribute('data-tone');
  }

  async function openPanel(el, x, y) {
    if (!el) return;
    closePanel();
    panelOpen = true;
    hideOverlay();

    const loc = locate(el);
    const label = loc.file
      ? `${loc.component ? loc.component + ' — ' : ''}${loc.file}${loc.line ? ':' + loc.line : ''}`
      : loc.selector;

    // Show panel immediately with "Capturing…" so the UI never feels stuck
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
      <div>
        <button class="__va_submit_now">Submit to GitHub</button>
        <button class="__va_cancel __va_secondary">Cancel</button>
      </div>
    `;
    panel.querySelector('.__va_label').textContent = label;
    document.body.appendChild(panel);
    const textarea = panel.querySelector('textarea');
    textarea.focus();
    panel.querySelector('.__va_cancel').onclick = closePanel;

    // Capture async so the panel paints first
    currentScreenshot = await captureScreenshot(el);
    if (!panel.isConnected) return;
    if (currentScreenshot) {
      const shot = panel.querySelector('.__va_shot');
      shot.innerHTML =
        '<img alt="Screenshot" style="width:100%;border-radius:4px;border:1px solid #33393b;margin-top:6px;" />';
      shot.querySelector('img').src = currentScreenshot;
      setStatus(panel, 'Screenshot ready', 'ok');
    } else {
      setStatus(panel, 'Screenshot failed — comment will still submit', 'error');
    }

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
      setStatus(panel, 'Sending to GitHub…');
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
          setStatus(panel, `Issue #${data.issues[0].number} created`, 'ok');
          console.log('[visual-annotate] Issue created:', data.issues[0].html_url);
          setTimeout(closePanel, 800);
        } else {
          btn.textContent = 'Failed - try again';
          btn.style.background = '#ff6b6b';
          setStatus(panel, data.error || 'Submit failed', 'error');
          console.error('[visual-annotate] Submit failed:', data.error || data);
          setTimeout(() => {
            btn.disabled = false;
            btn.textContent = 'Submit to GitHub';
            btn.style.background = '#29ADC4';
          }, 2000);
        }
      } catch (err) {
        btn.textContent = 'Server not running!';
        btn.style.background = '#ff6b6b';
        setStatus(panel, 'Start the VA server (npm run va)', 'error');
        console.error('[visual-annotate] Could not reach server. Is `npm run va` running?', err);
        setTimeout(() => {
          btn.disabled = false;
          btn.textContent = 'Submit to GitHub';
          btn.style.background = '#29ADC4';
        }, 2000);
      }
    };
  }

  function onClick(e) {
    if (!active) return;
    if (e.target.closest && e.target.closest('.__va_panel')) return;
    e.preventDefault();
    e.stopPropagation();
    // Use the smart-picked element at the click point — not raw e.target
    const el = pickElementAt(e.clientX, e.clientY) || pickedEl;
    if (!el) return;
    openPanel(el, e.clientX, e.clientY);
  }

  function toggle() {
    active = !active;
    document.body.classList.toggle('__va_pick_mode', active);
    if (active) {
      const el = pickElementAt(lastClient.x || window.innerWidth / 2, lastClient.y || window.innerHeight / 2);
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
    const modsOk =
      e.ctrlKey === !!config.shortcut.ctrl &&
      e.shiftKey === !!config.shortcut.shift &&
      e.altKey === !!config.shortcut.alt;
    const wantsToggle = modsOk && (e.code === 'KeyA' || e.code === 'KeyK');
    if (wantsToggle) {
      e.preventDefault();
      toggle();
    } else if (e.key === 'Escape' && (active || panelOpen)) {
      if (panelOpen) {
        closePanel();
      } else {
        toggle();
      }
    }
  }

  document.addEventListener('mousemove', onPointerMove, true);
  document.addEventListener('pointermove', onPointerMove, true);
  document.addEventListener('mouseout', (e) => {
    if (!e.relatedTarget && !e.toElement) onPointerLeave();
  }, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeydown, true);

  return {
    destroy() {
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
    // test hooks
    _state: () => ({ active, panelOpen, picked: pickedEl }),
  };
}
