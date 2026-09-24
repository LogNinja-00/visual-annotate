import test from 'node:test';
import assert from 'node:assert/strict';
import { createConsoleCapture } from '../../src/console-capture.js';

test('buffers messages up to size', () => {
  const cap = createConsoleCapture(3);
  // start() patches console — use snapshot after manual push via console
  // We call start and log, then restore.
  const orig = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };
  cap.start();
  try {
    console.log('a');
    console.log('b');
    console.log('c');
    console.log('d');
    const snap = cap.snapshot();
    assert.equal(snap.length, 3);
    assert.equal(snap[0].message, 'b');
    assert.equal(snap[2].message, 'd');
  } finally {
    cap.stop();
    console.log = orig.log;
    console.info = orig.info;
    console.warn = orig.warn;
    console.error = orig.error;
    console.debug = orig.debug;
  }
});

test('snapshot is a copy', () => {
  const cap = createConsoleCapture(10);
  cap.start();
  try {
    console.info('hello');
    const s1 = cap.snapshot();
    s1.push({ level: 'log', message: 'injected', time: 'x' });
    assert.equal(cap.snapshot().length, 1);
  } finally {
    cap.stop();
  }
});
