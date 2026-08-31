import { expect, test } from 'bun:test';
import { isRaidrMessage } from '../src/shared/messages';

test('accepts a known message kind', () => {
  expect(isRaidrMessage({ kind: 'session/start', tabId: 7 })).toBe(true);
});

test('rejects an unknown kind', () => {
  expect(isRaidrMessage({ kind: 'nope' })).toBe(false);
});

test('rejects non-objects', () => {
  expect(isRaidrMessage(null)).toBe(false);
  expect(isRaidrMessage('session/start')).toBe(false);
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
    expect(isRaidrMessage({ kind })).toBe(true);
  }
});

test('the panel stylesheet defines every token the design preset consumes', async () => {
  // A token the preset maps but the app never defines resolves to a fully
  // transparent colour: the component lays out correctly and simply cannot be
  // seen. That is how the coverage bar rendered at alpha zero.
  const css = await Bun.file(`${import.meta.dir}/../src/sidepanel/index.css`).text();
  for (const token of [
    'background', 'foreground', 'card', 'card-foreground', 'popover',
    'popover-foreground', 'primary', 'primary-foreground', 'secondary',
    'secondary-foreground', 'muted', 'muted-foreground', 'accent',
    'accent-foreground', 'destructive', 'destructive-foreground',
    'success', 'success-foreground', 'warning', 'warning-foreground',
    'info', 'info-foreground', 'border', 'input', 'ring', 'radius',
    'border-width', 'font-sans', 'font-mono', 'shadow-sm', 'shadow-md', 'shadow-lg',
  ]) {
    expect(css).toContain(`--${token}:`);
  }
});

test('both light and dark define the status tokens', async () => {
  const css = await Bun.file(`${import.meta.dir}/../src/sidepanel/index.css`).text();
  const dark = css.slice(css.indexOf('.dark {'));
  for (const token of ['success', 'warning', 'info']) {
    expect(dark).toContain(`--${token}:`);
  }
});

test('the panel imports its stylesheet', async () => {
  // The panel shipped for weeks with no CSS wired at all: every utility class
  // in it was inert and the side panel rendered unstyled.
  const main = await Bun.file(`${import.meta.dir}/../src/sidepanel/main.tsx`).text();
  expect(main).toContain("import './index.css'");
});
