export const DEBUG = false;

export function debugLog() {
  if (DEBUG) {
    console.log.apply(console, arguments);
  }
}

export function debugWarn() {
  if (DEBUG) {
    console.warn.apply(console, arguments);
  }
}

export function debugError() {
  if (DEBUG) {
    console.error.apply(console, arguments);
  }
}

export function debugTime(label) {
  if (DEBUG) {
    console.time(label);
  }
}

export function debugTimeEnd(label) {
  if (DEBUG) {
    console.timeEnd(label);
  }
}
