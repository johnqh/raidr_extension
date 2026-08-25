import { expect, test } from 'bun:test';
import { isXrayMessage } from '../src/shared/messages';

test('accepts a known message kind', () => {
  expect(isXrayMessage({ kind: 'session/start', tabId: 7 })).toBe(true);
});

test('rejects an unknown kind', () => {
  expect(isXrayMessage({ kind: 'nope' })).toBe(false);
});

test('rejects non-objects', () => {
  expect(isXrayMessage(null)).toBe(false);
  expect(isXrayMessage('session/start')).toBe(false);
});

test('every message kind the extension sends is recognised', () => {
  // A kind missing from the guard is silently dropped by every listener — the
  // failure mode is a feature that simply never fires.
  for (const kind of [
    'session/start',
    'session/stop',
    'session/begin',
    'session/started',
    'session/stopped',
    'session/detached',
    'session/error',
    'session/stats',
    'session/coverage',
    'session/redaction',
    'capture/request',
    'capture/gap',
    'capture/runtime',
    'capture/navigation',
    'capture/sourcemap',
    'export/start',
    'export/ready',
  ]) {
    expect(isXrayMessage({ kind })).toBe(true);
  }
});
