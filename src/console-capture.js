// Keeps a rolling buffer of the last N console messages so we can attach
// recent console activity to a comment at the moment it's created.
// Purely visual/CSS issues will naturally have an empty buffer — that's expected,
// not a bug: nothing was logged because nothing errored.

const LEVELS = ['log', 'info', 'warn', 'error', 'debug'];

export function createConsoleCapture(bufferSize = 50) {
  const buffer = [];
  const originals = {};

  function stringifyArg(arg) {
    if (typeof arg === 'string') return arg;
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }

  function push(level, args) {
    buffer.push({
      level,
      message: args.map(stringifyArg).join(' '),
      time: new Date().toISOString(),
    });
    if (buffer.length > bufferSize) buffer.shift();
  }

  function start() {
    LEVELS.forEach((level) => {
      originals[level] = console[level].bind(console);
      console[level] = (...args) => {
        push(level, args);
        originals[level](...args);
      };
    });

    window.addEventListener('error', (e) => {
      push('error', [`Uncaught: ${e.message} (${e.filename}:${e.lineno})`]);
    });
    window.addEventListener('unhandledrejection', (e) => {
      push('error', [`Unhandled promise rejection: ${e.reason}`]);
    });
  }

  function stop() {
    LEVELS.forEach((level) => {
      if (originals[level]) console[level] = originals[level];
    });
  }

  function snapshot() {
    return buffer.slice();
  }

  return { start, stop, snapshot };
}
