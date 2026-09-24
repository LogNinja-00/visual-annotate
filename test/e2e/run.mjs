/**
 * E2E: serve demo, drive Chromium, assert selection overlay + screenshot pipeline.
 * Run: npm run test:e2e
 */
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.log('E2E SKIP: playwright-core not installed (npm i -D playwright-core)');
  process.exit(0);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(__dirname, '../..');
const OUT = path.join(__dirname, 'artifacts');
const EXE =
  process.env.CHROME_PATH ||
  '/home/kiro/.cache/ms-playwright/chromium-1117/chrome-linux/chrome';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

async function startStaticServer() {
  const server = createServer(async (req, res) => {
    try {
      let url = decodeURIComponent((req.url || '/').split('?')[0]);
      if (url === '/') url = '/demo/index.html';
      // serve html2canvas from src at site root (browser.js loads /html2canvas.min.js)
      if (url === '/html2canvas.min.js') {
        const p = path.join(PKG, 'src/html2canvas.min.js');
        const buf = await readFile(p);
        res.writeHead(200, { 'Content-Type': MIME['.js'] });
        return res.end(buf);
      }
      const safe = path.normalize(url).replace(/^(\.\.[/\\])+/, '');
      const file = path.join(PKG, safe);
      if (!file.startsWith(PKG)) {
        res.writeHead(403);
        return res.end('forbidden');
      }
      if (!existsSync(file)) {
        res.writeHead(404);
        return res.end('not found');
      }
      const buf = await readFile(file);
      const ext = path.extname(file);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(buf);
    } catch (e) {
      res.writeHead(500);
      res.end(String(e));
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, port: server.address().port };
}

function fail(msg) {
  console.error('E2E FAIL:', msg);
  process.exitCode = 1;
}

function pass(msg) {
  console.log('E2E PASS:', msg);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  // ensure html2canvas exists
  if (!existsSync(path.join(PKG, 'src/html2canvas.min.js'))) {
    const src = path.join(PKG, 'node_modules/html2canvas/dist/html2canvas.min.js');
    if (existsSync(src)) await copyFile(src, path.join(PKG, 'src/html2canvas.min.js'));
  }

  const { server, port } = await startStaticServer();
  const base = `http://127.0.0.1:${port}/demo/index.html`;
  console.log('Serving', base);

  let browser;
  try {
    browser = await chromium.launch({ executablePath: EXE, headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const logs = [];
    page.on('console', (m) => logs.push(m.text()));
    page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));

    await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500);

    // 1) Toggle annotator
    await page.keyboard.down('Alt');
    await page.keyboard.down('Shift');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Shift');
    await page.keyboard.up('Alt');
    await page.waitForTimeout(200);

    const modeOn = await page.evaluate(() => document.body.classList.contains('__va_pick_mode'));
    if (modeOn) pass('annotate mode toggles body.__va_pick_mode');
    else fail('annotate mode did not toggle');

    // 2) Overlay appears on hover over CTA button (not inner span only)
    const cta = page.locator('button.cta');
    await cta.hover();
    await page.waitForTimeout(250);
    const overlay = await page.evaluate(() => {
      const o = document.getElementById('__va_overlay');
      if (!o || o.style.display === 'none') return null;
      const r = o.getBoundingClientRect();
      const btn = document.querySelector('button.cta').getBoundingClientRect();
      return {
        ow: r.width,
        oh: r.height,
        bw: btn.width,
        bh: btn.height,
        near: Math.abs(r.left - btn.left) < 8 && Math.abs(r.top - btn.top) < 8,
        tag: (document.getElementById('__va_overlay_tag') || {}).textContent || '',
      };
    });
    if (overlay && overlay.near && overlay.tag.includes('button')) {
      pass(`overlay tracks CTA (${overlay.tag}, ${Math.round(overlay.ow)}×${Math.round(overlay.oh)})`);
    } else {
      fail('overlay not aligned on CTA: ' + JSON.stringify(overlay));
    }

    // 3) Hover heading → overlay on h1 not random child
    await page.locator('h1').hover();
    await page.waitForTimeout(250);
    const h1Overlay = await page.evaluate(() => {
      const o = document.getElementById('__va_overlay');
      const tag = (document.getElementById('__va_overlay_tag') || {}).textContent || '';
      const h1 = document.querySelector('h1').getBoundingClientRect();
      const r = o && o.style.display !== 'none' ? o.getBoundingClientRect() : null;
      if (!r) return null;
      return {
        tag,
        near: Math.abs(r.left - h1.left) < 8 && Math.abs(r.top - h1.top) < 8,
        w: r.width,
        h1w: h1.width,
      };
    });
    if (h1Overlay && h1Overlay.near && /h1/.test(h1Overlay.tag)) {
      pass('overlay on h1 heading');
    } else {
      fail('overlay not on h1: ' + JSON.stringify(h1Overlay));
    }

    // 4) Click opens panel with screenshot
    await page.locator('button.cta').click({ force: false });
    await page.waitForSelector('.__va_panel', { timeout: 15000 });
    // wait until status no longer "Capturing"
    await page.waitForFunction(
      () => {
        const s = document.querySelector('.__va_status');
        return s && !/Capturing/i.test(s.textContent || '');
      },
      { timeout: 30000 }
    );
    const panelState = await page.evaluate(() => {
      const p = document.querySelector('.__va_panel');
      const img = p && p.querySelector('img');
      const status = p && p.querySelector('.__va_status');
      const label = p && p.querySelector('.__va_label');
      return {
        present: !!p,
        hasImg: !!(img && img.src && img.src.startsWith('data:image/')),
        imgLen: img ? img.src.length : 0,
        status: status ? status.textContent : '',
        label: label ? label.textContent : '',
      };
    });
    await page.screenshot({ path: path.join(OUT, 'panel.png'), fullPage: false });
    if (panelState.present) pass('panel opens');
    else fail('panel missing');
    if (panelState.hasImg && panelState.imgLen > 1000) {
      pass(`screenshot attached (${panelState.imgLen} bytes) status="${panelState.status}"`);
      await writeFile(
        path.join(OUT, 'shot.b64'),
        (await page.evaluate(() => {
          const img = document.querySelector('.__va_panel img');
          return img ? img.src : '';
        })).split(',')[1] || '',
        'utf8'
      );
    } else {
      fail('screenshot missing/blank: ' + JSON.stringify(panelState));
      const vaLogs = logs.filter((l) => l.includes('[VA]')).join('\n');
      console.log('--- VA logs ---\n' + vaLogs);
    }

    // 5) Panel label should mention button / cta
    if (/button|cta/i.test(panelState.label || '')) {
      pass('locator label targets button');
    } else {
      fail('locator label unexpected: ' + panelState.label);
    }

    // 6) Escape closes panel
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const stillOpen = await page.evaluate(() => !!document.querySelector('.__va_panel'));
    if (!stillOpen) pass('Escape closes panel');
    else fail('panel still open after Escape');

    // 7) Toggle off clears pick mode
    await page.keyboard.down('Alt');
    await page.keyboard.down('Shift');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Shift');
    await page.keyboard.up('Alt');
    await page.waitForTimeout(150);
    const modeOff = await page.evaluate(() => !document.body.classList.contains('__va_pick_mode'));
    if (modeOff) pass('toggle off clears pick mode');
    else fail('toggle off failed');

    const errors = logs.filter((l) => l.startsWith('pageerror') || /Screenshot failed/.test(l));
    if (errors.length) {
      console.log('errors:', errors);
    }

    console.log('\n==== E2E SUMMARY ====');
    console.log(process.exitCode ? 'FAILED' : 'ALL PASSED');
  } finally {
    if (browser) await browser.close();
    await closeServer(server);
  }
}

function closeServer(s) {
  return new Promise((r) => s.close(r));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
