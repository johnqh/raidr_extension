import { expect, test } from 'bun:test';
import { viteChunksFromSource } from '../../src/offscreen/viteManifest';

/** Copied verbatim from a production Vite build, trimmed to a few entries. */
const REAL_HELPER =
  'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=' +
  '["assets/solana-BW9mls2C.js","assets/viem-Dy8JGMXg.js",' +
  '"assets/css/solana-BGquk1L2.css","assets/useQuery-ZwI-hE3n.js"])))' +
  '=>i.map(i=>d[i]);\nimport{r as e}from"./react-vendor-sBn40bA5.js";';

test('recovers the chunk list from the vite dynamic-import helper', () => {
  expect(viteChunksFromSource(REAL_HELPER)).toEqual([
    'assets/solana-BW9mls2C.js',
    'assets/viem-Dy8JGMXg.js',
    'assets/useQuery-ZwI-hE3n.js',
  ]);
});

/** Coverage counts script chunks; a stylesheet is an asset, not a chunk. */
test('leaves css dependencies out of the chunk list', () => {
  expect(viteChunksFromSource(REAL_HELPER)).not.toContain('assets/css/solana-BGquk1L2.css');
});

test('collects every helper when a chunk declares more than one', () => {
  const source =
    'm.f=["assets/a.js"] __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/b.js"])))' +
    ';__vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/c.js"])))';
  expect(viteChunksFromSource(source)).toEqual(['assets/b.js', 'assets/c.js']);
});

test('returns nothing for a script that is not a vite entry', () => {
  expect(viteChunksFromSource('export function hello(){return 1}')).toEqual([]);
});

test('returns nothing when the dep list is not parseable', () => {
  expect(viteChunksFromSource('__vite__mapDeps=(i,m,d=(m.f||(m.f=[not json])))')).toEqual([]);
});

test('ignores a helper whose dep list is too far away to be one', () => {
  const source = `__vite__mapDeps${'x'.repeat(400)}m.f=["assets/a.js"]`;
  expect(viteChunksFromSource(source)).toEqual([]);
});
