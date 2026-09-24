import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp01,
  cssColorToRgba,
  linearToSrgb,
  oklabToSrgb,
  analyzeCanvasImageData,
  clipRectToParents,
} from '../../src/geometry.js';

test('clamp01 bounds', () => {
  assert.equal(clamp01(-1), 0);
  assert.equal(clamp01(0.5), 0.5);
  assert.equal(clamp01(2), 1);
});

test('linearToSrgb endpoints', () => {
  assert.equal(linearToSrgb(0), 0);
  assert.ok(Math.abs(linearToSrgb(1) - 1) < 1e-9);
});

test('oklabToSrgb black is ~0', () => {
  const [r, g, b] = oklabToSrgb(0, 0, 0);
  assert.ok(r < 0.01 && g < 0.01 && b < 0.01);
});

test('cssColorToRgba handles rgb()', () => {
  assert.equal(cssColorToRgba('rgb(255, 0, 0)'), 'rgba(255, 0, 0)');
});

test('cssColorToRgba handles rgba()', () => {
  assert.equal(cssColorToRgba('rgba(0, 128, 0, 0.5)'), 'rgba(0, 128, 0, 0.5)');
});

test('cssColorToRgba converts oklab(0 0 0) to near black', () => {
  const out = cssColorToRgba('oklab(0 0 0)');
  assert.match(out, /^rgb\(/);
  assert.match(out, /rgb\(0, 0, 0\)/);
});

test('cssColorToRgba rejects unknown', () => {
  assert.equal(cssColorToRgba('not-a-color'), null);
  assert.equal(cssColorToRgba(null), null);
});

test('analyzeCanvasImageData flags solid white as blank', () => {
  const w = 32;
  const h = 32;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = 255;
  }
  const stats = analyzeCanvasImageData(data, w, h, 2);
  assert.equal(stats.blank, true);
  assert.ok(stats.whitePct > 97);
});

test('analyzeCanvasImageData flags solid black as blank', () => {
  const w = 32;
  const h = 32;
  const data = new Uint8ClampedArray(w * h * 4);
  // all zeros including alpha → skipped as transparent → blank via samples
  const stats0 = analyzeCanvasImageData(data, w, h, 2);
  assert.equal(stats0.blank, true);

  for (let i = 0; i < data.length; i += 4) {
    data[i + 3] = 255;
  }
  const stats = analyzeCanvasImageData(data, w, h, 2);
  assert.equal(stats.blank, true);
  assert.ok(stats.blackPct > 97);
});

test('analyzeCanvasImageData does not flag mixed content as blank', () => {
  const w = 32;
  const h = 32;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = (x * 8 + y * 4) % 256;
      data[i] = v;
      data[i + 1] = 255 - v;
      data[i + 2] = (x * 16) % 256;
      data[i + 3] = 255;
    }
  }
  const stats = analyzeCanvasImageData(data, w, h, 2);
  assert.equal(stats.blank, false);
});

test('clipRectToParents clips to overflow parent', () => {
  const parent = {
    getBoundingClientRect: () => ({ left: 100, top: 50, width: 200, height: 100 }),
    parentElement: null,
  };
  const child = {
    parentElement: parent,
    getBoundingClientRect: () => ({ left: 50, top: 10, width: 400, height: 300 }),
  };
  const rect = { left: 50, top: 10, width: 400, height: 300 };
  const out = clipRectToParents(
    rect,
    child,
    { left: 0, top: 0, right: 1000, bottom: 1000 },
    () => ({ x: true, y: true }),
    (n) => {
      const r = n.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    }
  );
  assert.equal(out.left, 100);
  assert.equal(out.top, 50);
  assert.equal(out.width, 200);
  assert.equal(out.height, 100);
});

test('clipRectToParents never exceeds viewport', () => {
  const child = { parentElement: null };
  const out = clipRectToParents(
    { left: -50, top: -20, width: 5000, height: 5000 },
    child,
    { left: 0, top: 0, right: 800, bottom: 600 },
    () => ({ x: false, y: false }),
    () => ({ left: 0, top: 0, width: 0, height: 0 })
  );
  assert.equal(out.left, 0);
  assert.equal(out.top, 0);
  assert.equal(out.width, 800);
  assert.equal(out.height, 600);
});
