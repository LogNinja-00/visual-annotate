import test from 'node:test';
import assert from 'node:assert/strict';

import { createConsoleCapture } from '../src/console-capture.js';

// console-capture installs itself over the global `console` and hooks `window`.
// Provide a window stub that records the listeners so the error paths are
// reachable, and always restore console inside each test.
const listeners = {};
globalThis.window = {
  addEventListener(type, fn) {
    (listeners[type] ||= []).push(fn);
  },
};

function withCapture(size, fn) {
  const capture = createConsoleCapture(size);
  capture.start();
  try {
    return fn(capture, (type) => listeners[type].at(-1));
  } finally {
    capture.stop();
  }
}

test('captures console calls and forwards them to the original', () => {
  const forwarded = [];
  const real = console.log;
  console.log = (...args) => forwarded.push(args);
  try {
    withCapture(50, (capture) => {
      console.log('hello');
      const snap = capture.snapshot();
      assert.equal(snap.length, 1);
      assert.equal(snap[0].level, 'log');
      assert.equal(snap[0].message, 'hello');
    });
  } finally {
    console.log = real;
  }
  assert.deepEqual(forwarded, [['hello']], 'the original console.log still ran');
});

test('keeps only the most recent messages', () => {
  withCapture(2, (capture) => {
    console.log('one');
    console.log('two');
    console.log('three');
    assert.deepEqual(
      capture.snapshot().map((e) => e.message),
      ['two', 'three']
    );
  });
});

test('serializes non-string arguments', () => {
  withCapture(50, (capture) => {
    console.log({ a: 1 }, 'tail');
    assert.equal(capture.snapshot()[0].message, '{"a":1} tail');
  });
});

test('falls back to String() when an argument cannot be serialized', () => {
  withCapture(50, (capture) => {
    const circular = {};
    circular.self = circular;
    console.log(circular);
    assert.equal(capture.snapshot()[0].message, '[object Object]');
  });
});

test('records levels separately', () => {
  withCapture(50, (capture) => {
    console.warn('careful');
    console.error('bad');
    assert.deepEqual(
      capture.snapshot().map((e) => e.level),
      ['warn', 'error']
    );
  });
});

test('records uncaught errors and rejections', () => {
  withCapture(50, (capture, listener) => {
    listener('error')({ message: 'boom', filename: 'app.js', lineno: 12 });
    listener('unhandledrejection')({ reason: 'nope' });
    assert.deepEqual(
      capture.snapshot().map((e) => e.message),
      ['Uncaught: boom (app.js:12)', 'Unhandled promise rejection: nope']
    );
  });
});

test('stop() restores the original console methods', () => {
  const original = console.log;
  const capture = createConsoleCapture(10);
  capture.start();
  assert.notEqual(console.log, original);
  capture.stop();
  assert.equal(console.log, original);
});
