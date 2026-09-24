// The canonical annotation shape, shared by the browser client, the dev-server
// plugins, and the standalone server. One versioned contract so both sides of
// the wire agree on field names, and so agents reading a filed issue get a
// stable schema to parse.
//
// This module must stay free of DOM and Node globals: it runs in the page, in
// the dev server, and under `node --test`.

export const SCHEMA_ID = 'visual-annotate/1';

const MAX_LOCATOR_TEXT = 200;
const MAX_OUTER_HTML = 2000;
const CONSOLE_LEVELS = ['log', 'info', 'warn', 'error', 'debug'];

/**
 * @typedef {Object} Locator
 * @property {string} framework        'react' | 'vue' | 'unknown'
 * @property {string|null} file        source file path, when the framework exposes it
 * @property {number|null} line
 * @property {number|null} column
 * @property {string|null} component
 * @property {string} selector         CSS path fallback
 * @property {string} text             trimmed visible text
 * @property {string|null} outerHTML   trimmed element markup
 *
 * @typedef {Object} Environment
 * @property {number|null} viewportWidth
 * @property {number|null} viewportHeight
 * @property {number|null} devicePixelRatio
 * @property {string|null} userAgent
 *
 * @typedef {{ dataUrl: string } | { path: string, url: string|null, branch: string|null }} Screenshot
 *
 * @typedef {Object} Annotation
 * @property {string} schema
 * @property {string} id
 * @property {string} createdAt
 * @property {string} text                        what the reporter saw
 * @property {string|null} expected               what they expected instead (acceptance criteria)
 * @property {string} url                         page the report came from
 * @property {string|null} locale
 * @property {Environment} environment
 * @property {Locator} locator
 * @property {{ level: string, message: string }[]} console
 * @property {Screenshot|null} screenshot
 * @property {string|null} codeFrame              source snippet around locator.file:line
 * @property {{ commit: string|null, branch: string|null }|null} git
 */

function str(value) {
  return typeof value === 'string' ? value : '';
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeEnvironment(env = {}) {
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    viewportWidth: num(env.viewportWidth),
    viewportHeight: num(env.viewportHeight),
    devicePixelRatio: num(env.devicePixelRatio),
    userAgent: env.userAgent ? String(env.userAgent) : null,
  };
}

function normalizeLocator(locator = {}) {
  const line = Number.isInteger(locator.line) ? locator.line : null;
  const column = Number.isInteger(locator.column) ? locator.column : null;
  return {
    framework: str(locator.framework) || 'unknown',
    file: locator.file ? String(locator.file) : null,
    line,
    column,
    component: locator.component ? String(locator.component) : null,
    selector: str(locator.selector),
    text: str(locator.text).slice(0, MAX_LOCATOR_TEXT),
    outerHTML: str(locator.outerHTML).slice(0, MAX_OUTER_HTML) || null,
  };
}

function normalizeConsole(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((e) => e && typeof e === 'object')
    .map((e) => ({
      level: CONSOLE_LEVELS.includes(e.level) ? e.level : 'log',
      message: str(e.message),
    }));
}

function normalizeScreenshot(screenshot) {
  if (!screenshot) return null;
  if (typeof screenshot === 'string') {
    return screenshot.startsWith('data:') ? { dataUrl: screenshot } : null;
  }
  if (typeof screenshot.dataUrl === 'string' && screenshot.dataUrl.startsWith('data:')) {
    return { dataUrl: screenshot.dataUrl };
  }
  if (typeof screenshot.path === 'string') {
    return {
      path: screenshot.path,
      url: screenshot.url ? String(screenshot.url) : null,
      branch: screenshot.branch ? String(screenshot.branch) : null,
    };
  }
  return null;
}

function normalizeGit(git) {
  if (!git) return null;
  const commit = git.commit ? String(git.commit) : null;
  const branch = git.branch ? String(git.branch) : null;
  if (!commit && !branch) return null;
  return { commit, branch };
}

/**
 * Normalize arbitrary input (a panel-submitted comment, or a payload from an
 * older client) into the canonical Annotation shape. Tolerant on input, strict
 * on output.
 *
 * @param {object} input
 * @returns {Annotation}
 */
export function buildAnnotation(input = {}) {
  return {
    schema: SCHEMA_ID,
    id: str(input.id) || generateId(),
    createdAt: str(input.createdAt) || str(input.time) || new Date().toISOString(),
    text: str(input.text).trim(),
    expected: str(input.expected).trim() || null,
    url: str(input.url),
    locale: str(input.locale) || null,
    environment: normalizeEnvironment(input.environment),
    locator: normalizeLocator(input.locator),
    console: normalizeConsole(input.consoleLog ?? input.console),
    screenshot: normalizeScreenshot(input.screenshot),
    codeFrame: input.codeFrame ? String(input.codeFrame) : null,
    git: normalizeGit(input.git),
  };
}

/**
 * Validate a built annotation. The server rejects anything that fails so a
 * malformed payload can't produce a useless issue.
 *
 * @param {Annotation} annotation
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateAnnotation(annotation) {
  const errors = [];
  if (!annotation || typeof annotation !== 'object') {
    return { ok: false, errors: ['annotation is not an object'] };
  }
  if (annotation.schema !== SCHEMA_ID) {
    errors.push(`unsupported schema: ${annotation.schema}`);
  }
  if (!str(annotation.id)) errors.push('id is required');
  if (!str(annotation.text)) errors.push('text is required');
  if (!str(annotation.url)) errors.push('url is required');
  if (!annotation.locator || typeof annotation.locator !== 'object') {
    errors.push('locator is required');
  }
  if (annotation.screenshot) {
    const s = annotation.screenshot;
    const isPending = typeof s.dataUrl === 'string';
    const isStored = typeof s.path === 'string';
    if (!isPending && !isStored) errors.push('screenshot must carry a dataUrl or a path');
  }
  return { ok: errors.length === 0, errors };
}

export function isPendingScreenshot(annotation) {
  return Boolean(annotation && annotation.screenshot && annotation.screenshot.dataUrl);
}
