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
