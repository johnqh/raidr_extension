import { expect, test } from 'bun:test';
import 'fake-indexeddb/auto';
import { IdbContentStore } from '../../src/offscreen/store';
import { CapturePipeline } from '../../src/offscreen/capturePipeline';
import type { AssembledRequest } from '../../src/background/requestAssembler';

function pipeline() {
  return new CapturePipeline(
    new IdbContentStore(`xray-pipe-${Math.random()}`, indexedDB),
    'test-salt'
  );
}

function assembled(overrides: Partial<AssembledRequest> = {}): AssembledRequest {
  return {
    id: 'r1',
    ts: 1756029600000,
    method: 'GET',
    url: 'https://example.com/api/me',
    resourceType: 'XHR',
    requestHeaders: {},
    requestBody: null,
    status: 200,
    responseHeaders: {},
    mimeType: 'application/json',
    fromCache: false,
    navigationId: 'nav1',
    ...overrides,
  };
}

test('stores the redacted body, never the raw one', async () => {
  const pipe = pipeline();
  const row = await pipe.ingest(assembled(), '{"access_token":"eyJa.b.c"}');

  const stored = await pipe.store.get(row.responseBodyHash!);
  const text = new TextDecoder().decode(stored!);
  expect(text).not.toContain('eyJa.b.c');
  expect(text).toContain('<JWT:');
});

test('redacts request headers', async () => {
  const pipe = pipeline();
  const row = await pipe.ingest(
    assembled({ requestHeaders: { authorization: 'Bearer abcdef123456' } }),
    '{}'
  );
  expect(row.requestHeaders.authorization).toMatch(/^<BEARER:/);
});

test('hashes identical redacted bodies to one stored blob', async () => {
  const pipe = pipeline();
  await pipe.ingest(assembled({ id: 'r1' }), '{"a":1}');
  await pipe.ingest(assembled({ id: 'r2' }), '{"a":1}');
  expect(await pipe.store.count()).toBe(1);
});

test('a null body yields a null hash rather than an empty blob', async () => {
  const pipe = pipeline();
  const row = await pipe.ingest(assembled(), null);
  expect(row.responseBodyHash).toBeNull();
  expect(await pipe.store.count()).toBe(0);
});

test('accumulates a redaction report across requests', async () => {
  const pipe = pipeline();
  await pipe.ingest(assembled({ id: 'r1' }), '{"access_token":"eyJa.b.c"}');
  await pipe.ingest(assembled({ id: 'r2' }), '{"access_token":"eyJa.b.c"}');

  const entries = pipe.redactionEntries();
  expect(entries).toHaveLength(1);
  expect(entries[0]!.kind).toBe('jwt');
  expect(entries[0]!.occurrences).toBe(2);
});

test('rows accumulate in capture order', async () => {
  const pipe = pipeline();
  await pipe.ingest(assembled({ id: 'r1' }), '{}');
  await pipe.ingest(assembled({ id: 'r2' }), '{}');
  expect(pipe.rows().map((r) => r.id)).toEqual(['r1', 'r2']);
});

test('JavaScript bodies reach the store byte-identical', async () => {
  const pipe = pipeline();
  const source = 'const t="abcdefghijklmnopqrstuvwxyz0123456789abcd";';
  const row = await pipe.ingest(
    assembled({ mimeType: 'application/javascript' }),
    source
  );
  const stored = await pipe.store.get(row.responseBodyHash!);
  expect(new TextDecoder().decode(stored!)).toBe(source);
});
