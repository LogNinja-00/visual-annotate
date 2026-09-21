// The annotator's own stylesheet, injected once into the host page.
// Kept out of the annotator logic so the CSS lives in one place and
// `injectStyles` stays idempotent (a second call is a no-op).

const STYLE_ID = '__va_style__';

const STYLES = `
  .__va_highlight { outline: 2px solid #29ADC4 !important; outline-offset: 2px; cursor: crosshair !important; }
  .__va_panel { position: fixed; z-index: 2147483647; background: #14181a; color: #fcfafa; font: 13px/1.4 -apple-system, sans-serif; border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,.4); padding: 12px; width: 280px; }
  .__va_panel textarea { width: 100%; min-height: 60px; margin-top: 8px; background: #1e2426; color: #fcfafa; border: 1px solid #33393b; border-radius: 6px; padding: 6px; font: inherit; resize: vertical; box-sizing: border-box; }
  .__va_panel input { width: 100%; margin-top: 6px; background: #1e2426; color: #fcfafa; border: 1px solid #33393b; border-radius: 6px; padding: 6px; font: inherit; box-sizing: border-box; }
  .__va_panel .__va_label { font-size: 11px; color: #9fb3b8; word-break: break-all; }
  .__va_panel .__va_shot img { width: 100%; margin-top: 6px; border-radius: 4px; border: 1px solid #33393b; }
  .__va_panel .__va_hint { margin-top: 6px; font-size: 11px; color: #6f858a; }
  .__va_panel button { margin-top: 8px; background: #29ADC4; color: #06222b; border: none; border-radius: 6px; padding: 8px 14px; font-weight: 700; cursor: pointer; font-size: 13px; }
  .__va_panel button.__va_secondary { background: transparent; color: #9fb3b8; margin-left: 6px; font-weight: 600; font-size: 12px; padding: 6px 10px; }
  .__va_dock { position: fixed; bottom: 16px; right: 16px; z-index: 2147483647; background: #14181a; color: #fcfafa; font: 13px/1.4 -apple-system, sans-serif; border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,.4); padding: 10px 14px; display: flex; align-items: center; gap: 10px; cursor: pointer; user-select: none; }
`;

export function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);
}
