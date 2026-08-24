import { expect, test } from 'bun:test';
import {
  candidateMapUrls,
  isUsefulSourceMap,
} from '../../src/background/sourceMaps';

test('prefers the declared sourceMappingURL, resolved against the script', () => {
  expect(
    candidateMapUrls('https://x.com/assets/app-a1b2.js', 'app-a1b2.js.map')[0]
  ).toBe('https://x.com/assets/app-a1b2.js.map');
});

test('accepts an absolute declared map url', () => {
  expect(
    candidateMapUrls('https://x.com/a.js', 'https://cdn.x.com/a.js.map')[0]
  ).toBe('https://cdn.x.com/a.js.map');
});

test('speculates <script>.map when no url is declared', () => {
  expect(candidateMapUrls('https://x.com/assets/app-a1b2.js', null)).toEqual([
    'https://x.com/assets/app-a1b2.js.map',
  ]);
});

test('speculation is still attempted alongside a declared url', () => {
  const candidates = candidateMapUrls('https://x.com/a.js', 'wrong.map');
  expect(candidates).toContain('https://x.com/a.js.map');
});

test('ignores inline data-uri maps — the bytes are already captured', () => {
  expect(
    candidateMapUrls('https://x.com/a.js', 'data:application/json;base64,e30=')
  ).toEqual(['https://x.com/a.js.map']);
});

test('ignores non-http script urls', () => {
  expect(candidateMapUrls('chrome-extension://abc/a.js', null)).toEqual([]);
  expect(candidateMapUrls('', null)).toEqual([]);
});

test('a map with sourcesContent is useful', () => {
  const map = JSON.stringify({
    version: 3,
    sources: ['src/App.tsx'],
    sourcesContent: ['export const App = () => null;'],
    mappings: 'AAAA',
  });
  expect(isUsefulSourceMap(map)).toBe(true);
});

test('a map without sourcesContent is not useful', () => {
  const map = JSON.stringify({
    version: 3,
    sources: ['src/App.tsx'],
    mappings: 'AAAA',
  });
  expect(isUsefulSourceMap(map)).toBe(false);
});

test('a map whose sourcesContent is all null is not useful', () => {
  const map = JSON.stringify({
    version: 3,
    sources: ['a.ts'],
    sourcesContent: [null],
    mappings: 'AAAA',
  });
  expect(isUsefulSourceMap(map)).toBe(false);
});

test('non-JSON is not a useful source map', () => {
  expect(isUsefulSourceMap('<!doctype html><html>404</html>')).toBe(false);
});
