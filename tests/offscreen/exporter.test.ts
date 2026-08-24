import { expect, test } from 'bun:test';
import 'fake-indexeddb/auto';
import { unzipSync, strFromU8 } from 'fflate';
import { IdbContentStore } from '../../src/offscreen/store';
import {
  buildBundleFiles,
  zipBundle,
  bundleFilename,
} from '../../src/offscreen/exporter';

const encoder = new TextEncoder();

async function fixtureInput() {
  const store = new IdbContentStore(`xray-export-${Math.random()}`, indexedDB);
  const htmlHash = await store.put(encoder.encode('<html></html>'));
  return {
    store,
    input: {
      store,
      manifest: {
        formatVersion: 1 as const,
        sessionId: 's1',
        origin: 'https://example.com',
        startedAt: '2026-08-24T10:00:00.000Z',
        endedAt: '2026-08-24T10:05:00.000Z',
        counts: { requests: 1, frames: 0, bodies: 1, gaps: 1 },
        stack: null,
      },
      requests: [
        {
          id: 'r1',
          ts: 1756029600000,
          method: 'GET',
          url: 'https://example.com/',
          resourceType: 'Document',
          requestHeaders: {},
          requestBodyHash: null,
          status: 200,
          responseHeaders: {},
          responseBodyHash: htmlHash,
          mimeType: 'text/html',
          fromCache: false,
          navigationId: 'nav1',
        },
      ],
      frames: [],
      gaps: [
        {
          requestId: 'r2',
          url: 'https://cdn.example.com/chunk-47.js',
          reason: 'body-evicted' as const,
          ts: 1756029601000,
          detail: 'No resource with given identifier found',
        },
      ],
      redaction: [
        { placeholder: '<JWT:a1b2>', kind: 'jwt' as const, occurrences: 4 },
      ],
      runtime: {
        framework: { framework: 'react' },
        routes: [],
        stores: [],
        chunks: { known: [], loaded: [] },
        coverage: {},
      },
      htmlHash,
    },
  };
}

test('lays out every required bundle path', async () => {
  const { input } = await fixtureInput();
  const files = await buildBundleFiles(input);
  const paths = Object.keys(files).sort();

  expect(paths).toContain('xray.json');
  expect(paths).toContain('network/requests.jsonl');
  expect(paths).toContain('network/websockets.jsonl');
  expect(paths).toContain('gaps.json');
  expect(paths).toContain('redaction.json');
  expect(paths).toContain('runtime/framework.json');
  expect(paths).toContain('runtime/routes.json');
  expect(paths).toContain('runtime/stores.json');
  expect(paths).toContain('runtime/chunks.json');
  expect(paths).toContain('runtime/coverage.json');
  expect(paths).toContain(`content/${input.htmlHash}.html`);
});

test('writes referenced bodies with the extension implied by mime type', async () => {
  const { input } = await fixtureInput();
  const files = await buildBundleFiles(input);
  const body = files[`content/${input.htmlHash}.html`];
  expect(strFromU8(body!)).toBe('<html></html>');
});

test('records gaps verbatim so reconstruction can see what is missing', async () => {
  const { input } = await fixtureInput();
  const files = await buildBundleFiles(input);
  const gaps = JSON.parse(strFromU8(files['gaps.json']!));
  expect(gaps).toHaveLength(1);
  expect(gaps[0].reason).toBe('body-evicted');
});

test('never writes the pseudonym salt into redaction.json', async () => {
  const { input } = await fixtureInput();
  const files = await buildBundleFiles(input);
  const text = strFromU8(files['redaction.json']!);
  expect(text).toContain('<JWT:a1b2>');
  expect(text.toLowerCase()).not.toContain('salt');
});

test('zips into an archive that unzips back to the same files', async () => {
  const { input } = await fixtureInput();
  const files = await buildBundleFiles(input);
  const zipped = await zipBundle(files);
  const unzipped = unzipSync(zipped);
  expect(strFromU8(unzipped['xray.json']!)).toBe(strFromU8(files['xray.json']!));
});

test('filename encodes host and start time', () => {
  expect(bundleFilename('https://app.example.com', '2026-08-24T10:05:00.000Z')).toBe(
    'xray-app.example.com-20260824-1005.zip'
  );
});
