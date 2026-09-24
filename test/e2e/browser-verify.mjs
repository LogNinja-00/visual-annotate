/**
 * Browser-agent verification: open illustraV, assert selection overlay + screenshot.
 * Run: node /tmp/opencode/va-browser-verify.mjs
 */
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const URL = process.env.VA_URL || 'http://localhost:3001/';
const EXE =
  process.env.CHROME_PATH ||
  '/home/kiro/.cache/ms-playwright/chromium-1117/chrome-linux/chrome';
const OUT = '/tmp/opencode/va-verify2';

const results = [];
function pass(name, detail = '') {
  results.push({ ok: true, name, detail });
  console.log('PASS:', name, detail);
}
function fail(name, detail = '') {
  results.push({ ok: false, name, detail });
  console.error('FAIL:', name, detail);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);

  // Wait for VA init log
  await page.waitForTimeout(500);
  const hasInitLog = logs.some((l) => l.includes('[VA] initAnnotator'));
  if (hasInitLog) pass('VA init called');
  else {
    // module may log only when console capture starts later
    const anyVa = logs.some((l) => l.includes('[VA]'));
    if (anyVa) pass('VA logs present', logs.filter((l) => l.includes('[VA]')).join(' | '));
    else fail('VA did not initialize', 'no [VA] logs; sample: ' + logs.slice(0, 8).join(' | '));
  }

  // Toggle annotate mode
  await page.keyboard.down('Alt');
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Alt');
  await page.waitForTimeout(300);

  const modeOn = await page.evaluate(() =>
    document.body.classList.contains('__va_pick_mode')
  );
  if (modeOn) pass('annotate mode ON');
  else fail('annotate mode ON', 'body class missing');

  // Pick a visible heading/cta
  const targetInfo = await page.evaluate(() => {
    const candidates = [
      ...document.querySelectorAll('h1, h2, button, a[href], p, img'),
    ];
    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      if (r.width > 40 && r.height > 20 && r.top >= 0 && r.bottom <= innerHeight) {
        return {
          tag: el.tagName.toLowerCase(),
          cls: (el.className || '').toString().slice(0, 60),
          text: (el.textContent || '').trim().slice(0, 40),
          cx: Math.round(r.left + r.width / 2),
          cy: Math.round(r.top + r.height / 2),
          rect: { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        };
      }
    }
    return null;
  });
  if (!targetInfo) fail('found target', 'no visible interactive content');
  else pass('found target', `${targetInfo.tag} "${targetInfo.text}" @${targetInfo.cx},${targetInfo.cy}`);

  // Hover target → overlay
  await page.mouse.move(targetInfo.cx, targetInfo.cy);
  await page.waitForTimeout(400);
  const overlay = await page.evaluate(() => {
    const box = document.getElementById('__va_overlay');
    const tag = document.getElementById('__va_overlay_tag');
    if (!box || box.style.display === 'none') return null;
    const r = box.getBoundingClientRect();
    return {
      left: Math.round(r.left),
      top: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
      tag: tag ? tag.textContent : '',
      visible: box.style.display !== 'none',
    };
  });
  if (overlay && overlay.width > 10 && overlay.height > 10) {
    const near =
      Math.abs(overlay.left - targetInfo.rect.l) < 12 &&
      Math.abs(overlay.top - targetInfo.rect.t) < 12;
    if (near)
      pass(
        'overlay aligned on target',
        `${overlay.tag} ${overlay.width}x${overlay.height}`
      );
    else
      fail(
        'overlay aligned on target',
        JSON.stringify({ overlay, target: targetInfo.rect, tag: overlay.tag })
      );
  } else {
    fail('overlay visible on hover', JSON.stringify(overlay));
  }

  await page.screenshot({ path: path.join(OUT, 'hover.png') });

  // Click → panel + screenshot
  await page.mouse.click(targetInfo.cx, targetInfo.cy);
  try {
    await page.waitForSelector('.__va_panel', { timeout: 10000 });
    pass('panel opens on click');
  } catch {
    fail('panel opens on click', 'no .__va_panel');
  }

  await page.waitForFunction(
    () => {
      const s = document.querySelector('.__va_status');
      return s && !/Capturing/i.test(s.textContent || '');
    },
    { timeout: 45000 }
  );

  const panel = await page.evaluate(() => {
    const p = document.querySelector('.__va_panel');
    if (!p) return null;
    const img = p.querySelector('img');
    const status = p.querySelector('.__va_status');
    const label = p.querySelector('.__va_label');
    return {
      hasImg: !!(img && img.src && img.src.startsWith('data:image/')),
      imgLen: img ? img.src.length : 0,
      status: status ? status.textContent : '',
      label: label ? label.textContent : '',
      src: img ? img.src : '',
    };
  });
  await page.screenshot({ path: path.join(OUT, 'panel.png') });

  if (panel && panel.hasImg && panel.imgLen > 5000) {
    pass('screenshot attached', `${panel.imgLen} bytes; status="${panel.status}"`);
    await writeFile(path.join(OUT, 'shot.b64'), panel.src.split(',')[1] || '', 'utf8');
    // blank check: decode jpeg header + rough size already checked; sample via canvas in page
    const blank = await page.evaluate(async (src) => {
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = src;
      });
      const c = document.createElement('canvas');
      c.width = Math.min(img.naturalWidth, 64);
      c.height = Math.min(img.naturalHeight, 64);
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      let n = 0,
        white = 0,
        sum = 0,
        sumSq = 0;
      for (let i = 0; i < data.length; i += 16) {
        const r = data[i],
          g = data[i + 1],
          b = data[i + 2],
          a = data[i + 3];
        if (a < 8) continue;
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        n++;
        sum += luma;
        sumSq += luma * luma;
        if (r > 250 && g > 250 && b > 250) white++;
      }
      if (!n) return { blank: true, reason: 'no samples' };
      const mean = sum / n;
      const variance = Math.max(0, sumSq / n - mean * mean);
      const whitePct = (100 * white) / n;
      return {
        blank: variance < 12 && whitePct > 97,
        whitePct: Math.round(whitePct),
        variance: Math.round(variance),
        mean: Math.round(mean),
        samples: n,
        w: img.naturalWidth,
        h: img.naturalHeight,
      };
    }, panel.src);
    if (blank && blank.blank) fail('screenshot not blank', JSON.stringify(blank));
    else pass('screenshot not blank', JSON.stringify(blank));
  } else {
    fail(
      'screenshot attached',
      JSON.stringify(panel && { hasImg: panel.hasImg, imgLen: panel.imgLen, status: panel.status })
    );
    console.log(
      'VA logs:',
      logs.filter((l) => l.includes('[VA]') || l.includes('Screenshot')).join('\n')
    );
  }

  if (panel && panel.label) pass('locator label', panel.label);
  else fail('locator label', String(panel && panel.label));

  // Escape closes panel
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const still = await page.evaluate(() => !!document.querySelector('.__va_panel'));
  if (!still) pass('Escape closes panel');
  else fail('Escape closes panel');

  // Hover second target (different element type)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 3));
  await page.waitForTimeout(500);
  const t2 = await page.evaluate(() => {
    const els = [...document.querySelectorAll('a, button, h2, h3, p')];
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width > 40 && r.height > 16 && r.top > 20 && r.bottom < innerHeight - 20) {
        return {
          tag: el.tagName.toLowerCase(),
          cx: Math.round(r.left + r.width / 2),
          cy: Math.round(r.top + r.height / 2),
          l: Math.round(r.left),
          t: Math.round(r.top),
        };
      }
    }
    return null;
  });
  if (t2) {
    await page.mouse.move(t2.cx, t2.cy);
    await page.waitForTimeout(350);
    const o2 = await page.evaluate(() => {
      const box = document.getElementById('__va_overlay');
      if (!box || box.style.display === 'none') return null;
      const r = box.getBoundingClientRect();
      return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), tag: (document.getElementById('__va_overlay_tag') || {}).textContent };
    });
    if (o2 && Math.abs(o2.l - t2.l) < 12 && Math.abs(o2.t - t2.t) < 12) {
      pass('second element overlay', `${o2.tag}`);
    } else {
      fail('second element overlay', JSON.stringify({ o2, t2 }));
    }
  } else {
    fail('second element found');
  }

  // Toggle off
  await page.keyboard.down('Alt');
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Alt');
  await page.waitForTimeout(200);
  const off = await page.evaluate(() => !document.body.classList.contains('__va_pick_mode'));
  if (off) pass('annotate mode OFF');
  else fail('annotate mode OFF');

  const pageErrors = logs.filter((l) => l.startsWith('pageerror'));
  if (pageErrors.length) fail('no page errors', pageErrors.join(' | '));
  else pass('no page errors');

  const failed = results.filter((r) => !r.ok);
  console.log('\n==== BROWSER VERIFY SUMMARY ====');
  console.log(`${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    failed.forEach((f) => console.log(' -', f.name, f.detail));
    process.exitCode = 1;
  } else {
    console.log('ALL PASSED');
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
